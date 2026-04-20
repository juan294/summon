import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveConfig = vi.fn();
const mockTraditionalPaneNames = vi.fn();
const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});
const mockGenerateZshCompletion = vi.fn();
const mockGenerateBashCompletion = vi.fn();
const mockGenerateKeyTableConfig = vi.fn();
const mockCollectLeaves = vi.fn();
const mockResolveTreeCommands = vi.fn();
const mockPlanLayout = vi.fn();
const mockRunSetup = vi.fn();

vi.mock("../launcher.js", () => ({
  resolveConfig: (...args: unknown[]) => mockResolveConfig(...args),
  traditionalPaneNames: (...args: unknown[]) => mockTraditionalPaneNames(...args),
}));

vi.mock("../utils.js", () => ({
  exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
}));

vi.mock("../completions.js", () => ({
  generateZshCompletion: (...args: unknown[]) => mockGenerateZshCompletion(...args),
  generateBashCompletion: (...args: unknown[]) => mockGenerateBashCompletion(...args),
}));

vi.mock("../keybindings.js", () => ({
  generateKeyTableConfig: (...args: unknown[]) => mockGenerateKeyTableConfig(...args),
}));

vi.mock("../tree.js", () => ({
  collectLeaves: (...args: unknown[]) => mockCollectLeaves(...args),
  resolveTreeCommands: (...args: unknown[]) => mockResolveTreeCommands(...args),
}));

vi.mock("../layout.js", () => ({
  planLayout: (...args: unknown[]) => mockPlanLayout(...args),
}));

vi.mock("../setup.js", () => ({
  runSetup: (...args: unknown[]) => mockRunSetup(...args),
}));

const {
  handleCompletionsCommand,
  handleKeybindingsCommand,
  handleSetupCommand,
} = await import("./setup.js");

function makeContext(overrides: Partial<Parameters<typeof handleCompletionsCommand>[0]> = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "setup",
    args: [],
    overrides: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateZshCompletion.mockReturnValue("zsh completion");
  mockGenerateBashCompletion.mockReturnValue("bash completion");
  mockGenerateKeyTableConfig.mockReturnValue("key table");
});

describe("handleSetupCommand", () => {
  it("runs the interactive setup workflow", async () => {
    await handleSetupCommand();

    expect(mockRunSetup).toHaveBeenCalledOnce();
  });
});

describe("handleCompletionsCommand", () => {
  it("requires a shell name", async () => {
    await expect(handleCompletionsCommand(makeContext())).rejects.toThrow(
      "usage:Usage: summon completions <shell>\nSupported shells: zsh, bash",
    );
  });

  it("rejects unsupported shells", async () => {
    await expect(handleCompletionsCommand(makeContext({ args: ["fish"] }))).rejects.toThrow(
      "usage:Error: Unsupported shell: fish\nSupported shells: zsh, bash",
    );
  });

  it("prints zsh completion output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCompletionsCommand(makeContext({ args: ["zsh"] }));

    expect(logSpy).toHaveBeenCalledWith("zsh completion");
  });

  it("prints bash completion output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleCompletionsCommand(makeContext({ args: ["bash"] }));

    expect(logSpy).toHaveBeenCalledWith("bash completion");
  });
});

describe("handleKeybindingsCommand", () => {
  it("uses tree layouts when present and respects vim mode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockResolveConfig.mockReturnValue({
      opts: { panes: 3 },
      treeLayout: { tree: { type: "split" }, panes: new Map([["main", "nvim"]]) },
    });
    mockResolveTreeCommands.mockReturnValue({ type: "pane", name: "main" });
    mockCollectLeaves.mockReturnValue(["main", "shell"]);

    await handleKeybindingsCommand(makeContext({
      values: { vim: true },
      overrides: { layout: "pair" },
    }));

    expect(mockResolveTreeCommands).toHaveBeenCalled();
    expect(mockGenerateKeyTableConfig).toHaveBeenCalledWith(["main", "shell"], "tree", "vim");
    expect(logSpy).toHaveBeenCalledWith("key table");
  });

  it("falls back to planned layouts and arrow style", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockResolveConfig.mockReturnValue({
      opts: { panes: 2 },
      treeLayout: null,
    });
    mockPlanLayout.mockReturnValue({ layout: "pair-plan" });
    mockTraditionalPaneNames.mockReturnValue(["editor", "sidebar", "shell"]);

    await handleKeybindingsCommand(makeContext({
      values: {},
      overrides: {},
    }));

    expect(mockPlanLayout).toHaveBeenCalledWith({ panes: 2 });
    expect(mockTraditionalPaneNames).toHaveBeenCalledWith({ layout: "pair-plan" });
    expect(mockGenerateKeyTableConfig).toHaveBeenCalledWith(
      ["editor", "sidebar", "shell"],
      "default",
      "arrows",
    );
    expect(logSpy).toHaveBeenCalledWith("key table");
  });
});
