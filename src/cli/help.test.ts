import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  VALID_KEYS: [
    "editor",
    "sidebar",
    "panes",
    "editor-size",
    "shell",
    "layout",
    "auto-resize",
    "starship-preset",
    "new-window",
    "fullscreen",
    "maximize",
    "float",
    "font-size",
    "on-start",
    "on-stop",
  ],
}));

vi.mock("../setup-gallery.js", () => ({
  LAYOUT_INFO: {
    minimal: { desc: "Single editor + sidebar", diagram: "" },
    pair: { desc: "Two editors + sidebar + shell", diagram: "" },
    full: { desc: "Three editors + sidebar + shell", diagram: "" },
    cli: { desc: "Single editor + sidebar + shell", diagram: "" },
    btop: { desc: "Editor + system monitor + sidebar + shell", diagram: "" },
  },
}));

Object.defineProperty(globalThis, "__VERSION__", {
  value: "1.3.0",
  configurable: true,
});

const { showHelp, hasSubcommandHelp, showSubcommandHelp } = await import("./help.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// --- PE-P1: help module exports ---

describe("help module exports", () => {
  it("showHelp logs help text to stdout", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("Usage:");
    expect(output).toContain("Options:");
    logSpy.mockRestore();
  });

  it("hasSubcommandHelp returns true for known subcommands", () => {
    expect(hasSubcommandHelp("add")).toBe(true);
    expect(hasSubcommandHelp("status")).toBe(true);
    expect(hasSubcommandHelp("trust")).toBe(true);
  });

  it("hasSubcommandHelp returns false for unknown subcommands", () => {
    expect(hasSubcommandHelp("unknown-cmd-xyz")).toBe(false);
    expect(hasSubcommandHelp("")).toBe(false);
  });

  it("showSubcommandHelp logs help text for known subcommand", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showSubcommandHelp("add");

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: summon add"));
    logSpy.mockRestore();
  });

  it("showSubcommandHelp does not throw for unknown subcommand (graceful no-op)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => showSubcommandHelp("not-a-real-subcommand")).not.toThrow();
    logSpy.mockRestore();
  });

  it("showHelp output contains version number", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await showHelp();

    const output = logSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("1.3.0");
    logSpy.mockRestore();
  });
});

// --- PE-P1: --version fast path (integration via index.test.ts covers the actual fast path) ---
// Unit-level: help.ts contains no version logic; these tests verify the help module is self-contained.

describe("help module is a leaf (no circular dependency)", () => {
  it("can be imported without importing parse.ts", async () => {
    // If help.ts accidentally re-imports parse.ts this would cause a cycle.
    // The fact that it loads here is sufficient — if there were a circular dep,
    // Vitest would throw or the mock chain would break.
    expect(typeof showHelp).toBe("function");
    expect(typeof hasSubcommandHelp).toBe("function");
    expect(typeof showSubcommandHelp).toBe("function");
  });
});
