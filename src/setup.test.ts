import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process for tool detection (resolveCommand in utils.ts uses execFileSync)
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock readline for interactive input
const mockQuestion = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => mockQuestion(_q, cb),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
  emitKeypressEvents: vi.fn(),
}));

// Mock config for runSetup
const mockSetConfig = vi.fn();
const mockIsValidLayoutName = vi.fn((_name: string) => true);
const mockIsCustomLayout = vi.fn((_name: string) => false);
const mockSaveCustomLayout = vi.fn();
vi.mock("./config.js", () => ({
  setConfig: (key: string, value: string) => mockSetConfig(key, value),
  listConfig: vi.fn(() => new Map<string, string>()),
  CONFIG_DIR: "/mock/.config/summon",
  isValidLayoutName: (name: string) => mockIsValidLayoutName(name),
  isCustomLayout: (name: string) => mockIsCustomLayout(name),
  saveCustomLayout: (name: string, entries: Map<string, string>) => mockSaveCustomLayout(name, entries),
}));

// Mock starship for setup wizard
const mockIsStarshipInstalled = vi.fn(() => false);
const mockListStarshipPresets = vi.fn((): string[] => []);
vi.mock("./starship.js", () => ({
  isStarshipInstalled: () => mockIsStarshipInstalled(),
  listStarshipPresets: () => mockListStarshipPresets(),
  resetStarshipCache: vi.fn(),
}));

// Mock fs for validateSetup's Ghostty check
const mockExistsSync = vi.fn((_path: string) => false);
vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
}));

// Import test-only utils directly from utils.js (not re-exported through setup.js)
const { resolveCommand: resolveCommandPath, SAFE_COMMAND_RE } = await import("./utils.js");

// Import after mocks
const {
  detectTools,
  numberedSelect,
  textInput,
  confirm,
  bold,
  dim,
  green,
  yellow,
  cyan,
  printSection,
  magenta,
  brightCyan,
  WIZARD_MASCOT,
  SUMMON_LOGO,
  TIPS,
  getRandomTip,
  // Phase 2 additions:
  EDITOR_CATALOG,
  SIDEBAR_CATALOG,
  LAYOUT_INFO,
  selectLayout,
  selectToolFromCatalog,
  selectShell,
  selectStarshipPreset,
  validateSetup,
  checkAndRecoverAccessibility,
  runSetup,
  hexToRgb,
  colorSwatch,
  // Phase 5 additions:
  gridToTree,
  renderLayoutPreview,
  runLayoutBuilder,
  findClosestCommand,
  // Visual layout builder additions:
  GRID_TEMPLATES,
  renderMiniPreview,
  renderTemplateGallery,
  selectGridTemplate,
  buildPartialGrid,
  // Phase 2 — in-place preview:
  ansiUp,
  ansiClearDown,
  ansiSyncStart,
  ansiSyncEnd,
  PreviewRenderer,
  // Phase 3 — arrow-key grid builder:
  createGridState,
  applyGridAction,
  renderGridBuilderPreview,
  renderGridBuilderHints,
  runGridBuilder,
  // #154 — truncation indicator:
  centerLabel,
  visibleLength,
} = await import("./setup.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockImplementation(() => "/usr/bin/stub\n");
});

describe("resolveCommandPath", () => {
  it("returns path when command is found", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/vim\n");
    expect(resolveCommandPath("vim")).toBe("/usr/bin/vim");
  });

  it("returns null when command is not found", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(resolveCommandPath("nonexistent")).toBeNull();
  });

  it("trims trailing newline from path", () => {
    mockExecFileSync.mockReturnValue("/usr/local/bin/nvim\n");
    expect(resolveCommandPath("nvim")).toBe("/usr/local/bin/nvim");
  });
});

describe("detectTools", () => {
  it("marks available tools with available: true", async () => {
    mockExecFileSync.mockReturnValue("/usr/bin/vim\n");
    const result = await detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result[0]!.available).toBe(true);
  });

  it("marks missing tools with available: false", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = await detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result[0]!.available).toBe(false);
  });

  it("handles empty catalog", async () => {
    expect(await detectTools([])).toEqual([]);
  });

  it("handles all-missing catalog", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const catalog = [
      { cmd: "a", name: "A", desc: "a" },
      { cmd: "b", name: "B", desc: "b" },
    ];
    const result = await detectTools(catalog);
    expect(result.every((t) => !t.available)).toBe(true);
  });

  it("handles all-available catalog", async () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    const catalog = [
      { cmd: "a", name: "A", desc: "a" },
      { cmd: "b", name: "B", desc: "b" },
    ];
    const result = await detectTools(catalog);
    expect(result.every((t) => t.available)).toBe(true);
  });
});

describe("numberedSelect", () => {
  it("returns index for valid selection", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("2"),
    );
    const options = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await numberedSelect(options, "Pick: ");
    expect(result).toBe(1); // 0-based index for selection "2"
  });

  it("uses default when input is empty", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    const options = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await numberedSelect(options, "Pick: ", 1);
    expect(result).toBe(1);
  });

  it("re-prompts on out-of-range input", async () => {
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("5"); // out of range
      else cb("1");
    });
    const options = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await numberedSelect(options, "Pick: ");
    expect(result).toBe(0);
    expect(callCount).toBe(2);
  });

  it("re-prompts on non-numeric input", async () => {
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("abc");
      else cb("1");
    });
    const options = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];
    const result = await numberedSelect(options, "Pick: ");
    expect(result).toBe(0);
    expect(callCount).toBe(2);
  });

  it("handles single option", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    const options = [{ label: "Only", value: "only" }];
    const result = await numberedSelect(options, "Pick: ");
    expect(result).toBe(0);
  });

  it("prints feedback message on invalid input before re-prompting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("abc"); // invalid
      else cb("1");
    });
    const options = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];
    await numberedSelect(options, "Pick: ");
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Invalid selection"))).toBe(true);
    expect(allOutput.some((s) => s.includes("1") && s.includes("2"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("textInput", () => {
  it("returns user input", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("hello"),
    );
    const result = await textInput("Name: ");
    expect(result).toBe("hello");
  });

  it("returns default when input is empty", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    const result = await textInput("Name: ", "world");
    expect(result).toBe("world");
  });

  it("trims whitespace from input", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("  hello  "),
    );
    const result = await textInput("Name: ");
    expect(result).toBe("hello");
  });
});

describe("confirm", () => {
  it("returns true for 'y'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("y"),
    );
    expect(await confirm("OK?")).toBe(true);
  });

  it("returns true for 'yes'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("yes"),
    );
    expect(await confirm("OK?")).toBe(true);
  });

  it("returns true for empty input (default yes)", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    expect(await confirm("OK?")).toBe(true);
  });

  it("returns false for 'n'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("n"),
    );
    expect(await confirm("OK?")).toBe(false);
  });

  it("returns false for 'no'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("no"),
    );
    expect(await confirm("OK?")).toBe(false);
  });

  it("is case-insensitive", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("YES"),
    );
    expect(await confirm("OK?")).toBe(true);
  });

  it("prints feedback message on invalid input before re-prompting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("maybe"); // invalid
      else cb("y");
    });
    await confirm("OK?");
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Please enter y or n"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("ANSI helpers", () => {
  it("bold wraps string in ANSI bold codes when color enabled", () => {
    // In test env, process.stdout.isTTY may be falsy, so bold may return plain
    // We test the function exists and returns a string containing the input
    const result = bold("test");
    expect(result).toContain("test");
  });

  it("returns plain string when NO_COLOR is set", () => {
    // Since useColor is set at module load and tests run in non-TTY,
    // the ANSI functions should return plain strings
    expect(bold("test")).toBe("test");
    expect(dim("test")).toBe("test");
    expect(green("test")).toBe("test");
    expect(yellow("test")).toBe("test");
    expect(cyan("test")).toBe("test");
  });

  it("magenta returns plain string in non-TTY", () => {
    expect(magenta("test")).toBe("test");
  });

  it("brightCyan returns plain string in non-TTY", () => {
    expect(brightCyan("test")).toBe("test");
  });
});

describe("WIZARD_MASCOT", () => {
  it("has 6 lines", () => {
    expect(WIZARD_MASCOT).toHaveLength(6);
  });

  it("each line is <= 12 visual characters", () => {
    for (const line of WIZARD_MASCOT) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });
});

describe("SUMMON_LOGO", () => {
  it("has 3 lines", () => {
    expect(SUMMON_LOGO).toHaveLength(3);
  });

  it("each line is <= 22 characters", () => {
    for (const line of SUMMON_LOGO) {
      expect(line.length).toBeLessThanOrEqual(22);
    }
  });

  it("all lines are the same width", () => {
    const widths = SUMMON_LOGO.map((l) => l.length);
    expect(new Set(widths).size).toBe(1);
  });
});

describe("TIPS", () => {
  it("has at least 5 tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(5);
  });

  it("all tips are under 80 characters", () => {
    for (const tip of TIPS) {
      expect(tip.length).toBeLessThan(80);
    }
  });

  it("no duplicate tips", () => {
    expect(new Set(TIPS).size).toBe(TIPS.length);
  });

  it("no tips are empty strings", () => {
    for (const tip of TIPS) {
      expect(tip.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("getRandomTip", () => {
  it("returns a string from the TIPS array", () => {
    const tip = getRandomTip();
    expect(TIPS).toContain(tip);
  });
});

describe("printSection", () => {
  it("prints a section header with dashes and title", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    printSection("Editor");

    const output = logSpy.mock.calls[0]![0] as string;
    expect(output).toContain("Editor");
    expect(output).toContain("──");

    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 Tests
// ---------------------------------------------------------------------------

describe("EDITOR_CATALOG", () => {
  it("contains at least 5 editor entries", () => {
    expect(EDITOR_CATALOG.length).toBeGreaterThanOrEqual(5);
  });

  it("each entry has cmd, name, desc fields", () => {
    for (const entry of EDITOR_CATALOG) {
      expect(entry.cmd).toBeTypeOf('string');
      expect(entry.name).toBeTypeOf('string');
      expect(entry.desc).toBeTypeOf('string');
    }
  });

  it("all cmd values match SAFE_COMMAND_RE", () => {
    for (const entry of EDITOR_CATALOG) {
      expect(SAFE_COMMAND_RE.test(entry.cmd)).toBe(true);
    }
  });
});

describe("SIDEBAR_CATALOG", () => {
  it("contains at least 3 sidebar entries", () => {
    expect(SIDEBAR_CATALOG.length).toBeGreaterThanOrEqual(3);
  });

  it("each entry has cmd, name, desc fields", () => {
    for (const entry of SIDEBAR_CATALOG) {
      expect(entry.cmd).toBeTypeOf('string');
      expect(entry.name).toBeTypeOf('string');
      expect(entry.desc).toBeTypeOf('string');
    }
  });
});

describe("LAYOUT_INFO", () => {
  it("has entries for all 5 presets", () => {
    expect(Object.keys(LAYOUT_INFO)).toEqual(
      expect.arrayContaining(["minimal", "pair", "full", "cli", "btop"]),
    );
    expect(Object.keys(LAYOUT_INFO)).toHaveLength(5);
  });

  it("each entry has desc and diagram fields", () => {
    for (const [, info] of Object.entries(LAYOUT_INFO)) {
      expect(info.desc).toBeTypeOf('string');
      expect(info.diagram).toBeTypeOf('string');
      expect(info.diagram).toContain("┌");
    }
  });
});

describe("findClosestCommand", () => {
  it("finds exact match", () => {
    expect(findClosestCommand("lazygit", ["vim", "lazygit", "btop"])).toBe("lazygit");
  });

  it("finds close typo (missing letter)", () => {
    expect(findClosestCommand("lzgit", ["vim", "lazygit", "btop"])).toBe("lazygit");
  });

  it("finds close typo (swapped letters)", () => {
    expect(findClosestCommand("lazygti", ["vim", "lazygit", "btop"])).toBe("lazygit");
  });

  it("finds close typo (extra letter)", () => {
    expect(findClosestCommand("lazyygit", ["vim", "lazygit", "btop"])).toBe("lazygit");
  });

  it("returns null when no close match (distance > 3)", () => {
    expect(findClosestCommand("something", ["vim", "lazygit", "btop"])).toBeNull();
  });

  it("returns null for empty known list", () => {
    expect(findClosestCommand("vim", [])).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(findClosestCommand("VIM", ["vim", "nano"])).toBe("vim");
  });

  it("picks closest when multiple candidates", () => {
    expect(findClosestCommand("btop", ["btop", "htop"])).toBe("btop");
  });
});

describe("selectLayout", () => {
  it("returns preset name for valid selection", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    const result = await selectLayout();
    expect(result).toBe("minimal");
    logSpy.mockRestore();
  });

  it("returns 'pair' for default (empty input)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    const result = await selectLayout();
    expect(result).toBe("pair");
    logSpy.mockRestore();
  });
});

describe("selectToolFromCatalog", () => {
  it("returns detected tool when selected by number", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // All tools detected (default mock returns path)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    const result = await selectToolFromCatalog(
      [
        { cmd: "vim", name: "Vim", desc: "Editor" },
        { cmd: "nano", name: "Nano", desc: "Simple" },
      ],
      "Editor",
    );
    expect(result).toBe("vim");
    logSpy.mockRestore();
  });

  it("returns custom command when 'c' is selected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("c");
      else cb("my-editor");
    });
    const result = await selectToolFromCatalog(
      [{ cmd: "vim", name: "Vim", desc: "Editor" }],
      "Editor",
    );
    expect(result).toBe("my-editor");
    logSpy.mockRestore();
  });

  it("shows only detected tools", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Make "nano" available but "vim" not
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "nano") return "/usr/bin/nano\n";
      throw new Error("not found");
    });
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    const result = await selectToolFromCatalog(
      [
        { cmd: "vim", name: "Vim", desc: "Editor" },
        { cmd: "nano", name: "Nano", desc: "Simple" },
      ],
      "Editor",
    );
    // First (and only) listed option should be nano (detected)
    expect(result).toBe("nano");
    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    // nano should appear in the tool listing
    expect(allOutput.some((s) => s.includes("nano"))).toBe(true);
    // vim should NOT appear in the tool listing (it's unavailable)
    // Use a pattern that matches the numbered list format, not the describe block
    expect(
      allOutput.some((s) => s.includes("vim") && s.includes("Editor")),
    ).toBe(false);
    logSpy.mockRestore();
  });

  it("defaults to first detected tool", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Make "nano" available but "vim" not
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "nano") return "/usr/bin/nano\n";
      throw new Error("not found");
    });
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    const result = await selectToolFromCatalog(
      [
        { cmd: "vim", name: "Vim", desc: "Editor" },
        { cmd: "nano", name: "Nano", desc: "Simple" },
      ],
      "Editor",
    );
    expect(result).toBe("nano");
    logSpy.mockRestore();
  });

  it("falls through to custom input when no tools detected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("my-tool"),
    );
    const result = await selectToolFromCatalog(
      [
        { cmd: "vim", name: "Vim", desc: "Editor" },
        { cmd: "nano", name: "Nano", desc: "Simple" },
      ],
      "Editor",
    );
    expect(result).toBe("my-tool");
    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("No known tools detected")),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it("prints feedback message on invalid input before re-prompting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("xyz"); // invalid
      else cb("1");
    });
    const result = await selectToolFromCatalog(
      [
        { cmd: "vim", name: "Vim", desc: "Editor" },
        { cmd: "nano", name: "Nano", desc: "Simple" },
      ],
      "Editor",
    );
    expect(result).toBe("vim");
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Invalid selection"))).toBe(true);
    logSpy.mockRestore();
  });

  it("does not display unavailable tools in the list", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Make "nano" available but "vim" not
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "nano") return "/usr/bin/nano\n";
      throw new Error("not found");
    });
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    await selectToolFromCatalog(
      [
        { cmd: "vim", name: "Vim", desc: "Editor" },
        { cmd: "nano", name: "Nano", desc: "Simple" },
      ],
      "Editor",
    );
    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    // nano should appear in the numbered list
    expect(allOutput.some((s) => s.includes("nano"))).toBe(true);
    // vim should NOT appear in any numbered tool listing line
    expect(
      allOutput.some((s) => s.includes("vim") && /\d\)/.test(s)),
    ).toBe(false);
    // Custom command option should always be present
    expect(allOutput.some((s) => s.includes("Custom command"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("selectShell", () => {
  it("returns 'true' for Shell selection", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    const result = await selectShell();
    expect(result).toBe("true");
    logSpy.mockRestore();
  });

  it("returns 'false' for Disabled selection", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("2"),
    );
    const result = await selectShell();
    expect(result).toBe("false");
    logSpy.mockRestore();
  });

  it("returns command string for Custom selection", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("3"); // Select "Command"
      else cb("npm run dev"); // Enter custom command
    });
    const result = await selectShell();
    expect(result).toBe("npm run dev");
    logSpy.mockRestore();
  });

  it("defaults to 'true' (Shell)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    const result = await selectShell();
    expect(result).toBe("true");
    logSpy.mockRestore();
  });

  it("re-prompts when custom command input is empty", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("3"); // Select "Command"
      else if (callCount === 2) cb(""); // Empty input — should re-prompt
      else if (callCount === 3) cb("  "); // Whitespace-only — should re-prompt
      else cb("npm run dev"); // Valid input
    });
    const result = await selectShell();
    expect(result).toBe("npm run dev");
    expect(callCount).toBe(4);
    logSpy.mockRestore();
  });

  it("uses 'plain shell' terminology in option label", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    await selectShell();
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should say "plain shell", NOT "Plain terminal"
    expect(allOutput.some((s) => s.includes("plain shell"))).toBe(true);
    expect(allOutput.some((s) => s.toLowerCase().includes("plain terminal"))).toBe(false);
    logSpy.mockRestore();
  });
});

describe("validateSetup", () => {
  it("returns no warnings when all tools are available", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(true);
    const result = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "true",
    });
    expect(result.warnings).toHaveLength(0);
    expect(result.ghosttyFound).toBe(true);
  });

  it("returns warning for missing editor", () => {
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "vim") throw new Error("not found");
      return "/usr/bin/stub\n";
    });
    mockExistsSync.mockReturnValue(true);
    const result = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "true",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.key).toBe("editor");
    expect(result.warnings[0]!.cmd).toBe("vim");
  });

  it("returns warning for missing sidebar", () => {
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "lazygit")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });
    mockExistsSync.mockReturnValue(true);
    const result = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "true",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.key).toBe("sidebar");
  });

  it("returns warning for missing shell command", () => {
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "npm")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });
    mockExistsSync.mockReturnValue(true);
    const result = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "npm run dev",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.key).toBe("shell");
    expect(result.warnings[0]!.cmd).toBe("npm");
  });

  it("skips validation for shell='true' and shell='false'", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(true);
    const trueResult = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "true",
    });
    const falseResult = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "false",
    });
    expect(trueResult.warnings).toHaveLength(0);
    expect(falseResult.warnings).toHaveLength(0);
  });

  it("includes install hint when available", () => {
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "lazygit")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });
    mockExistsSync.mockReturnValue(true);
    const result = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "true",
    });
    expect(result.warnings[0]!.installHint).toBe("brew install lazygit");
  });

  it("reports ghosttyFound correctly", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(false);
    const result = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      shell: "true",
    });
    expect(result.ghosttyFound).toBe(false);
  });

});

describe("printValidation", () => {
  // Import printValidation — it's not exported, so we test via runSetup side-effects.
  // We test the display branches via validateSetup + runSetup integration.

  it("prints warning for missing tools with install hints", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Make ALL tools missing so that regardless of selection, the chosen tool is missing
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    mockExistsSync.mockReturnValue(true); // Ghostty found

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1");
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should show the missing tool warning
    expect(allOutput.some((s) => s.includes("not found"))).toBe(true);
    // Should show install hint message
    expect(
      allOutput.some((s) => s.includes("Some tools are missing")),
    ).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints Ghostty not found warning", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n"); // all tools found
    mockExistsSync.mockReturnValue(false); // Ghostty NOT found

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1");
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some(
        (s) => s.includes("Ghostty") && s.includes("not found"),
      ),
    ).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints all tools available when none missing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(true); // Ghostty found

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1");
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("All selected tools are available")),
    ).toBe(true);
    expect(
      allOutput.some((s) => s.includes("Ghostty") && s.includes("found") && !s.includes("not found")),
    ).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

});

describe("checkAndRecoverAccessibility", () => {
  it("returns true when accessibility is already granted", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");

    const result = await checkAndRecoverAccessibility();

    expect(result).toBe(true);
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("Accessibility permission granted")),
    ).toBe(true);

    logSpy.mockRestore();
  });

  it("returns false when not granted and user declines to open settings", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") throw new Error("assistive access (-1719)");
      return "/usr/bin/stub\n";
    });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("n");
      else cb("");
    });

    const result = await checkAndRecoverAccessibility();

    expect(result).toBe(false);
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("Accessibility permission not granted")),
    ).toBe(true);
    expect(
      allOutput.some((s) => s.includes("System Events")),
    ).toBe(true);

    logSpy.mockRestore();
  });

  it("returns true when user opens settings and re-check passes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let osascriptCallCount = 0;
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") {
        osascriptCallCount++;
        if (osascriptCallCount <= 1) throw new Error("assistive access (-1719)");
        return "Finder\n"; // re-check passes
      }
      if (bin === "open") return ""; // openAccessibilitySettings
      return "/usr/bin/stub\n";
    });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb(""); // Press Enter
    });

    const result = await checkAndRecoverAccessibility();

    expect(result).toBe(true);
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("Accessibility permission granted!")),
    ).toBe(true);

    logSpy.mockRestore();
  });

  it("returns false when user opens settings but re-check still fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockImplementation((bin: string) => {
      if (bin === "osascript") throw new Error("assistive access (-1719)");
      if (bin === "open") return "";
      return "/usr/bin/stub\n";
    });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb(""); // Press Enter
    });

    const result = await checkAndRecoverAccessibility();

    expect(result).toBe(false);
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("Still not detected")),
    ).toBe(true);

    logSpy.mockRestore();
  });
});

describe("runSetup", () => {
  it("saves all settings to config on completion", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      // Confirm prompt contains [Y/n]
      if (q.includes("[Y/n]")) {
        cb("y");
      } else {
        cb("1"); // Select first option for all selection prompts
      }
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    expect(mockSetConfig).toHaveBeenCalledWith("layout", "minimal"); // "1" selects minimal
    expect(mockSetConfig).toHaveBeenCalledWith("editor", expect.any(String));
    expect(mockSetConfig).toHaveBeenCalledWith("sidebar", expect.any(String));
    expect(mockSetConfig).toHaveBeenCalledWith("shell", expect.any(String));

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("skips shell step for minimal layout", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1"); // First option (minimal for layout)
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    // Shell should be "false" for minimal
    expect(mockSetConfig).toHaveBeenCalledWith("shell", "false");

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints error and exits when stdin is not a TTY", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      writable: true,
    });

    await runSetup();

    const allErrors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(
      allErrors.some((s) => s.includes("interactive terminal")),
    ).toBe(true);
    expect(
      allErrors.some((s) => s.includes("summon set")),
    ).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("loops back to layout selection when user declines to save", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let confirmCount = 0;
    let layoutSelectCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) {
        confirmCount++;
        if (confirmCount === 1) cb("n"); // decline first time
        else cb("y"); // accept second time
      } else if (_q.includes("Select [1-")) {
        layoutSelectCount++;
        cb("1");
      } else {
        cb("1");
      }
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    // Layout selection should happen twice (once per loop iteration)
    expect(layoutSelectCount).toBeGreaterThanOrEqual(2);
    // Confirm should be called twice
    expect(confirmCount).toBe(2);
    // Settings should only be saved once (on the second, accepted pass)
    expect(mockSetConfig).toHaveBeenCalledTimes(4);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints dim message when minimal layout skips shell", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1"); // First option (minimal for layout)
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("Minimal layout has no shell pane")),
    ).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints wizard mascot art in welcome screen", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1");
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("█"))).toBe(true);
    expect(allOutput.some((s) => s.includes("◠"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints a tip line in welcome screen", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1");
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Tip:"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints 'enabled (plain shell)' in summary for non-minimal layout with shell=true", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(true);

    // runSetup question sequence for pair layout:
    // 1. selectLayout (numberedSelect) → "Select [1-6]" → "2" (pair)
    // 2. selectEditor (selectToolFromCatalog) → "Select (default:" → "1"
    // 3. selectSidebar (selectToolFromCatalog) → "Select (default:" → "1"
    // 4. selectShell (numberedSelect) → "Select [1-3]" → "1" (plain shell)
    // 5. confirm → "[Y/n]" → "y"
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) {
        cb("y");
      } else if (_q.includes("Select [1-6]")) {
        cb("2"); // pair layout
      } else if (_q.includes("Select [1-3]")) {
        cb("1"); // plain shell
      } else {
        cb("1"); // editor and sidebar selections
      }
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // printSummary should show "enabled" and "plain shell" for shell="true"
    expect(
      allOutput.some((s) => s.includes("enabled") && s.includes("plain shell")),
    ).toBe(true);
    // Shell config should be saved as "true"
    expect(mockSetConfig).toHaveBeenCalledWith("shell", "true");

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints custom shell command in summary for non-minimal layout with shell command", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(true);

    // runSetup question sequence for pair layout with custom shell:
    // 1. selectLayout (numberedSelect) → "Select [1-6]" → "2" (pair)
    // 2. selectEditor (selectToolFromCatalog) → "Select (default:" → "1"
    // 3. selectSidebar (selectToolFromCatalog) → "Select (default:" → "1"
    // 4. selectShell (numberedSelect) → "Select [1-3]" → "3" (command)
    // 5. textInput → "Enter shell command" → "npm run dev"
    // 6. confirm → "[Y/n]" → "y"
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) {
        cb("y");
      } else if (_q.includes("Select [1-6]")) {
        cb("2"); // pair layout
      } else if (_q.includes("Select [1-3]")) {
        cb("3"); // custom command
      } else if (_q.includes("Enter shell command")) {
        cb("npm run dev");
      } else {
        cb("1"); // editor and sidebar selections
      }
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // printSummary should show the custom shell command
    expect(
      allOutput.some((s) => s.includes("Shell:") && s.includes("npm run dev")),
    ).toBe(true);
    // Shell config should be saved as the custom command
    expect(mockSetConfig).toHaveBeenCalledWith("shell", "npm run dev");

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("prints SUMMON logo in welcome screen", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1");
    });

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      writable: true,
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("╔") && s.includes("╗"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });
});

describe("selectStarshipPreset", () => {
  it("returns null when starship is not installed", async () => {
    mockIsStarshipInstalled.mockReturnValue(false);
    const result = await selectStarshipPreset();
    expect(result).toBeNull();
  });

  it("returns null when preset list is empty", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue([]);
    const result = await selectStarshipPreset();
    expect(result).toBeNull();
  });

  it("returns selected preset name", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night", "pastel-powerline"]);
    // Select option 3 (tokyo-night) — option 1 is Skip, 2 is Random
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("3"));
    const result = await selectStarshipPreset();
    expect(result).toBe("tokyo-night");
  });

  it("returns null when skip option is selected", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    // Select option 1 (Skip)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("1"));
    const result = await selectStarshipPreset();
    expect(result).toBeNull();
  });

  it("shows available presets with descriptions", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night", "gruvbox-rainbow"]);
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("1"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await selectStarshipPreset();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("tokyo-night");
    expect(output).toContain("gruvbox-rainbow");
    expect(output).toContain("Tokyo Night color scheme");
    expect(output).toContain("Gruvbox-inspired powerline");
    logSpy.mockRestore();
  });

  it("returns null by default (empty input selects Skip)", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    // Empty input → default (index 0 = Skip)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb(""));
    const result = await selectStarshipPreset();
    expect(result).toBeNull();
  });

  it("includes Random option as option 2", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("1"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await selectStarshipPreset();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Random (surprise me!)");
    logSpy.mockRestore();
  });

  it("random option returns a valid preset name", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night", "pastel-powerline", "gruvbox-rainbow"]);
    // Select option 2 (Random)
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("2"));
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const result = await selectStarshipPreset();

    // Math.floor(0.5 * 3) = 1 → "pastel-powerline"
    expect(result).toBe("pastel-powerline");
    randomSpy.mockRestore();
  });

  it("preset options include padded names for alignment", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("1"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await selectStarshipPreset();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // tokyo-night is 11 chars, padded to 22 → 11 trailing spaces
    expect(output).toContain("tokyo-night           ");
    logSpy.mockRestore();
  });
});

describe("hexToRgb", () => {
  it("converts hex with # prefix", () => {
    expect(hexToRgb("#9A348E")).toEqual([154, 52, 142]);
  });

  it("converts hex without # prefix", () => {
    expect(hexToRgb("DA627D")).toEqual([218, 98, 125]);
  });

  it("converts black", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("converts white", () => {
    expect(hexToRgb("#FFFFFF")).toEqual([255, 255, 255]);
  });
});

describe("colorSwatch", () => {
  // colorSwatch reads useTrueColor which is evaluated at import time.
  // In the test environment, COLORTERM is likely not set, so useTrueColor is false.
  it("returns empty string when true color is not supported", () => {
    const result = colorSwatch(["#9A348E", "#DA627D"]);
    expect(result).toBe("");
  });
});

describe("runSetup with starship", () => {
  // With minimal layout (cb("1")), shell is skipped, so flow is:
  // 1: layout(1=minimal), 2: editor(1), 3: sidebar(1), 4: starship(3=tokyo-night), 5: confirm(y)
  // Option 1=Skip, 2=Random, 3=tokyo-night
  const setupMockQuestion = () => {
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount <= 3) cb("1");      // layout, editor, sidebar
      else if (callCount === 4) cb("3"); // starship: tokyo-night (after Skip, Random)
      else cb("y");                      // confirm
    });
  };

  it("saves starship-preset to config when preset selected", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setupMockQuestion();

    await runSetup();

    expect(mockSetConfig).toHaveBeenCalledWith("starship-preset", "tokyo-night");
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it("does not save starship-preset when skipped", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      // minimal layout skips shell: 1-3: layout/editor/sidebar, 4: starship skip, 5: confirm
      if (callCount <= 3) cb("1");
      else if (callCount === 4) cb("1"); // Skip starship
      else cb("y");
    });

    await runSetup();

    const starshipCalls = mockSetConfig.mock.calls.filter(
      (c: unknown[]) => c[0] === "starship-preset",
    );
    expect(starshipCalls.length).toBe(0);
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it("skips starship step when starship is not installed", async () => {
    mockIsStarshipInstalled.mockReturnValue(false);
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      // minimal layout skips shell, no starship: 1-3: layout/editor/sidebar, 4: confirm (y)
      if (callCount <= 3) cb("1");
      else cb("y");
    });

    await runSetup();

    const starshipCalls = mockSetConfig.mock.calls.filter(
      (c: unknown[]) => c[0] === "starship-preset",
    );
    expect(starshipCalls.length).toBe(0);
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it("shows starship preset in summary when selected", async () => {
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setupMockQuestion();

    await runSetup();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Starship:");
    expect(output).toContain("tokyo-night");
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });
});

describe("gridToTree", () => {
  it("converts single column with 2 panes", () => {
    const result = gridToTree([["claude", "npm run dev"]]);
    expect(result.tree).toBe("(claude / npm)");
    expect(result.panes.get("claude")).toBe("claude");
    expect(result.panes.get("npm")).toBe("npm run dev");
  });

  it("converts two columns", () => {
    const result = gridToTree([["claude", "shell"], ["vim", "btop"]]);
    expect(result.tree).toBe("(claude / shell) | (vim / btop)");
    expect(result.panes.size).toBe(4);
  });

  it("converts single pane", () => {
    const result = gridToTree([["claude"]]);
    expect(result.tree).toBe("claude");
    expect(result.panes.size).toBe(1);
  });

  it("deduplicates pane names from same command", () => {
    const result = gridToTree([["claude", "claude"]]);
    expect(result.panes.has("claude")).toBe(true);
    expect(result.panes.has("claude_2")).toBe(true);
  });

  it("handles three columns with various pane counts", () => {
    const result = gridToTree([["vim"], ["claude", "shell"], ["btop"]]);
    expect(result.tree).toBe("vim | (claude / shell) | btop");
    expect(result.panes.size).toBe(4);
  });

  it("deduplicates across columns", () => {
    const result = gridToTree([["lazygit"], ["lazygit"]]);
    expect(result.panes.has("lazygit")).toBe(true);
    expect(result.panes.has("lazygit_2")).toBe(true);
  });
});

describe("renderLayoutPreview", () => {
  it("renders a 2-column layout", () => {
    const preview = renderLayoutPreview([["claude", "npm run dev"], ["vim"]]);
    expect(preview).toContain("claude");
    expect(preview).toContain("vim");
    expect(preview).toContain("\u250c"); // ┌
    expect(preview).toContain("\u2514"); // └
  });

  it("renders a single column", () => {
    const preview = renderLayoutPreview([["claude"]]);
    expect(preview).toContain("claude");
    expect(preview).toContain("\u2500"); // ─
  });

  it("renders 3 columns", () => {
    const preview = renderLayoutPreview([["vim"], ["claude"], ["btop"]]);
    expect(preview).toContain("vim");
    expect(preview).toContain("claude");
    expect(preview).toContain("btop");
  });

  it("renders multi-row columns correctly", () => {
    const preview = renderLayoutPreview([["claude", "shell"], ["vim", "btop"]]);
    const lines = preview.split("\n");
    // Should have top border, content rows for each pane, middle border, and bottom border
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// runLayoutBuilder Tests (#131 / #132)
// ---------------------------------------------------------------------------

/** Helper: extract all console.log output strings from a spy */
function getLogOutput(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c: unknown[]) => String(c[0]));
}

describe("runLayoutBuilder", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    // Default: name is valid, no existing custom layout
    mockIsValidLayoutName.mockReturnValue(true);
    mockIsCustomLayout.mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it("happy path: saves layout with correct name, tree, and pane definitions", async () => {
    // Flow: 1 column (select 1), 1 pane (select 1), pane command "claude",
    //       sidebar command "lazygit", confirm "y"
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        cb("y"); // confirm save
      } else if (q.includes("How many columns") || q.includes("Select [1-3]")) {
        cb("1"); // 1 column, 1 pane
      } else if (q.includes("Pane 1")) {
        cb("claude"); // command for pane
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("mytest");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [savedName, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedName).toBe("mytest");
    expect(savedEntries.get("tree")).toBeDefined();
    expect(savedEntries.get("tree")).toContain("claude");
    // Pane definitions should be present
    expect(savedEntries.get("pane.claude")).toBe("claude");
  });

  it("saves layout with 2 columns and multiple panes", async () => {
    // Flow: template "2" (2+1), col 1 pane 1 "vim", col 1 pane 2 "shell",
    //       col 2 pane 1 "btop", confirm
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        cb("y");
      } else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) {
        cb("2"); // template [2, 1]
      } else if (q.includes("Column 1, Pane 1")) {
        cb("vim");
      } else if (q.includes("Column 1, Pane 2")) {
        cb("shell");
      } else if (q.includes("Column 2, Pane 1")) {
        cb("btop");
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("devsetup");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [savedName, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedName).toBe("devsetup");
    expect(savedEntries.get("tree")).toBeDefined();
    expect(savedEntries.get("tree")).toContain("vim");
    expect(savedEntries.get("tree")).toContain("shell");
  });

  it("shows preview before saving", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("previewtest");

    const allOutput = getLogOutput(logSpy);
    // Should contain box-drawing characters from renderLayoutPreview (in-place preview)
    expect(allOutput.some((s: string) => s.includes("\u2500") || s.includes("\u250c") || s.includes("\u2502"))).toBe(true);
  });

  it("prints success message after save", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("myname");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Saved!"))).toBe(true);
    expect(allOutput.some((s: string) => s.includes("summon . --layout myname"))).toBe(true);
  });

  it("prompts for overwrite when layout already exists and user confirms", async () => {
    mockIsCustomLayout.mockReturnValue(true); // layout exists

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y"); // confirm overwrite and save
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("existing");

    // Should still save since user confirmed overwrite
    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
  });

  it("cancels when user declines overwrite of existing layout", async () => {
    mockIsCustomLayout.mockReturnValue(true); // layout exists

    let confirmCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        confirmCount++;
        if (confirmCount === 1) cb("n"); // decline overwrite
        else cb("y");
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("existing");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Cancelled"))).toBe(true);
    expect(mockSaveCustomLayout).not.toHaveBeenCalled();
  });

  it("rejects invalid layout name and exits", async () => {
    mockIsValidLayoutName.mockReturnValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await runLayoutBuilder("123bad");

    expect(errorSpy).toHaveBeenCalled();
    const allErrors = getLogOutput(errorSpy);
    expect(allErrors.some((s: string) => s.includes("Invalid layout name"))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects non-TTY stdin and exits", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await runLayoutBuilder("test");

    expect(errorSpy).toHaveBeenCalled();
    const allErrors = getLogOutput(errorSpy);
    expect(allErrors.some((s: string) => s.includes("interactive terminal"))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("defaults empty command input to 'shell'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb(""); // empty → defaults to "shell"
      else cb("1");
    });

    await runLayoutBuilder("shelltest");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedEntries.get("pane.shell")).toBe("shell");
  });

  it("cancels when user declines to save at the end", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("n"); // decline save
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("nope");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Cancelled"))).toBe(true);
    expect(mockSaveCustomLayout).not.toHaveBeenCalled();
  });

  it("saves multi-column layout via template selection", async () => {
    // Template 6 is [2, 2] — 2 columns, 2 panes each
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        cb("y");
      } else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) {
        cb("6"); // template [2, 2]
      } else if (q.includes("Pane")) {
        cb("vim"); // all panes get vim
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("bigsetup");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [savedName, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedName).toBe("bigsetup");
    const tree = savedEntries.get("tree")!;
    expect(tree).toContain("vim");
  });

  it("prints Layout Builder section header", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("headertest");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Layout Builder"))).toBe(true);
  });

  it("template selection skips column/pane count prompts", async () => {
    const promptTexts: string[] = [];
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      promptTexts.push(_q);
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) cb("1"); // template [1,1]
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("templatetest");

    expect(promptTexts.some((p) => p.includes("How many columns"))).toBe(false);
    expect(promptTexts.some((p) => p.includes("how many panes"))).toBe(false);
    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
  });

  it("progressive preview shown after each command", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) cb("1"); // template [1,1]
      else if (q.includes("Column 1, Pane 1")) cb("nvim");
      else if (q.includes("Column 2, Pane 1")) cb("lazygit");
      else cb("1");
    });

    await runLayoutBuilder("progresstest");

    const allOutput = getLogOutput(logSpy);
    // After first command, preview should show "nvim" and "?" placeholders
    const nvimIdx = allOutput.findIndex((s: string) => s.includes("nvim") && s.includes("\u2502"));
    expect(nvimIdx).toBeGreaterThan(-1);
    // Should also have "?" somewhere in the output (placeholder for unfilled panes)
    expect(allOutput.some((s: string) => s.includes("?"))).toBe(true);
  });

  it("old column/pane count prompts are removed", async () => {
    const promptTexts: string[] = [];
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      promptTexts.push(_q);
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) cb("1"); // template [1,1]
      else if (q.includes("Pane 1")) cb("claude");
      else cb("1");
    });

    await runLayoutBuilder("nooldflow");

    expect(promptTexts.some((p) => p.includes("How many columns"))).toBe(false);
    expect(promptTexts.some((p) => p.includes("how many panes"))).toBe(false);
    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("How many columns"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Visual Layout Builder — pure function tests
// ---------------------------------------------------------------------------

describe("renderMiniPreview", () => {
  it("renders single-column template", () => {
    const result = renderMiniPreview([1]);
    expect(result.length).toBeGreaterThanOrEqual(3); // top + content + bottom
    expect(result[0]).toContain("\u250c"); // ┌
    expect(result[result.length - 1]).toContain("\u2514"); // └
  });

  it("renders two-column template with different pane counts", () => {
    const result = renderMiniPreview([2, 1]);
    const joined = result.join("\n");
    expect(joined).toContain("\u251c"); // ├ (row separator)
    // Taller than equal panes
    expect(result.length).toBeGreaterThan(renderMiniPreview([1, 1]).length);
  });

  it("renders three-column template", () => {
    const result = renderMiniPreview([1, 2, 1]);
    // Top border should have ┬ separators between columns
    const teeDownCount = (result[0]!.match(/\u252c/g) ?? []).length;
    expect(teeDownCount).toBe(2); // 2 separators between 3 columns
  });

  it("single column has no ┬ separators", () => {
    const result = renderMiniPreview([1]);
    const teeDownCount = (result[0]!.match(/\u252c/g) ?? []).length;
    expect(teeDownCount).toBe(0);
  });
});

describe("renderTemplateGallery", () => {
  it("renders templates side by side in wide terminal", () => {
    const output = renderTemplateGallery(GRID_TEMPLATES, 120);
    expect(output).toContain("1)");
    expect(output).toContain("2)");
    expect(output).toContain("3)");
  });

  it("renders single column in narrow terminal", () => {
    const output = renderTemplateGallery(GRID_TEMPLATES, 25);
    // With very narrow width, each template on its own row
    const lines = output.split("\n");
    // Should have more lines than wide layout
    const wideOutput = renderTemplateGallery(GRID_TEMPLATES, 120);
    expect(lines.length).toBeGreaterThan(wideOutput.split("\n").length);
  });

  it("includes build from scratch option", () => {
    const output = renderTemplateGallery(GRID_TEMPLATES, 120);
    expect(output).toContain("Build from scratch");
  });

  it("shows template labels", () => {
    const output = renderTemplateGallery(GRID_TEMPLATES, 120);
    expect(output).toContain("1 + 1");
    expect(output).toContain("2 + 1");
  });
});

describe("selectGridTemplate", () => {
  it("returns template columns for numeric selection", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("1");
    });
    const result = await selectGridTemplate();
    expect(result).toEqual([1, 1]); // first template
  });

  it("custom option selection launches grid builder and returns its result", async () => {
    // Mock: first call to promptUser → "8" (triggers grid builder)
    // Grid builder enters raw mode and listens for keypresses
    // We simulate Enter immediately, returning [1] (initial state)
    const mockSetRawMode = vi.fn();
    const origSetRawMode = process.stdin.setRawMode;
    const origResume = process.stdin.resume;
    const origPause = process.stdin.pause;
    Object.defineProperty(process.stdin, "setRawMode", { value: mockSetRawMode, writable: true, configurable: true });
    process.stdin.resume = vi.fn();
    process.stdin.pause = vi.fn();

    // Capture the keypress handler and simulate Enter
    const stdinOnSpy = vi.spyOn(process.stdin, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
      if (event === "keypress") {
        // setTimeout(0) defers keypress to next tick, after the async handler registers
        setTimeout(() => handler(undefined, { name: "return", ctrl: false }), 0);
      }
      return process.stdin;
    });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("8");
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await selectGridTemplate();

    expect(result).toEqual([1]); // initial grid state = [1]
    expect(mockSetRawMode).toHaveBeenCalledWith(true);

    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    stdinOnSpy.mockRestore();
    Object.defineProperty(process.stdin, "setRawMode", { value: origSetRawMode, writable: true, configurable: true });
    process.stdin.resume = origResume;
    process.stdin.pause = origPause;
  });

  it("returns correct template for middle selection", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb("2");
    });
    const result = await selectGridTemplate();
    expect(result).toEqual([2, 1]); // second template
  });

  it("re-prompts on invalid input", async () => {
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("99"); // invalid
      else cb("1"); // valid
    });
    const result = await selectGridTemplate();
    expect(callCount).toBe(2);
    expect(result).toEqual([1, 1]);
  });

  it("returns first template on empty input (default)", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb(""); // empty → default
    });
    const result = await selectGridTemplate();
    expect(result).toEqual([1, 1]);
  });
});

describe("buildPartialGrid", () => {
  it("fills known commands and ? for missing", () => {
    const result = buildPartialGrid([2, 1], [["nvim"]]);
    expect(result[0]![0]).toBe("nvim");
    expect(result[0]![1]).toBe("?");
    expect(result[1]![0]).toBe("?");
  });

  it("fully filled grid has no placeholders", () => {
    const result = buildPartialGrid([1, 1], [["nvim"], ["lazygit"]]);
    expect(result[0]![0]).toBe("nvim");
    expect(result[1]![0]).toBe("lazygit");
  });

  it("handles empty commands array", () => {
    const result = buildPartialGrid([2, 1], []);
    expect(result[0]![0]).toBe("?");
    expect(result[0]![1]).toBe("?");
    expect(result[1]![0]).toBe("?");
  });

  it("handles partial column fill", () => {
    const result = buildPartialGrid([3], [["a", "b"]]);
    expect(result[0]![0]).toBe("a");
    expect(result[0]![1]).toBe("b");
    expect(result[0]![2]).toBe("?");
  });
});

describe("renderLayoutPreview — placeholders", () => {
  it("renders ? as placeholder text", () => {
    const preview = renderLayoutPreview([["nvim", "?"]]);
    expect(preview).toContain("nvim");
    expect(preview).toContain("?");
  });

  it("placeholder cells are rendered", () => {
    const preview = renderLayoutPreview([["?"]]);
    expect(preview).toContain("?");
    // Still has proper box drawing
    expect(preview).toContain("\u250c"); // ┌
    expect(preview).toContain("\u2514"); // └
  });
});

describe("GRID_TEMPLATES", () => {
  it("has at least 5 templates", () => {
    expect(GRID_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it("each template has valid columns", () => {
    for (const t of GRID_TEMPLATES) {
      expect(t.columns.length).toBeGreaterThanOrEqual(1);
      expect(t.columns.length).toBeLessThanOrEqual(3);
      for (const n of t.columns) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(3);
      }
    }
  });

  it("each template has a label", () => {
    for (const t of GRID_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — ANSI helpers + PreviewRenderer tests
// ---------------------------------------------------------------------------

describe("ANSI helpers", () => {
  it("ansiUp generates correct escape sequence", () => {
    expect(ansiUp(5)).toBe("\x1b[5A");
  });

  it("ansiUp(0) returns empty string", () => {
    expect(ansiUp(0)).toBe("");
  });

  it("ansiUp(1) moves cursor up 1 line", () => {
    expect(ansiUp(1)).toBe("\x1b[1A");
  });

  it("ansiClearDown returns correct sequence", () => {
    expect(ansiClearDown()).toBe("\x1b[0J");
  });

  it("ansiSyncStart returns correct sequence", () => {
    expect(ansiSyncStart()).toBe("\x1b[?2026h");
  });

  it("ansiSyncEnd returns correct sequence", () => {
    expect(ansiSyncEnd()).toBe("\x1b[?2026l");
  });
});

describe("PreviewRenderer", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("first draw prints preview without cursor control", () => {
    const renderer = new PreviewRenderer();
    renderer.draw([["nvim"]]);

    // Should NOT write ANSI cursor sequences on first draw
    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(stdoutCalls.some((c: string) => c.includes("\x1b[") && c.includes("A"))).toBe(false);

    // Should log preview lines containing command names
    const logCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(logCalls.some((c: string) => c.includes("nvim"))).toBe(true);
  });

  it("second draw moves cursor up and clears", () => {
    const renderer = new PreviewRenderer();
    renderer.draw([["?"]]);
    renderer.log("some text");
    renderer.countPrompt();
    renderer.draw([["nvim"]]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should contain ansiUp sequence
    expect(stdoutCalls.some((c: string) => c.includes("A"))).toBe(true);
    // Should contain ansiClearDown sequence
    expect(stdoutCalls.some((c: string) => c.includes("\x1b[0J"))).toBe(true);
    // Should contain sync start/end
    expect(stdoutCalls.some((c: string) => c.includes("\x1b[?2026h"))).toBe(true);
    expect(stdoutCalls.some((c: string) => c.includes("\x1b[?2026l"))).toBe(true);
  });

  it("log increments line counter", () => {
    const renderer = new PreviewRenderer();
    renderer.draw([["?"]]);

    // Count how many lines the first draw produced
    const firstDrawLogCount = logSpy.mock.calls.length;

    renderer.log("line 1");
    renderer.log("line 2");
    renderer.countPrompt();

    stdoutSpy.mockClear();
    renderer.draw([["nvim"]]);

    // Should move up by: firstDrawLogCount (preview height) + 3 (2 logs + 1 prompt)
    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const upSequence = stdoutCalls.find((c: string) => c.includes("A"));
    expect(upSequence).toBeDefined();
    // Extract the number from \x1b[NA
    // eslint-disable-next-line no-control-regex
    const match = upSequence!.match(/\x1b\[(\d+)A/);
    expect(match).not.toBeNull();
    const upCount = parseInt(match![1]!, 10);
    expect(upCount).toBe(firstDrawLogCount + 3);
  });

  it("reset makes next draw act as first draw", () => {
    const renderer = new PreviewRenderer();
    renderer.draw([["?"]]);
    renderer.reset();

    stdoutSpy.mockClear();
    renderer.draw([["nvim"]]);

    // Should NOT attempt cursor control after reset
    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(stdoutCalls.some((c: string) => c.includes("A"))).toBe(false);
  });

  it("countPrompt increments line counter by 1", () => {
    const renderer = new PreviewRenderer();
    renderer.draw([["?"]]);

    const firstDrawLogCount = logSpy.mock.calls.length;

    renderer.countPrompt();
    renderer.countPrompt();
    renderer.countPrompt();

    stdoutSpy.mockClear();
    renderer.draw([["nvim"]]);

    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const upSequence = stdoutCalls.find((c: string) => c.includes("A"));
    // eslint-disable-next-line no-control-regex
    const match = upSequence!.match(/\x1b\[(\d+)A/);
    const upCount = parseInt(match![1]!, 10);
    expect(upCount).toBe(firstDrawLogCount + 3);
  });
});

describe("runLayoutBuilder — in-place preview", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockIsValidLayoutName.mockReturnValue(true);
    mockIsCustomLayout.mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("preview redraws in place after each command", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) cb("1"); // template [1,1]
      else if (q.includes("Column 1, Pane 1")) cb("nvim");
      else if (q.includes("Column 2, Pane 1")) cb("lazygit");
      else cb("1");
    });

    await runLayoutBuilder("inplacetest");

    const stdoutCalls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should contain ansiUp sequences (in-place redraws after first draw)
    expect(stdoutCalls.some((c: string) => c.includes("\x1b[") && c.includes("A"))).toBe(true);
    // Should contain sync sequences
    expect(stdoutCalls.some((c: string) => c.includes("\x1b[?2026h"))).toBe(true);
  });

  it("initial preview is drawn before any command prompts", async () => {
    const logOrder: string[] = [];
    logSpy.mockImplementation((...args: unknown[]) => {
      logOrder.push(String(args[0]));
    });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("nvim");
      else cb("1");
    });

    await runLayoutBuilder("initialtest");

    // Preview box characters should appear before any "Column" text
    const firstBoxIdx = logOrder.findIndex((s) => s.includes("\u250c")); // ┌
    expect(firstBoxIdx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — Grid builder state + rendering tests
// ---------------------------------------------------------------------------

describe("createGridState", () => {
  it("creates initial state with 1 column, 1 pane, focus at 0,0", () => {
    const state = createGridState();
    expect(state.columns).toEqual([1]);
    expect(state.focusCol).toBe(0);
    expect(state.focusRow).toBe(0);
  });
});

describe("applyGridAction", () => {
  it("addCol appends column and moves focus", () => {
    const next = applyGridAction(createGridState(), "addCol");
    expect(next).not.toBeNull();
    expect(next!.columns).toEqual([1, 1]);
    expect(next!.focusCol).toBe(1);
    expect(next!.focusRow).toBe(0);
  });

  it("addCol always succeeds", () => {
    const state = { columns: [1, 1, 1, 1], focusCol: 0, focusRow: 0 };
    const next = applyGridAction(state, "addCol");
    expect(next).not.toBeNull();
    expect(next!.columns.length).toBe(5);
  });

  it("removeCol removes last column", () => {
    const state = { columns: [1, 2], focusCol: 0, focusRow: 0 };
    const next = applyGridAction(state, "removeCol");
    expect(next).not.toBeNull();
    expect(next!.columns).toEqual([1]);
  });

  it("removeCol returns null with 1 column", () => {
    expect(applyGridAction(createGridState(), "removeCol")).toBeNull();
  });

  it("removeCol clamps focus when focused column removed", () => {
    const state = { columns: [1, 1], focusCol: 1, focusRow: 0 };
    const next = applyGridAction(state, "removeCol");
    expect(next!.columns).toEqual([1]);
    expect(next!.focusCol).toBe(0);
  });

  it("addPane increments focused column pane count", () => {
    const next = applyGridAction(createGridState(), "addPane");
    expect(next!.columns).toEqual([2]);
    expect(next!.focusRow).toBe(1);
  });

  it("addPane always succeeds", () => {
    const state = { columns: [4], focusCol: 0, focusRow: 0 };
    const next = applyGridAction(state, "addPane");
    expect(next).not.toBeNull();
    expect(next!.columns[0]).toBe(5);
  });

  it("removePane decrements focused column pane count", () => {
    const state = { columns: [2], focusCol: 0, focusRow: 1 };
    const next = applyGridAction(state, "removePane");
    expect(next!.columns).toEqual([1]);
    expect(next!.focusRow).toBe(0);
  });

  it("removePane returns null with 1 pane", () => {
    expect(applyGridAction(createGridState(), "removePane")).toBeNull();
  });

  it("nextFocus moves to next row in same column", () => {
    const state = { columns: [2, 1], focusCol: 0, focusRow: 0 };
    const next = applyGridAction(state, "nextFocus");
    expect(next!.focusCol).toBe(0);
    expect(next!.focusRow).toBe(1);
  });

  it("nextFocus wraps to next column", () => {
    const state = { columns: [2, 1], focusCol: 0, focusRow: 1 };
    const next = applyGridAction(state, "nextFocus");
    expect(next!.focusCol).toBe(1);
    expect(next!.focusRow).toBe(0);
  });

  it("nextFocus wraps to first cell from last", () => {
    const state = { columns: [1, 1], focusCol: 1, focusRow: 0 };
    const next = applyGridAction(state, "nextFocus");
    expect(next!.focusCol).toBe(0);
    expect(next!.focusRow).toBe(0);
  });

  it("prevFocus moves backwards through cells", () => {
    const state = { columns: [2, 1], focusCol: 1, focusRow: 0 };
    const next = applyGridAction(state, "prevFocus");
    expect(next!.focusCol).toBe(0);
    expect(next!.focusRow).toBe(1);
  });

  it("prevFocus wraps from first cell to last", () => {
    const state = { columns: [2, 1], focusCol: 0, focusRow: 0 };
    const next = applyGridAction(state, "prevFocus");
    expect(next!.focusCol).toBe(1);
    expect(next!.focusRow).toBe(0);
  });

  it("does not mutate original state", () => {
    const state = createGridState();
    const original = { ...state, columns: [...state.columns] };
    applyGridAction(state, "addCol");
    expect(state).toEqual(original);
  });
});

describe("renderGridBuilderPreview", () => {
  it("focused cell contains marker character", () => {
    const preview = renderGridBuilderPreview([2, 1], 0, 0);
    expect(preview).toContain("*");
  });

  it("non-focused cells contain dot marker", () => {
    const preview = renderGridBuilderPreview([2, 1], 0, 0);
    expect(preview).toContain("\u00b7"); // ·
  });

  it("single column renders correctly", () => {
    const preview = renderGridBuilderPreview([1], 0, 0);
    expect(preview).toContain("\u250c"); // ┌
    expect(preview).toContain("\u2514"); // └
  });

  it("renders correct number of separators for multi-pane column", () => {
    const preview = renderGridBuilderPreview([3, 1], 0, 0);
    const lines = preview.split("\n");
    const separatorCount = lines.filter((l: string) => l.includes("\u251c")).length; // ├
    expect(separatorCount).toBe(2);
  });
});

describe("runGridBuilder", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let mockSetRawMode: ReturnType<typeof vi.fn>;
  let capturedKeyHandler: ((_str: string | undefined, key: { name: string; ctrl?: boolean; shift?: boolean }) => void) | null;
  let stdinOnSpy: ReturnType<typeof vi.spyOn>;
  let origSetRawMode: typeof process.stdin.setRawMode;
  let origResume: typeof process.stdin.resume;
  let origPause: typeof process.stdin.pause;

  /** Wait for the keypress handler to be registered (async setup in runGridBuilder). */
  async function waitForHandler(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (capturedKeyHandler) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    if (!capturedKeyHandler) throw new Error("keypress handler was never registered within timeout");
  }

  function simulateKey(name: string, ctrl = false, shift = false): void {
    if (capturedKeyHandler) {
      capturedKeyHandler(undefined, { name, ctrl, shift });
    }
  }

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockSetRawMode = vi.fn();
    origSetRawMode = process.stdin.setRawMode;
    origResume = process.stdin.resume;
    origPause = process.stdin.pause;
    Object.defineProperty(process.stdin, "setRawMode", { value: mockSetRawMode, writable: true, configurable: true });
    process.stdin.resume = vi.fn();
    process.stdin.pause = vi.fn();

    capturedKeyHandler = null;
    stdinOnSpy = vi.spyOn(process.stdin, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
      if (event === "keypress") {
        capturedKeyHandler = handler as typeof capturedKeyHandler;
      }
      return process.stdin;
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    stdinOnSpy.mockRestore();
    Object.defineProperty(process.stdin, "setRawMode", { value: origSetRawMode, writable: true, configurable: true });
    process.stdin.resume = origResume;
    process.stdin.pause = origPause;
  });

  it("Enter with initial state returns [1]", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("return");
    const result = await promise;
    expect(result).toEqual([1]);
  });

  it("right arrow + Enter returns [1, 1]", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("right");
    simulateKey("return");
    const result = await promise;
    expect(result).toEqual([1, 1]);
  });

  it("right + down + Enter returns [1, 2]", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("right");
    simulateKey("down");
    simulateKey("return");
    const result = await promise;
    expect(result).toEqual([1, 2]);
  });

  it("Escape returns null", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("escape");
    const result = await promise;
    expect(result).toBeNull();
  });

  it("restores raw mode on Enter", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("return");
    await promise;
    expect(mockSetRawMode).toHaveBeenCalledWith(false);
  });

  it("restores raw mode on Escape", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("escape");
    await promise;
    expect(mockSetRawMode).toHaveBeenCalledWith(false);
  });

  it("Ctrl+C exits cleanly", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const promise = runGridBuilder();
    await waitForHandler();
    simulateKey("c", true);
    expect(mockSetRawMode).toHaveBeenCalledWith(false);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
    // Prevent unhandled rejection — promise never resolves after exit
    promise.catch(() => {});
  });

  it("shift+tab moves focus backward", async () => {
    const promise = runGridBuilder();
    await waitForHandler();
    // Build a grid with 2 columns: right adds col, focus moves to col 1
    simulateKey("right");
    // Now shift+tab should move focus back to col 0
    simulateKey("tab", false, true);
    simulateKey("return");
    const result = await promise;
    // Grid is [1, 1] — shift+tab moved focus from col 1 back to col 0
    expect(result).toEqual([1, 1]);
  });
});

describe("renderGridBuilderHints", () => {
  it("includes [Esc] cancel hint", () => {
    const state = createGridState();
    const hints = renderGridBuilderHints(state);
    expect(hints).toContain("[Esc] cancel");
  });

  it("includes [Enter] done hint", () => {
    const state = createGridState();
    const hints = renderGridBuilderHints(state);
    expect(hints).toContain("[Enter] done");
  });

  it("includes [Tab] move focus hint", () => {
    const state = createGridState();
    const hints = renderGridBuilderHints(state);
    expect(hints).toContain("[Tab] move focus");
  });
});

// ---------------------------------------------------------------------------
// #154 — centerLabel truncation indicator
// ---------------------------------------------------------------------------

describe("visibleLength", () => {
  it("returns length of plain text", () => {
    expect(visibleLength("hello")).toBe(5);
  });

  it("strips ANSI codes from length calculation", () => {
    expect(visibleLength("\x1b[1mhello\x1b[0m")).toBe(5);
  });

  it("returns 0 for empty string", () => {
    expect(visibleLength("")).toBe(0);
  });
});

describe("centerLabel", () => {
  it("centers short text within width", () => {
    const result = centerLabel("vim", 12);
    // "vim" is 3 chars, width is 12 → padding on both sides
    expect(result.length).toBe(12);
    expect(result).toContain("vim");
  });

  it("adds ellipsis when text is truncated", () => {
    // width=8, maxLen=6, "longcommand" (11 chars) > 6, so truncate to 5 + "…"
    const result = centerLabel("longcommand", 8);
    expect(result).toContain("\u2026"); // …
  });

  it("does not add ellipsis when text fits", () => {
    const result = centerLabel("vim", 12);
    expect(result).not.toContain("\u2026");
  });

  it("truncated label fits within width", () => {
    const result = centerLabel("verylongcommandname", 10);
    expect(result.length).toBe(10);
    expect(result).toContain("\u2026");
  });
});

// ---------------------------------------------------------------------------
// #155 — layout name prompt includes example
// ---------------------------------------------------------------------------

describe("selectLayout — custom layout name prompt", () => {
  it("prompt includes example hint (e.g., mysetup)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const promptTexts: string[] = [];

    // Track all prompts
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      promptTexts.push(_q);
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Select [1-")) cb("6"); // "Custom" option (last preset + 1)
      else if (q.includes("Name your layout")) cb("mytest");
      else if (q.includes("Pane 1") || q.includes("Pane")) cb("vim");
      else cb("1");
    });

    // We need isTTY for runLayoutBuilder
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockIsValidLayoutName.mockReturnValue(true);
    mockIsCustomLayout.mockReturnValue(false);

    await selectLayout();

    // The "Name your layout" prompt should include an example
    const namePrompt = promptTexts.find((p) => p.includes("Name your layout"));
    expect(namePrompt).toBeDefined();
    expect(namePrompt).toContain("e.g.");

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// #160 — detectTools is async (parallelized)
// ---------------------------------------------------------------------------

describe("detectTools — async", () => {
  it("returns a promise", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    const result = detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result).toBeInstanceOf(Promise);
  });

  it("marks available tools with available: true", async () => {
    mockExecFileSync.mockReturnValue("/usr/bin/vim\n");
    const result = await detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result[0]!.available).toBe(true);
  });

  it("marks missing tools with available: false", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = await detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result[0]!.available).toBe(false);
  });

  it("handles empty catalog", async () => {
    expect(await detectTools([])).toEqual([]);
  });

  it("handles all-missing catalog", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const catalog = [
      { cmd: "a", name: "A", desc: "a" },
      { cmd: "b", name: "B", desc: "b" },
    ];
    const result = await detectTools(catalog);
    expect(result.every((t) => !t.available)).toBe(true);
  });

  it("handles all-available catalog", async () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    const catalog = [
      { cmd: "a", name: "A", desc: "a" },
      { cmd: "b", name: "B", desc: "b" },
    ];
    const result = await detectTools(catalog);
    expect(result.every((t) => t.available)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #167 — Additional coverage for uncovered branches
// ---------------------------------------------------------------------------

describe("selectLayout — custom layout validation branches", () => {
  it("re-prompts when custom layout name is empty", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let nameCallCount = 0;
    mockIsValidLayoutName.mockReturnValue(true);
    mockIsCustomLayout.mockReturnValue(false);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("Select [1-")) {
        cb("6"); // "Custom" option
      } else if (q.includes("Name your layout")) {
        nameCallCount++;
        if (nameCallCount === 1) cb(""); // empty name — re-prompt
        else cb("mytest");
      } else if (q.includes("[Y/n]")) {
        cb("y");
      } else if (q.includes("Pane")) {
        cb("vim");
      } else {
        cb("1");
      }
    });

    const result = await selectLayout();

    expect(nameCallCount).toBe(2); // re-prompted once
    expect(result).toBe("mytest");
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("No name provided"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });

  it("re-prompts when custom layout name is invalid", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let nameCallCount = 0;
    mockIsValidLayoutName.mockImplementation((name: string) => name !== "123bad");
    mockIsCustomLayout.mockReturnValue(false);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("Select [1-")) {
        cb("6"); // "Custom" option
      } else if (q.includes("Name your layout")) {
        nameCallCount++;
        if (nameCallCount === 1) cb("123bad"); // invalid name — re-prompt
        else cb("goodname");
      } else if (q.includes("[Y/n]")) {
        cb("y");
      } else if (q.includes("Pane")) {
        cb("vim");
      } else {
        cb("1");
      }
    });

    const result = await selectLayout();

    expect(nameCallCount).toBe(2);
    expect(result).toBe("goodname");
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Invalid name"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });
});

describe("selectToolFromCatalog — invalid custom command re-prompt", () => {
  it("re-prompts when custom command fails SAFE_COMMAND_RE", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (callCount === 1) cb("c"); // select custom
      else if (callCount === 2) cb("invalid command!@#"); // fails SAFE_COMMAND_RE
      else cb("valid-cmd");
    });

    const result = await selectToolFromCatalog(
      [{ cmd: "vim", name: "Vim", desc: "Editor" }],
      "Editor",
    );

    expect(result).toBe("valid-cmd");
    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Invalid command name"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("runSetup — custom layout path", () => {
  it("skips editor/sidebar/shell for custom layout and shows custom summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsCustomLayout.mockReturnValue(true);
    mockIsStarshipInstalled.mockReturnValue(false);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      if (_q.includes("[Y/n]")) cb("y");
      else cb("1"); // layout selection
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Custom layout skip messages
    expect(allOutput.some((s) => s.includes("Custom layout"))).toBe(true);
    expect(allOutput.some((s) => s.includes("Skipping editor"))).toBe(true);
    // Custom summary — shows (custom)
    expect(allOutput.some((s) => s.includes("(custom)"))).toBe(true);
    // Should only save layout (not editor/sidebar/shell)
    expect(mockSetConfig).toHaveBeenCalledWith("layout", "minimal");
    const editorCalls = mockSetConfig.mock.calls.filter((c: unknown[]) => c[0] === "editor");
    expect(editorCalls.length).toBe(0);

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
    mockIsCustomLayout.mockReturnValue(false);
  });

  it("shows starship preset in custom layout summary when selected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockIsCustomLayout.mockReturnValue(true);
    mockIsStarshipInstalled.mockReturnValue(true);
    mockListStarshipPresets.mockReturnValue(["tokyo-night"]);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (_q.includes("[Y/n]")) cb("y");
      else if (callCount === 1) cb("1"); // layout selection
      else if (callCount === 2) cb("3"); // starship: tokyo-night (1=Skip, 2=Random, 3=tokyo-night)
      else cb("1");
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s) => s.includes("(custom)"))).toBe(true);
    expect(allOutput.some((s) => s.includes("Starship:") && s.includes("tokyo-night"))).toBe(true);
    expect(mockSetConfig).toHaveBeenCalledWith("starship-preset", "tokyo-night");

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
    mockIsCustomLayout.mockReturnValue(false);
  });
});

describe("validateSetup — warning without installHint", () => {
  it("returns warning without installHint for unknown tool", () => {
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "my-custom-editor")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });
    mockExistsSync.mockReturnValue(true);
    const result = validateSetup({
      layout: "pair",
      editor: "my-custom-editor",
      sidebar: "lazygit",
      shell: "true",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.key).toBe("editor");
    expect(result.warnings[0]!.installHint).toBeUndefined();
  });
});

describe("printValidation — warning without install hint", () => {
  it("prints warning without install hint suffix", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Make a custom editor that has no install hint
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "my-custom-editor")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });
    mockExistsSync.mockReturnValue(true);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

    // Go through runSetup with pair layout + custom editor (via "c")
    let callCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      callCount++;
      if (_q.includes("[Y/n]")) cb("y");
      else if (_q.includes("Select [1-6]")) cb("2"); // pair
      else if (_q.includes("Select [1-3]")) cb("1"); // shell = plain
      else if (_q.includes("Enter command")) cb("my-custom-editor");
      else if (callCount <= 3) cb("c"); // select custom for editor
      else cb("1"); // sidebar
    });

    await runSetup();

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // Should have a "not found" warning without "install with:"
    const warningLine = allOutput.find((s) =>
      s.includes("my-custom-editor") && s.includes("not found"),
    );
    expect(warningLine).toBeDefined();
    expect(warningLine).not.toContain("install with:");

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
  });
});

describe("renderLayoutPreview — junction rendering", () => {
  it("renders cross junction for multi-pane adjacent columns", () => {
    // Two columns each with 2 panes: both have splits at same row — cross junction
    const preview = renderLayoutPreview([["a", "b"], ["c", "d"]]);
    expect(preview).toContain("\u253c"); // cross
  });

  it("renders teeLeft junction for left-split-only at row boundary", () => {
    // Col 1 has 2 panes, Col 2 has 1 pane — left has split, right doesn't — teeLeft
    const preview = renderLayoutPreview([["a", "b"], ["c"]]);
    expect(preview).toContain("\u2524"); // teeLeft
  });

  it("renders teeRight junction for right-split-only at row boundary", () => {
    // Col 1 has 1 pane, Col 2 has 2 panes — no left split, right has split — teeRight
    const preview = renderLayoutPreview([["a"], ["b", "c"]]);
    expect(preview).toContain("\u251c"); // teeRight
  });

  it("renders vertical when no splits at row boundary", () => {
    // Both single pane — no splits — no cross
    const preview = renderLayoutPreview([["a"], ["b"]]);
    expect(preview).not.toContain("\u253c"); // no cross
  });

  it("renders vertical junction between two columns that both lack a split at a row boundary", () => {
    // Col 0 has 3 panes (forces row boundaries at rows 0→1 and 1→2).
    // Col 1 and Col 2 each have 1 pane — neither has a split at row 0→1.
    // At the junction between Col 1 and Col 2 on the row 0→1 separator,
    // neither prevHasSplit nor hasSplitHere is true → BOX.vertical (│).
    const preview = renderLayoutPreview([["a", "b", "c"], ["d"], ["e"]]);
    const lines = preview.split("\n");
    // Find the first row separator line (contains ├ for col 0's split)
    const sepLine = lines.find((l: string) => l.includes("\u251c")); // ├ (teeRight)
    expect(sepLine).toBeDefined();
    // Between col 1 and col 2, the junction should be │ (vertical), not ┼/├/┤
    // The separator line has structure: ├──────────────┤              │              │
    // The junction between col 1 (no split) and col 2 (no split) is │
    expect(sepLine).toContain("\u2502" + " ".repeat(14) + "\u2502"); // │ + spaces + │ for no-split cols
  });
});

describe("renderTemplateGallery — edge cases", () => {
  it("returns empty string for empty template array", () => {
    const result = renderTemplateGallery([], 120);
    expect(result).toBe("");
  });
});

describe("selectGridTemplate — Escape in grid builder", () => {
  it("returns to template selection when user presses Escape in grid builder", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const mockSetRawMode = vi.fn();
    const origSetRawMode = process.stdin.setRawMode;
    const origResume = process.stdin.resume;
    const origPause = process.stdin.pause;
    Object.defineProperty(process.stdin, "setRawMode", { value: mockSetRawMode, writable: true, configurable: true });
    process.stdin.resume = vi.fn();
    process.stdin.pause = vi.fn();

    let gridBuilderCallCount = 0;
    const stdinOnSpy = vi.spyOn(process.stdin, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
      if (event === "keypress") {
        gridBuilderCallCount++;
        if (gridBuilderCallCount === 1) {
          // First time in grid builder: press Escape — returns null
          // setTimeout(0) defers keypress to next tick, after the async handler registers
          setTimeout(() => handler(undefined, { name: "escape", ctrl: false }), 0);
        } else {
          // Second time: press Enter — returns [1]
          // setTimeout(0) defers keypress to next tick, after the async handler registers
          setTimeout(() => handler(undefined, { name: "return", ctrl: false }), 0);
        }
      }
      return process.stdin;
    });

    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      // Always select custom option to trigger grid builder
      cb("8");
    });

    const result = await selectGridTemplate();

    expect(result).toEqual([1]);
    const allLogOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allLogOutput.some((s) => s.includes("Returning to template selection"))).toBe(true);

    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    stdinOnSpy.mockRestore();
    Object.defineProperty(process.stdin, "setRawMode", { value: origSetRawMode, writable: true, configurable: true });
    process.stdin.resume = origResume;
    process.stdin.pause = origPause;
  });
});

describe("runLayoutBuilder — validateBuilderCommand branches", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockIsValidLayoutName.mockReturnValue(true);
    mockIsCustomLayout.mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("warns and offers suggestion for unknown command with close match", async () => {
    // Make "lzgit" not found in PATH, "lazygit" is in available catalog
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && (args[3] === "lzgit"))
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });

    let paneCallCount = 0;
    let confirmCallCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        confirmCallCount++;
        if (confirmCallCount === 1) cb("y"); // accept suggestion
        else cb("y"); // save layout
      } else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) {
        cb("1"); // template [1,1]
      } else if (q.includes("Pane 1")) {
        paneCallCount++;
        if (paneCallCount === 1) cb("lzgit"); // typo — triggers suggestion "lazygit"
        else cb("vim");
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("suggesttest");

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s: string) => s.includes("not found") && s.includes("Did you mean"))).toBe(true);
  });

  it("warns about unknown command with no close match and keeps if confirmed", async () => {
    // Make "zzzcmd" not found, no close match in catalog
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "zzzcmd")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });

    let confirmCallCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        confirmCallCount++;
        if (confirmCallCount === 1) cb("y"); // keep anyway
        else cb("y"); // save layout
      } else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) {
        cb("1"); // template [1,1]
      } else if (q.includes("Pane 1")) {
        cb("zzzcmd"); // no close match
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("nomatchtest");

    const allOutput = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allOutput.some((s: string) => s.includes("not found on this system"))).toBe(true);
    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
  });

  it("re-prompts when user declines to keep unknown command", async () => {
    // Make "zzzcmd" not found, no close match
    mockExecFileSync.mockImplementation((_bin: string, args?: string[]) => {
      if (Array.isArray(args) && args[3] === "zzzcmd")
        throw new Error("not found");
      return "/usr/bin/stub\n";
    });

    let paneCallCount = 0;
    let confirmCallCount = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        confirmCallCount++;
        if (confirmCallCount === 1) cb("n"); // don't keep — re-prompt
        else cb("y"); // save layout
      } else if (q.includes("[1-8]") || q.includes(`[1-${GRID_TEMPLATES.length}`)) {
        cb("1"); // template [1,1] — 2 columns, 1 pane each
      } else if (q.includes("Pane")) {
        paneCallCount++;
        if (paneCallCount === 1) cb("zzzcmd"); // bad command
        else cb("vim"); // good command on re-prompt and second column
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("reprompttest");

    // paneCallCount = 3: zzzcmd (rejected) + vim (re-prompt col 1) + vim (col 2)
    expect(paneCallCount).toBe(3);
    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedEntries.get("pane.vim")).toBe("vim");
  });
});

describe("runGridBuilder — null key guard", () => {
  it("ignores null key events without crashing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const mockSetRawMode = vi.fn();
    const origSetRawMode = process.stdin.setRawMode;
    const origResume = process.stdin.resume;
    const origPause = process.stdin.pause;
    Object.defineProperty(process.stdin, "setRawMode", { value: mockSetRawMode, writable: true, configurable: true });
    process.stdin.resume = vi.fn();
    process.stdin.pause = vi.fn();

    const stdinOnSpy = vi.spyOn(process.stdin, "on").mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
      if (event === "keypress") {
        // First send null key, then valid Enter
        setTimeout(() => {
          handler(undefined, null); // null key — should be ignored
          handler(undefined, { name: "return", ctrl: false }); // complete
        }, 0);
      }
      return process.stdin;
    });

    const result = await runGridBuilder();
    expect(result).toEqual([1]); // completes without error

    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    stdinOnSpy.mockRestore();
    Object.defineProperty(process.stdin, "setRawMode", { value: origSetRawMode, writable: true, configurable: true });
    process.stdin.resume = origResume;
    process.stdin.pause = origPause;
  });
});

describe("gridToTree — triple deduplication", () => {
  it("deduplicates pane names across three columns with same command", () => {
    const result = gridToTree([["shell"], ["shell"], ["shell"]]);
    expect(result.panes.has("shell")).toBe(true);
    expect(result.panes.has("shell_2")).toBe(true);
    expect(result.panes.has("shell_3")).toBe(true);
    expect(result.panes.size).toBe(3);
  });
});
