import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CLIOverrides } from "./config-resolve.js";

// Moved from launcher.test.ts with config resolution (AR-M2): the same config, trust and fs mocks.
const mockReadKVFile = vi.fn((_path: string) => new Map<string, string>());
const mockReadCustomLayout = vi.fn((_name: string): Map<string, string> | null => null);
const mockIsCustomLayout = vi.fn((_name: string) => false);
vi.mock("./config.js", () => ({
  listConfig: vi.fn(() => new Map<string, string>()),
  listProjects: vi.fn(() => new Map<string, string>()),
  readKVFile: (path: string) => mockReadKVFile(path),
  readKVFromString: (text: string) => new Map(text.split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as [string, string])),
  readCustomLayout: (name: string) => mockReadCustomLayout(name),
  isCustomLayout: (name: string) => mockIsCustomLayout(name),
  CONFIG_DIR: "/mock/.config/summon",
  STATUS_DIR: "/mock/.config/summon/status",
  LAYOUT_NAME_RE: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  realpathSync: vi.fn((path: string) => path),
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("/.summon")) return [...mockReadKVFile(path)].map(([key, value]) => `${key}=${value}\n`).join("");
    throw new Error("fixture absent");
  }),
}));

vi.mock("./trust.js", () => ({
  assertTrusted: vi.fn(),
  assertTrustedContent: vi.fn(),
}));

const { resolveConfig, optsToConfigMap } = await import("./config-resolve.js");
const { listConfig, listProjects } = await import("./config.js");

/** resolveConfig with the `.summon` content the trusted read would hand it: whatever mockReadKVFile says about that file. */
function resolveConfigWithMockedSummon(targetDir: string, overrides: CLIOverrides): ReturnType<typeof resolveConfig> {
  const project = mockReadKVFile(`${targetDir}/.summon`);
  return resolveConfig(targetDir, overrides, [...project].map(([key, value]) => `${key}=${value}`).join("\n"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadKVFile.mockReturnValue(new Map<string, string>());
  mockReadCustomLayout.mockReturnValue(null);
  mockIsCustomLayout.mockReturnValue(false);
  vi.mocked(listConfig).mockReturnValue(new Map<string, string>([["editor", "vim"]]));
  vi.mocked(listProjects).mockReturnValue(new Map<string, string>());
});

describe("config resolution", () => {
  it("project config overrides global config", () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "claude"]]));
    mockReadKVFile.mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.editor).toBe("vim");
  });

  it("CLI overrides project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { editor: "nano" });
    expect(opts.editor).toBe("nano");
  });

  it("preset expansion with individual key overrides", () => {
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "minimal"],
        ["panes", "4"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    // Preset minimal sets editorPanes=1, but project overrides to 4
    expect(opts.editorPanes).toBe(4);
    // Preset minimal sets shell=false, no override → stays false
    expect(opts.shell).toBe("false");
  });

  it("empty config strings do not override preset values", () => {
    // Bug: machine config with panes= and editor-size= (empty strings)
    // should not override the preset's values
    vi.mocked(listConfig).mockReturnValue(
      new Map([
        ["panes", ""],
        ["editor-size", ""],
        ["editor", ""],
        ["sidebar", ""],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map());

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { layout: "cli" });

    // cli preset: editorPanes=1, shell="true"
    // Empty config strings should NOT override these
    expect(opts.editorPanes).toBe(1);
    expect(opts.editorSize).toBeUndefined(); // fall through to planLayout default
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("empty project config strings do not override preset values", () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "full"],
        ["panes", ""],
        ["editor-size", ""],
      ]),
    );

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});

    // full preset: editorPanes=3
    expect(opts.editorPanes).toBe(3);
    // Only the project config log should appear — no validation warnings
    const nonConfigMsgs = warnSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((m) => !m.startsWith("Using project config:"));
    expect(nonConfigMsgs).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("unknown preset warns and falls through to defaults", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockReadKVFile.mockReturnValue(new Map([["layout", "bogus"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(warnSpy).toHaveBeenCalledWith(
      'summon: warning: Unknown layout preset: "bogus". Valid presets: minimal, full, pair, cli, btop. Using defaults.\n',
    );
    expect(opts.editorPanes).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("unknown preset warning lists all valid presets", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockReadKVFile.mockReturnValue(new Map([["layout", "invalid"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const presetWarn = warnMessages.find((m) => m.includes("Unknown layout preset"));
    expect(presetWarn).toBeDefined();
    expect(presetWarn).toContain("minimal");
    expect(presetWarn).toContain("full");
    expect(presetWarn).toContain("pair");
    expect(presetWarn).toContain("cli");
    expect(presetWarn).toContain("btop");
    warnSpy.mockRestore();
  });
});


describe("input validation", () => {
  it("warns and uses default when panes is NaN", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { panes: "abc" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when panes is zero", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { panes: "0" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when panes is negative", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { panes: "-2" });
    expect(opts.editorPanes).toBe(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is 0", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { "editor-size": "0" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is out of range", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { "editor-size": "150" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and uses default when editorSize is NaN", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { "editor-size": "big" });
    expect(opts.editorSize).toBe(75);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("accepts valid panes value", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { panes: "5" });
    expect(opts.editorPanes).toBe(5);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("accepts valid editorSize value", () => {
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { "editor-size": "60" });
    expect(opts.editorSize).toBe(60);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("resolves font-size from project config layers", () => {
    mockReadKVFile.mockReturnValue(new Map([["font-size", "18"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.fontSize).toBe(18);
  });
});


describe("autoResize config resolution", () => {
  it("sets autoResize to false when auto-resize is 'false'", () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { "auto-resize": "false" });
    expect(opts.autoResize).toBe(false);
  });

  it("sets autoResize to true when auto-resize is 'true'", () => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { "auto-resize": "true" });
    expect(opts.autoResize).toBe(true);
  });
});


describe("config read caching (#31)", () => {
  it("reads machine config once via listConfig instead of per-key getConfig calls", () => {
    vi.mocked(listConfig).mockReturnValue(
      new Map([
        ["editor", "vim"],
        ["sidebar", "htop"],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    // listConfig should be called exactly once
    expect(listConfig).toHaveBeenCalledTimes(1);
  });

  it("correctly resolves values from cached config", () => {
    vi.mocked(listConfig).mockReturnValue(
      new Map([
        ["editor", "vim"],
        ["sidebar", "htop"],
        ["panes", "3"],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map<string, string>());

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});

    expect(opts.editor).toBe("vim");
    expect(opts.sidebarCommand).toBe("htop");
    expect(opts.editorPanes).toBe(3);
  });
});


describe("env var collection (#108)", () => {
  it("collects env vars from .summon project file", () => {
    mockReadKVFile.mockReturnValue(new Map([["env.NODE_ENV", "development"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.envVars).toEqual({ NODE_ENV: "development" });
  });

  it("merges CLI > project > machine env vars", () => {
    mockReadKVFile.mockReturnValue(new Map([["env.A", "project"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["env.A", "machine"], ["env.B", "machine"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", { env: ["A=cli"] });
    expect(result.envVars.A).toBe("cli"); // CLI wins
    expect(result.envVars.B).toBe("machine"); // machine fills in
  });

  it("rejects invalid env var key names from .summon", () => {
    mockReadKVFile.mockReturnValue(new Map([["env.VALID_KEY", "ok"], ["env.bad;key", "evil"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.envVars).toEqual({ VALID_KEY: "ok" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bad;key"));
    warnSpy.mockRestore();
  });

  it("returns empty object when no env vars configured", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.envVars).toEqual({});
  });

  it("warns on invalid env var key names from machine config (#618 BE-L2)", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["env.VALID_KEY", "ok"], ["env.bad;key", "evil"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.envVars).toEqual({ VALID_KEY: "ok" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`invalid env var key "bad;key" from machine config`));
    warnSpy.mockRestore();
  });

  it("rejects --env CLI key names with spaces", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveConfigWithMockedSummon("/tmp/workspace", { env: ["INVALID KEY=val"] });
    expect(result.envVars).not.toHaveProperty("INVALID KEY");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("INVALID KEY"));
    warnSpy.mockRestore();
  });

  it("accepts --env CLI key names that are valid", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveConfigWithMockedSummon("/tmp/workspace", { env: ["VALID_KEY=val"] });
    expect(result.envVars).toEqual({ VALID_KEY: "val" });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects --env CLI key names starting with a digit", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveConfigWithMockedSummon("/tmp/workspace", { env: ["123BAD=val"] });
    expect(result.envVars).not.toHaveProperty("123BAD");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("123BAD"));
    warnSpy.mockRestore();
  });

  // SE-M2 (#609): command-carrying env vars must be dropped with the "ignoring denylisted" warning
  it.each([
    ["GIT_SSH_COMMAND"],
    ["GIT_EXTERNAL_DIFF"],
    ["GIT_PAGER"],
    ["PAGER"],
    ["EDITOR"],
    ["VISUAL"],
    ["GIT_EDITOR"],
  ])("drops denylisted command-carrying env var %s from .summon project config (SE-M2)", (envKey) => {
    mockReadKVFile.mockReturnValue(new Map([[`env.${envKey}`, "malicious-cmd"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.envVars).not.toHaveProperty(envKey);
    // UX-M2: the one warning prefix; the text after it is unchanged.
    expect(warnSpy).toHaveBeenCalledWith(`summon: warning: ignoring denylisted env var key "${envKey}" from .summon file.\n`);
    warnSpy.mockRestore();
  });
});

describe("layout name validation from .summon files", () => {
  it("ignores path-traversal layout names from project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["layout", "../../etc/passwd"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockIsCustomLayout.mockReturnValue(true); // simulate file existing at traversed path

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    // Should NOT call isCustomLayout with the traversal name
    expect(mockIsCustomLayout).not.toHaveBeenCalled();
    // Should fall through to default layout (no base overrides)
    expect(result.treeLayout).toBeUndefined();
  });

  it("accepts valid layout names from project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["layout", "my-layout"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(new Map([["editor", "vim"]]));

    resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(mockIsCustomLayout).toHaveBeenCalledWith("my-layout");
  });
});


describe("resolveConfig with tree layout", () => {
  it("populates treeLayout when custom layout has tree= key", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "main | sidebar"],
        ["pane.main", "claude"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.treeLayout).toBeDefined();
    expect(result.treeLayout!.tree).toBeDefined();
    expect(result.treeLayout!.panes.get("main")).toBe("claude");
    expect(result.treeLayout!.panes.get("sidebar")).toBe("lazygit");
  });

  it("does not set treeLayout when custom layout has no tree= key", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["editor", "vim"],
        ["sidebar", "htop"],
        ["panes", "2"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "traditional"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.treeLayout).toBeUndefined();
    // Traditional custom layout applies to opts
    expect(result.opts.editor).toBe("vim");
    expect(result.opts.sidebarCommand).toBe("htop");
  });

  it("applies global options from custom layout with tree", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "claude"],
        ["pane.sidebar", "lazygit"],
        ["font-size", "16"],
        ["auto-resize", "false"],
        ["new-window", "true"],
        ["fullscreen", "true"],
        ["maximize", "true"],
        ["float", "true"],
        ["editor-size", "80"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.treeLayout).toBeDefined();
    expect(result.opts.fontSize).toBe(16);
    expect(result.opts.autoResize).toBe(false);
    expect(result.opts.newWindow).toBe(true);
    expect(result.opts.fullscreen).toBe(true);
    expect(result.opts.maximize).toBe(true);
    expect(result.opts.float).toBe(true);
    expect(result.opts.editorSize).toBe(80);
  });

  it("CLI overrides apply on top of tree layout global options", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "claude"],
        ["pane.sidebar", "lazygit"],
        ["fullscreen", "false"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", { fullscreen: "true" });
    expect(result.treeLayout).toBeDefined();
    expect(result.opts.fullscreen).toBe(true);
  });
});

describe("custom layout with null readCustomLayout (#168)", () => {
  it("returns empty base when readCustomLayout returns null", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(null);
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    mockReadKVFile.mockReturnValue(new Map([["layout", "my-layout"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    // Should not crash and should fall through to defaults
    expect(result.treeLayout).toBeUndefined();
    expect(result.opts.editor).toBe("vim"); // from machine config
  });
});


describe("project config log (#146)", () => {
  it("logs which .summon file is being loaded to stdout", () => {
    mockReadKVFile.mockImplementation((path: string) => {
      if (path === "/tmp/workspace/.summon") {
        return new Map([["editor", "vim"]]);
      }
      return new Map();
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    const logMessages = logSpy.mock.calls.map((c) => c[0] as string);
    const configMsg = logMessages.find((m) => m.includes(".summon"));
    expect(configMsg).toBeDefined();
    expect(configMsg).toContain("/tmp/workspace/.summon");
    logSpy.mockRestore();
  });

  it("does NOT log .summon path when no project config exists", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    const logMessages = logSpy.mock.calls.map((c) => c[0] as string);
    const configMsg = logMessages.find((m) => m.includes(".summon"));
    expect(configMsg).toBeUndefined();
    logSpy.mockRestore();
  });

  it("does not show trust advisory — trust gate replaces the old advisory tip", () => {
    // The old "Review .summon files before use in untrusted directories" tip has been
    // replaced by the trust gate mechanism (SE-H1). No advisory is shown; instead,
    // untrusted .summon files are blocked entirely via assertTrusted().
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockReadKVFile.mockImplementation((path: string) => {
      if (path === "/tmp/workspace/.summon") {
        return new Map([["editor", "vim"]]);
      }
      return new Map();
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const trustMsg = warnMessages.find((m) => m.includes("Review .summon"));
    expect(trustMsg).toBeUndefined();
    warnSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("does NOT show trust advisory in non-TTY mode", () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    mockReadKVFile.mockImplementation((path: string) => {
      if (path === "/tmp/workspace/.summon") {
        return new Map([["editor", "vim"]]);
      }
      return new Map();
    });
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const trustMsg = warnMessages.find((m) => m.includes("Review .summon"));
    expect(trustMsg).toBeUndefined();
    warnSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("does NOT show trust advisory when no .summon file exists", () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    resolveConfigWithMockedSummon("/tmp/workspace", {});

    const warnMessages = warnSpy.mock.calls.map((c) => c[0] as string);
    const trustMsg = warnMessages.find((m) => m.includes("Review .summon"));
    expect(trustMsg).toBeUndefined();
    warnSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
  });
});


describe("optsToConfigMap", () => {
  it("returns empty map for empty opts", () => {
    const result = optsToConfigMap({});
    expect(result.size).toBe(0);
  });

  it("returns empty map for opts with only undefined values", () => {
    const result = optsToConfigMap({ editor: undefined, sidebarCommand: undefined });
    expect(result.size).toBe(0);
  });

  it("maps all fields when set", () => {
    const result = optsToConfigMap({
      editor: "vim",
      sidebarCommand: "lazygit",
      editorPanes: 3,
      editorSize: 60,
      shell: "zsh",
      autoResize: true,
      fontSize: 14,
      newWindow: true,
      fullscreen: true,
      maximize: true,
      float: true,
    });
    expect(result.get("editor")).toBe("vim");
    expect(result.get("sidebar")).toBe("lazygit");
    expect(result.get("panes")).toBe("3");
    expect(result.get("editor-size")).toBe("60");
    expect(result.get("shell")).toBe("zsh");
    expect(result.get("auto-resize")).toBe("true");
    expect(result.get("font-size")).toBe("14");
    expect(result.get("new-window")).toBe("true");
    expect(result.get("fullscreen")).toBe("true");
    expect(result.get("maximize")).toBe("true");
    expect(result.get("float")).toBe("true");
  });

  it("excludes null fontSize", () => {
    const result = optsToConfigMap({ fontSize: null });
    expect(result.has("font-size")).toBe(false);
  });

  it("excludes boolean flags when false", () => {
    const result = optsToConfigMap({
      newWindow: false,
      fullscreen: false,
      maximize: false,
      float: false,
    });
    expect(result.has("new-window")).toBe(false);
    expect(result.has("fullscreen")).toBe(false);
    expect(result.has("maximize")).toBe(false);
    expect(result.has("float")).toBe(false);
  });

  it("includes fontSize when set to a number", () => {
    const result = optsToConfigMap({ fontSize: 18.5 });
    expect(result.get("font-size")).toBe("18.5");
  });

  it("includes new-tab when newTab=true", () => {
    const result = optsToConfigMap({ newTab: true });
    expect(result.get("new-tab")).toBe("true");
  });

  it("excludes new-tab when newTab is false", () => {
    const result = optsToConfigMap({ newTab: false });
    expect(result.has("new-tab")).toBe(false);
  });

});


describe("tree layout + project CWD merge (#185)", () => {
  it("merges per-pane cwds from project .summon file into tree layout", () => {
    // Custom layout defines a tree with pane CWDs in the layout itself
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "vim"],
        ["pane.sidebar", "lazygit"],
        ["pane.editor.cwd", "src"],
      ]),
    );
    // Project .summon overrides sidebar CWD
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "mywork"],
        ["pane.sidebar.cwd", "tests"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});

    expect(result.treeLayout).toBeDefined();
    expect(result.treeLayout!.paneCwds).toBeDefined();
    // Layout-defined CWD preserved
    expect(result.treeLayout!.paneCwds!.get("editor")).toBe("src");
    // Project CWD merged in
    expect(result.treeLayout!.paneCwds!.get("sidebar")).toBe("tests");
  });

  it("project pane CWD overrides layout-defined CWD for the same pane", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "vim"],
        ["pane.sidebar", "lazygit"],
        ["pane.editor.cwd", "src"],
      ]),
    );
    // Project overrides editor CWD
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "mywork"],
        ["pane.editor.cwd", "lib"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});

    expect(result.treeLayout).toBeDefined();
    expect(result.treeLayout!.paneCwds).toBeDefined();
    // Project CWD overrides the layout's CWD
    expect(result.treeLayout!.paneCwds!.get("editor")).toBe("lib");
  });

  it("returns no paneCwds when neither layout nor project defines them", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "vim"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    mockReadKVFile.mockReturnValue(new Map([["layout", "mywork"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});

    expect(result.treeLayout).toBeDefined();
    expect(result.treeLayout!.paneCwds).toBeUndefined();
  });

  it("adds project paneCwds to tree layout that has no layout-defined CWDs", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "vim"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    // Project defines CWDs even though layout has none
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "mywork"],
        ["pane.editor.cwd", "app"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});

    expect(result.treeLayout).toBeDefined();
    expect(result.treeLayout!.paneCwds).toBeDefined();
    expect(result.treeLayout!.paneCwds!.get("editor")).toBe("app");
  });
});


describe("BE-M2 (#593): cwd containment validated at ingestion in resolveConfig", () => {
  it("throws when project .summon pane cwd escapes targetDir via path traversal", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "vim"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    // .summon file tries to escape targetDir via ../../
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "mywork"],
        ["pane.editor.cwd", "../../etc"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    expect(() => resolveConfigWithMockedSummon("/tmp/workspace", {})).toThrow(/outside project directory/);
  });

  it("allows project .summon pane cwd that is a subdirectory of targetDir", () => {
    mockIsCustomLayout.mockReturnValue(true);
    mockReadCustomLayout.mockReturnValue(
      new Map([
        ["tree", "editor | sidebar"],
        ["pane.editor", "vim"],
        ["pane.sidebar", "lazygit"],
      ]),
    );
    mockReadKVFile.mockReturnValue(
      new Map([
        ["layout", "mywork"],
        ["pane.editor.cwd", "src"],
      ]),
    );
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const result = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(result.treeLayout!.paneCwds!.get("editor")).toBe("src");
  });
});


describe("R5: maximize/float config layering coverage (#190)", () => {
  it("resolves maximize from project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["maximize", "true"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.maximize).toBe(true);
  });

  it("resolves float from project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["float", "true"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.float).toBe(true);
  });

  it("CLI maximize overrides project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["maximize", "false"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { maximize: "true" });
    expect(opts.maximize).toBe(true);
  });

  it("CLI float overrides project config", () => {
    mockReadKVFile.mockReturnValue(new Map([["float", "false"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", { float: "true" });
    expect(opts.float).toBe(true);
  });

  it("machine config provides maximize when no project config", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["maximize", "true"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.maximize).toBe(true);
  });

  it("machine config provides float when no project config", () => {
    mockReadKVFile.mockReturnValue(new Map());
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["float", "true"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.float).toBe(true);
  });

  it("project config overrides machine config for maximize", () => {
    mockReadKVFile.mockReturnValue(new Map([["maximize", "true"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["maximize", "false"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.maximize).toBe(true);
  });

  it("project config overrides machine config for float", () => {
    mockReadKVFile.mockReturnValue(new Map([["float", "true"]]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], ["float", "false"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.float).toBe(true);
  });
});


describe("AR-M1: secondary-editor round-trips through optsToConfigMap (#543)", () => {
  it("optsToConfigMap includes secondary-editor when set", () => {
    const map = optsToConfigMap({ secondaryEditor: "btop" });
    expect(map.get("secondary-editor")).toBe("btop");
  });

  it("optsToConfigMap omits secondary-editor when not set", () => {
    const map = optsToConfigMap({});
    expect(map.has("secondary-editor")).toBe(false);
  });

  it("resolveConfig reads secondary-editor from project config into opts", () => {
    mockReadKVFile.mockReturnValue(new Map([
      ["secondary-editor", "btop"],
    ]));
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"]]));

    const { opts } = resolveConfigWithMockedSummon("/tmp/workspace", {});
    expect(opts.secondaryEditor).toBe("btop");
  });
});

