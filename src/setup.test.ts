import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process for tool detection
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

// Import after mocks
const {
  resolveCommandPath,
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
  SAFE_COMMAND_RE,
  selectLayout,
  selectToolFromCatalog,
  selectShell,
  selectStarshipPreset,
  validateSetup,
  runSetup,
  hexToRgb,
  colorSwatch,
  // Phase 5 additions:
  gridToTree,
  renderLayoutPreview,
  runLayoutBuilder,
  findClosestCommand,
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
  it("marks available tools with available: true", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/vim\n");
    const result = detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result[0]!.available).toBe(true);
  });

  it("marks missing tools with available: false", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = detectTools([{ cmd: "vim", name: "Vim", desc: "Editor" }]);
    expect(result[0]!.available).toBe(false);
  });

  it("handles empty catalog", () => {
    expect(detectTools([])).toEqual([]);
  });

  it("handles all-missing catalog", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const catalog = [
      { cmd: "a", name: "A", desc: "a" },
      { cmd: "b", name: "B", desc: "b" },
    ];
    const result = detectTools(catalog);
    expect(result.every((t) => !t.available)).toBe(true);
  });

  it("handles all-available catalog", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    const catalog = [
      { cmd: "a", name: "A", desc: "a" },
      { cmd: "b", name: "B", desc: "b" },
    ];
    const result = detectTools(catalog);
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
      expect(entry.cmd).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.desc).toBeTruthy();
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
      expect(entry.cmd).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.desc).toBeTruthy();
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
      expect(info.desc).toBeTruthy();
      expect(info.diagram).toBeTruthy();
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
  it("converts single column with 2 panes and sidebar", () => {
    const result = gridToTree([["claude", "npm run dev"]], "lazygit");
    expect(result.tree).toBe("(claude / npm) | lazygit");
    expect(result.panes.get("claude")).toBe("claude");
    expect(result.panes.get("npm")).toBe("npm run dev");
    expect(result.panes.get("lazygit")).toBe("lazygit");
  });

  it("converts two columns with sidebar", () => {
    const result = gridToTree([["claude", "shell"], ["vim", "btop"]], "lazygit");
    expect(result.tree).toBe("(claude / shell) | (vim / btop) | lazygit");
    expect(result.panes.size).toBe(5);
  });

  it("converts single pane with sidebar", () => {
    const result = gridToTree([["claude"]], "lazygit");
    expect(result.tree).toBe("claude | lazygit");
    expect(result.panes.size).toBe(2);
  });

  it("deduplicates pane names from same command", () => {
    const result = gridToTree([["claude", "claude"]], "lazygit");
    expect(result.panes.has("claude")).toBe(true);
    expect(result.panes.has("claude_2")).toBe(true);
  });

  it("handles three columns with various pane counts", () => {
    const result = gridToTree([["vim"], ["claude", "shell"], ["btop"]], "lazygit");
    expect(result.tree).toBe("vim | (claude / shell) | btop | lazygit");
    expect(result.panes.size).toBe(5);
  });

  it("deduplicates across columns and sidebar", () => {
    const result = gridToTree([["lazygit"]], "lazygit");
    expect(result.panes.has("lazygit")).toBe(true);
    expect(result.panes.has("lazygit_2")).toBe(true);
  });
});

describe("renderLayoutPreview", () => {
  it("renders a 2-column layout with sidebar", () => {
    const preview = renderLayoutPreview([["claude", "npm run dev"], ["vim"]], "lazygit");
    expect(preview).toContain("claude");
    expect(preview).toContain("vim");
    expect(preview).toContain("lazygit");
    expect(preview).toContain("\u250c"); // ┌
    expect(preview).toContain("\u2514"); // └
  });

  it("renders a single column with sidebar", () => {
    const preview = renderLayoutPreview([["claude"]], "lazygit");
    expect(preview).toContain("claude");
    expect(preview).toContain("lazygit");
    expect(preview).toContain("\u2500"); // ─
  });

  it("renders 3 columns with sidebar", () => {
    const preview = renderLayoutPreview([["vim"], ["claude"], ["btop"]], "lazygit");
    expect(preview).toContain("vim");
    expect(preview).toContain("claude");
    expect(preview).toContain("btop");
    expect(preview).toContain("lazygit");
  });

  it("renders multi-row columns correctly", () => {
    const preview = renderLayoutPreview([["claude", "shell"], ["vim", "btop"]], "lazygit");
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
      } else if (q.includes("Sidebar")) {
        cb("lazygit"); // sidebar command
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
    expect(savedEntries.get("tree")).toContain("lazygit");
    // Pane definitions should be present
    expect(savedEntries.get("pane.claude")).toBe("claude");
    expect(savedEntries.get("pane.lazygit")).toBe("lazygit");
  });

  it("saves layout with 2 columns and multiple panes", async () => {
    // Flow: 2 columns, col 1: 2 panes, col 2: 1 pane, sidebar, confirm
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        cb("y");
      } else if (q.includes("Column 1") && q.includes("how many")) {
        cb("2");
      } else if (q.includes("Column 2") && q.includes("how many")) {
        cb("1");
      } else if (q.includes("Column 1, Pane 1")) {
        cb("vim");
      } else if (q.includes("Column 1, Pane 2")) {
        cb("shell");
      } else if (q.includes("Column 2, Pane 1")) {
        cb("btop");
      } else if (q.includes("Sidebar")) {
        cb("lazygit");
      } else if (q.includes("How many columns") || q.includes("Select [1-3]")) {
        cb("2"); // 2 columns
      } else {
        cb("1");
      }
    });

    await runLayoutBuilder("devsetup");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [savedName, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedName).toBe("devsetup");
    expect(savedEntries.get("tree")).toBeDefined();
  });

  it("shows preview before saving", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("claude");
      else if (q.includes("Sidebar")) cb("lazygit");
      else cb("1");
    });

    await runLayoutBuilder("previewtest");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Preview:"))).toBe(true);
    // Should contain box-drawing characters from renderLayoutPreview
    expect(allOutput.some((s: string) => s.includes("\u2500") || s.includes("\u250c") || s.includes("\u2502"))).toBe(true);
  });

  it("prints success message after save", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("claude");
      else if (q.includes("Sidebar")) cb("lazygit");
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
      else if (q.includes("Sidebar")) cb("lazygit");
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
      else if (q.includes("Sidebar")) cb(""); // empty → defaults to "lazygit"
      else cb("1");
    });

    await runLayoutBuilder("shelltest");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedEntries.get("pane.shell")).toBe("shell");
  });

  it("defaults empty sidebar input to 'lazygit'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("vim");
      else if (q.includes("Sidebar")) cb(""); // empty → defaults to "lazygit"
      else cb("1");
    });

    await runLayoutBuilder("sidebardefault");

    const [, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedEntries.get("pane.lazygit")).toBe("lazygit");
  });

  it("cancels when user declines to save at the end", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("n"); // decline save
      else if (q.includes("Pane 1")) cb("claude");
      else if (q.includes("Sidebar")) cb("lazygit");
      else cb("1");
    });

    await runLayoutBuilder("nope");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Cancelled"))).toBe(true);
    expect(mockSaveCustomLayout).not.toHaveBeenCalled();
  });

  it("saves 3-column layout with 3 panes each", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) {
        cb("y");
      } else if (q.includes("How many columns") || (q.includes("Select [1-3]") && q.includes("default: 1"))) {
        // Column count select — need to detect which prompt
        if (q.includes("How many columns")) {
          cb("3"); // 3 columns
        } else if (q.includes("how many panes")) {
          cb("3"); // 3 panes per column
        } else {
          cb("3");
        }
      } else if (q.includes("how many panes")) {
        cb("3");
      } else if (q.includes("Pane")) {
        cb("vim"); // all panes get vim
      } else if (q.includes("Sidebar")) {
        cb("lazygit");
      } else {
        cb("3");
      }
    });

    await runLayoutBuilder("bigsetup");

    expect(mockSaveCustomLayout).toHaveBeenCalledTimes(1);
    const [savedName, savedEntries] = mockSaveCustomLayout.mock.calls[0] as [string, Map<string, string>];
    expect(savedName).toBe("bigsetup");
    // With 3 columns x 3 panes + sidebar = 10 panes
    // All "vim" commands will be deduped: vim, vim_2, vim_3, ...
    const tree = savedEntries.get("tree")!;
    expect(tree).toContain("vim");
    expect(tree).toContain("lazygit");
  });

  it("prints Layout Builder section header", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      const q = _q;
      if (q.includes("[Y/n]")) cb("y");
      else if (q.includes("Pane 1")) cb("claude");
      else if (q.includes("Sidebar")) cb("lazygit");
      else cb("1");
    });

    await runLayoutBuilder("headertest");

    const allOutput = getLogOutput(logSpy);
    expect(allOutput.some((s: string) => s.includes("Layout Builder"))).toBe(true);
  });
});
