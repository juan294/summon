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

    expect(logSpy).toHaveBeenCalledWith('  ✔ PASS  editor command "nvim" found at /usr/bin/nvim');
    expect(logSpy).toHaveBeenCalledWith('  ✔ PASS  sidebar command "lazygit" found at /usr/bin/nvim');
    expect(logSpy).toHaveBeenCalledWith("  ✔ PASS  No port conflicts (2 projects checked)");
    // Issue count summary shows "All checks passed" when clean
    const allOutput = logSpy.mock.calls.flat().join("\n");
    expect(allOutput).toMatch(/✓ \d+\/\d+ checks passed\./);
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

  it("does not create a backup in --fix mode when the Ghostty config file is missing", async () => {
    mockExistsSync.mockReturnValue(false);

    await handleDoctorCommand(makeContext({ values: { fix: true } }));

    expect(mockMkdirSync).toHaveBeenCalledWith("/Users/tester/.config/ghostty", { recursive: true });
    expect(mockCopyFileSync).not.toHaveBeenCalled();
    expect(mockAppendFileSync).toHaveBeenCalled();
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
    expect(logSpy).toHaveBeenCalledWith('  ✖ FAIL  editor command "missing-editor" not found in PATH');
    expect(logSpy).toHaveBeenCalledWith('    Install "missing-editor" or change with: summon set editor <command>');
    // Issue count shown in summary
    const allOutput = logSpy.mock.calls.flat().join("\n");
    expect(allOutput).toMatch(/\d+\/\d+ checks passed/);
  });

  it("uses the full configured command when no executable can be parsed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "notify-on-command-finish = unfocused\nshell-integration = detect\n",
    );
    mockListConfig.mockReturnValue(new Map([["editor", "   "]]));
    mockCommandExecutable.mockReturnValue(null);

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");

    expect(logSpy).toHaveBeenCalledWith('  ✖ FAIL  editor command "   " not found in PATH');
    expect(logSpy).toHaveBeenCalledWith('    Install "   " or change with: summon set editor <command>');
  });

  it("shows '✓ N/N checks passed.' when there are no issues", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "notify-on-command-finish = unfocused\nshell-integration = detect\n",
    );

    await handleDoctorCommand(makeContext());

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/✓ \d+\/\d+ checks passed\./);
  });

  it("prints issue count summary when issues are found", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockCheckAccessibility.mockReturnValue(false);

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/\d+\/\d+ checks passed/);
  });

  it("prints auto-fixable count in issue summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    // Missing ghost config settings are auto-fixable
    mockExistsSync.mockReturnValue(false);

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/auto-fixable/);
    expect(output).toContain("summon doctor --fix");
  });

  // #432 UX-M5: visual pass/fail indicators instead of raw booleans
  it("shows a visual PASS indicator for passing checks, not the literal string 'true'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "notify-on-command-finish = unfocused\nshell-integration = detect\n",
    );

    await handleDoctorCommand(makeContext());

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).not.toContain("true");
    // Should contain a pass symbol (✔ or ✓ or PASS)
    expect(output).toMatch(/PASS|✔|✓/);
  });

  it("shows a visual FAIL indicator for failing checks, not the literal string 'false'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockCheckAccessibility.mockReturnValue(false);

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).not.toContain("false");
    // Should contain a fail symbol (✖ or ✗ or FAIL)
    expect(output).toMatch(/FAIL|✖|✗/);
  });

  // #435 UX-M9: summary count of passed/failed checks
  it("shows a passed/total summary count at the end of output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "notify-on-command-finish = unfocused\nshell-integration = detect\n",
    );

    await handleDoctorCommand(makeContext());

    const output = logSpy.mock.calls.flat().join("\n");
    // Should show something like "4/4 checks passed" or "All 4 checks passed"
    expect(output).toMatch(/\d+\/\d+ checks passed|\d+ checks passed|all.*checks passed/i);
  });

  it("shows a next-steps hint when checks fail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockCheckAccessibility.mockReturnValue(false);

    await expect(handleDoctorCommand(makeContext())).rejects.toThrow("exit:2");

    const output = logSpy.mock.calls.flat().join("\n");
    // Should hint at summon setup when accessibility fails
    expect(output).toMatch(/summon setup|fix/i);
  });
});
