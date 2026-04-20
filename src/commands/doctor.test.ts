import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockAppendFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockListConfig = vi.fn();
const mockListProjects = vi.fn();
const mockCheckAccessibility = vi.fn();
const mockResolveCommand = vi.fn();
const mockCommandExecutable = vi.fn();
const mockDetectAllPorts = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
  appendFileSync: (...args: unknown[]) => mockAppendFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => "/Users/tester",
}));

vi.mock("../config.js", () => ({
  listConfig: (...args: unknown[]) => mockListConfig(...args),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
}));

vi.mock("../utils.js", () => ({
  checkAccessibility: (...args: unknown[]) => mockCheckAccessibility(...args),
  resolveCommand: (...args: unknown[]) => mockResolveCommand(...args),
  ACCESSIBILITY_REQUIRED_MSG: "Accessibility is required.",
  ACCESSIBILITY_SETTINGS_PATH: "System Settings > Privacy & Security > Accessibility",
  ACCESSIBILITY_ENABLE_HINT: "Enable Ghostty in the accessibility list.",
}));

vi.mock("../command-spec.js", () => ({
  commandExecutable: (...args: unknown[]) => mockCommandExecutable(...args),
}));

vi.mock("../ports.js", () => ({
  detectAllPorts: (...args: unknown[]) => mockDetectAllPorts(...args),
}));

const { handleDoctorCommand } = await import("./doctor.js");

function makeContext(overrides: Partial<Parameters<typeof handleDoctorCommand>[0]> = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "doctor",
    args: [],
    overrides: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListConfig.mockReturnValue(new Map());
  mockListProjects.mockReturnValue(new Map([
    ["api", "/tmp/api"],
    ["web", "/tmp/web"],
  ]));
  mockCheckAccessibility.mockReturnValue(true);
  mockResolveCommand.mockReturnValue("/usr/bin/nvim");
  mockCommandExecutable.mockImplementation((cmd: string) => cmd.split(" ")[0]);
  mockDetectAllPorts.mockReturnValue({ conflicts: new Map() });
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReturnValue("");
});

describe("handleDoctorCommand", () => {
  it("reports a clean setup when everything is configured", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "notify-on-command-finish = unfocused\nshell-integration = detect\n",
    );
    mockListConfig.mockReturnValue(new Map([
      ["editor", "nvim"],
      ["sidebar", "lazygit"],
    ]));

    await handleDoctorCommand(makeContext());

    expect(logSpy).toHaveBeenCalledWith('  + editor command "nvim" found at /usr/bin/nvim');
    expect(logSpy).toHaveBeenCalledWith('  + sidebar command "lazygit" found at /usr/bin/nvim');
    expect(logSpy).toHaveBeenCalledWith("  + No port conflicts (2 projects checked)");
    expect(logSpy).toHaveBeenCalledWith("\n  All recommended settings are configured!");
  });

  it("lists missing settings and exits with code 2 when issues remain", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockCheckAccessibility.mockReturnValue(false);
    mockDetectAllPorts.mockReturnValue({ conflicts: new Map([[3000, ["api", "web"]]]) });

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");
    expect(errorSpy).toHaveBeenCalledWith("Exit code 2: issues were found. See above for details.");
  });

  it("backs up and appends missing settings in --fix mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockImplementation((path: string) =>
      path === "/Users/tester/.config/ghostty/config"
    );

    await handleDoctorCommand(makeContext({ values: { fix: true } }));

    expect(mockMkdirSync).toHaveBeenCalledWith("/Users/tester/.config/ghostty", { recursive: true });
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      "/Users/tester/.config/ghostty/config",
      expect.stringContaining("/Users/tester/.config/ghostty/config.bak."),
    );
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      "/Users/tester/.config/ghostty/config",
      expect.stringContaining("# Added by summon doctor --fix"),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Added 2 setting(s) to /Users/tester/.config/ghostty/config"));
  });

  it("reports missing configured commands", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "notify-on-command-finish = unfocused\nshell-integration = detect\n",
    );
    mockListConfig.mockReturnValue(new Map([["editor", "missing-editor --flag"]]));
    mockResolveCommand.mockReturnValue(null);

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");
    expect(logSpy).toHaveBeenCalledWith('  - editor command "missing-editor" not found in PATH');
    expect(logSpy).toHaveBeenCalledWith('    Install "missing-editor" or change with: summon set editor <command>');
  });
});
