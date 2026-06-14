import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFileSync = vi.fn();
const mockDeleteCustomLayout = vi.fn();
const mockListConfig = vi.fn();
const mockListCustomLayouts = vi.fn();
const mockReadCustomLayout = vi.fn();
const mockSaveCustomLayout = vi.fn();
const mockIsPresetName = vi.fn();
const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});
const mockParseTreeDSL = vi.fn();
const mockRenderLayoutPreview = vi.fn();
const mockLayoutNotFoundOrExit = vi.fn((name: string) => {
  throw new Error(`missing:${name}`);
});
const mockTreeToGrid = vi.fn();
const mockValidateLayoutNameOrExit = vi.fn();
const mockRunLayoutBuilder = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock("../config.js", () => ({
  LAYOUTS_DIR: "/mock/layouts",
  deleteCustomLayout: (...args: unknown[]) => mockDeleteCustomLayout(...args),
  listConfig: (...args: unknown[]) => mockListConfig(...args),
  listCustomLayouts: (...args: unknown[]) => mockListCustomLayouts(...args),
  readCustomLayout: (...args: unknown[]) => mockReadCustomLayout(...args),
  saveCustomLayout: (...args: unknown[]) => mockSaveCustomLayout(...args),
}));

vi.mock("../layout.js", () => ({
  isPresetName: (...args: unknown[]) => mockIsPresetName(...args),
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    SAFE_COMMAND_RE: /^[A-Za-z0-9._-]+$/,
    exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
  };
});

vi.mock("../tree.js", () => ({
  parseTreeDSL: (tree: string) => mockParseTreeDSL(tree),
}));

vi.mock("../ui/layout-preview.js", () => ({
  renderLayoutPreview: (...args: unknown[]) => mockRenderLayoutPreview(...args),
}));

vi.mock("./layout-support.js", () => ({
  layoutNotFoundOrExit: (name: string) => mockLayoutNotFoundOrExit(name),
  treeToGrid: (node: unknown, panes: unknown) => mockTreeToGrid(node, panes),
  validateLayoutNameOrExit: (name: string) => mockValidateLayoutNameOrExit(name),
}));

vi.mock("../setup.js", () => ({
  runLayoutBuilder: (...args: unknown[]) => mockRunLayoutBuilder(...args),
}));

const { handleLayoutCommand } = await import("./layout.js");

function makeContext(overrides: Partial<Parameters<typeof handleLayoutCommand>[0]> = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "layout",
    args: [],
    overrides: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListConfig.mockReturnValue(new Map<string, string>());
  mockListCustomLayouts.mockReturnValue([]);
  mockIsPresetName.mockReturnValue(false);
  delete process.env.EDITOR;
});

describe("handleLayoutCommand", () => {
  it("requires an action", async () => {
    await expect(handleLayoutCommand(makeContext())).rejects.toThrow(
      "usage:Usage: summon layout <create|save|list|show|delete|edit> [name]",
    );
  });

  it("creates layouts through the interactive builder", async () => {
    await handleLayoutCommand(makeContext({ args: ["create", "team"] }));

    expect(mockValidateLayoutNameOrExit).toHaveBeenCalledWith("team");
    expect(mockRunLayoutBuilder).toHaveBeenCalledWith("team");
  });

  it("requires a layout name when creating", async () => {
    await expect(handleLayoutCommand(makeContext({ args: ["create"] }))).rejects.toThrow(
      "usage:Usage: summon layout create <name>",
    );
  });

  it("warns when saving an empty layout config", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleLayoutCommand(makeContext({ args: ["save", "team"] }));

    expect(warnSpy).toHaveBeenCalledWith(
      "Warning: saving layout with empty config. Set values first with: summon set <key> <value>",
    );
    expect(mockSaveCustomLayout).toHaveBeenCalledWith("team", new Map());
    expect(logSpy).toHaveBeenCalledWith("Saved custom layout: team");
  });

  it("requires a layout name when saving", async () => {
    await expect(handleLayoutCommand(makeContext({ args: ["save"] }))).rejects.toThrow(
      "usage:Usage: summon layout save <name>",
    );
  });

  it("lists no layouts when none are saved", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleLayoutCommand(makeContext({ args: ["list"] }));

    expect(logSpy).toHaveBeenCalledWith("No custom layouts found.");
    expect(logSpy).toHaveBeenCalledWith("Run `summon layout save <name>` to create one.");
  });

  it("renders previews and config details when listing layouts", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListCustomLayouts.mockReturnValue(["team", "broken"]);
    mockReadCustomLayout
      .mockReturnValueOnce(new Map([
        ["tree", "left|right"],
        ["pane.main", "nvim"],
        ["pane.shell", "zsh"],
        ["layout", "pair"],
      ]))
      .mockReturnValueOnce(new Map([
        ["tree", "bad-tree"],
        ["pane.main", "nvim"],
      ]));
    mockParseTreeDSL.mockImplementationOnce(() => ({ type: "pane", name: "main" }))
      .mockImplementationOnce(() => { throw new Error("bad tree"); });
    mockTreeToGrid.mockReturnValue([["nvim", "zsh"]]);
    mockRenderLayoutPreview.mockReturnValue("┌──┐\n└──┘");

    await handleLayoutCommand(makeContext({ args: ["list"] }));

    expect(logSpy).toHaveBeenCalledWith("Custom layouts (2):\n");
    expect(logSpy).toHaveBeenCalledWith("    ┌──┐");
    expect(logSpy).toHaveBeenCalledWith("    └──┘");
    expect(logSpy).toHaveBeenCalledWith("    Config: layout=pair");
    // FE-H1 (#358): cyan() helper used instead of raw ANSI; no-color in test env → plain text
    expect(logSpy).toHaveBeenCalledWith("    Panes:  main=nvim");
    expect(logSpy).toHaveBeenCalledWith("    Tree:   bad-tree");
  });

  it("lists layout names when layout data cannot be read", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListCustomLayouts.mockReturnValue(["orphan"]);
    mockReadCustomLayout.mockReturnValue(null);

    await handleLayoutCommand(makeContext({ args: ["list"] }));

    // FE-H1 (#358): bold() helper used instead of raw ANSI; no-color in test env → plain text
    expect(logSpy).toHaveBeenCalledWith("  orphan");
  });

  it("lists pane definitions when a layout has panes but no tree", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListCustomLayouts.mockReturnValue(["plain"]);
    mockReadCustomLayout.mockReturnValue(new Map([
      ["pane.main", "nvim"],
      ["pane.shell", "zsh"],
    ]));

    await handleLayoutCommand(makeContext({ args: ["list"] }));

    // FE-H1 (#358): cyan() helper used instead of raw ANSI; no-color in test env → plain text
    expect(logSpy).toHaveBeenCalledWith("    Panes:  main=nvim  shell=zsh");
  });

  it("shows custom layout contents", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadCustomLayout.mockReturnValue(new Map([
      ["panes", "4"],
      ["layout", "pair"],
    ]));

    await handleLayoutCommand(makeContext({ args: ["show", "team"] }));

    expect(logSpy).toHaveBeenCalledWith("Layout: team");
    expect(logSpy).toHaveBeenCalledWith("  panes=4");
    expect(logSpy).toHaveBeenCalledWith("  layout=pair");
  });

  it("rejects built-in presets in show mode", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    mockIsPresetName.mockReturnValue(true);

    await expect(handleLayoutCommand(makeContext({ args: ["show", "pair"] }))).rejects.toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain(
      `"pair" is a built-in preset, not a custom layout. Run 'summon --help' to see preset descriptions.`,
    );
    expect(allWrites).toContain("summon: error:");
    writeSpy.mockRestore();
  });

  it("requires a layout name for show, delete, and edit", async () => {
    await expect(handleLayoutCommand(makeContext({ args: ["show"] }))).rejects.toThrow(
      "usage:Usage: summon layout show <name>",
    );
    await expect(handleLayoutCommand(makeContext({ args: ["delete"] }))).rejects.toThrow(
      "usage:Usage: summon layout delete <name>",
    );
    await expect(handleLayoutCommand(makeContext({ args: ["edit"] }))).rejects.toThrow(
      "usage:Usage: summon layout edit <name>",
    );
  });

  it("reports missing layouts in show and delete mode", async () => {
    mockReadCustomLayout.mockReturnValue(null);
    mockDeleteCustomLayout.mockReturnValue(false);

    await expect(handleLayoutCommand(makeContext({ args: ["show", "missing"] }))).rejects.toThrow("missing:missing");
    await expect(handleLayoutCommand(makeContext({ args: ["delete", "missing"] }))).rejects.toThrow("missing:missing");
  });

  it("reports missing layouts in edit mode", async () => {
    mockReadCustomLayout.mockReturnValue(null);

    await expect(handleLayoutCommand(makeContext({ args: ["edit", "missing"] }))).rejects.toThrow("missing:missing");
  });

  it("deletes existing custom layouts", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDeleteCustomLayout.mockReturnValue(true);

    await handleLayoutCommand(makeContext({ args: ["delete", "team"] }));

    expect(logSpy).toHaveBeenCalledWith("Deleted custom layout: team");
  });

  it("opens layouts in the configured editor", async () => {
    process.env.EDITOR = "nvim";
    mockReadCustomLayout.mockReturnValue(new Map([["panes", "4"]]));

    await handleLayoutCommand(makeContext({ args: ["edit", "team"] }));

    expect(mockExecFileSync).toHaveBeenCalledWith("nvim", ["/mock/layouts/team"], { stdio: "inherit" });
  });

  it("uses vi when EDITOR is not set", async () => {
    mockReadCustomLayout.mockReturnValue(new Map([["panes", "4"]]));

    await handleLayoutCommand(makeContext({ args: ["edit", "team"] }));

    expect(mockExecFileSync).toHaveBeenCalledWith("vi", ["/mock/layouts/team"], { stdio: "inherit" });
  });

  it("rejects unsafe EDITOR values", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    process.env.EDITOR = "bad editor";
    mockReadCustomLayout.mockReturnValue(new Map([["panes", "4"]]));

    await expect(handleLayoutCommand(makeContext({ args: ["edit", "team"] }))).rejects.toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain('unsafe EDITOR value "bad editor".');
    expect(allWrites).toContain("summon: error:");
    writeSpy.mockRestore();
  });

  it("reports editor launch failures", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    process.env.EDITOR = "nvim";
    mockReadCustomLayout.mockReturnValue(new Map([["panes", "4"]]));
    mockExecFileSync.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(handleLayoutCommand(makeContext({ args: ["edit", "team"] }))).rejects.toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("Failed to open editor: nvim");
    expect(allWrites).toContain(
      "Check your EDITOR environment variable or ensure the editor is installed.",
    );
    writeSpy.mockRestore();
  });

  it("rejects unknown actions", async () => {
    await expect(handleLayoutCommand(makeContext({ args: ["wat"] }))).rejects.toThrow(
      "usage:Unknown layout action: wat\nUsage: summon layout <create|save|list|show|delete|edit> [name]",
    );
  });

  // FE-M4 (#388): --names flag outputs one bare name per line
  it("outputs one bare layout name per line when --names flag is passed (FE-M4 #388)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListCustomLayouts.mockReturnValue(["team", "minimal", "devops"]);

    await handleLayoutCommand(makeContext({ args: ["list", "--names"] }));

    const calls = logSpy.mock.calls.map(c => c[0] as string);
    expect(calls).toEqual(["team", "minimal", "devops"]);
    logSpy.mockRestore();
  });

  it("outputs nothing for --names when no custom layouts exist (FE-M4 #388)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListCustomLayouts.mockReturnValue([]);

    await handleLayoutCommand(makeContext({ args: ["list", "--names"] }));

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
