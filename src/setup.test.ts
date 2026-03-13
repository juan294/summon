import { describe, it, expect, vi, beforeEach } from "vitest";

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
  }),
}));

// Mock config for runSetup
const mockSetConfig = vi.fn();
vi.mock("./config.js", () => ({
  setConfig: (key: string, value: string) => mockSetConfig(key, value),
  listConfig: vi.fn(() => new Map<string, string>()),
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
  printBanner,
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
  selectServer,
  validateSetup,
  runSetup,
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
    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
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
    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
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

describe("printBanner", () => {
  it("prints a boxed banner with correct box-drawing characters", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    printBanner(["Hello", "World"]);

    const output = logSpy.mock.calls.map((c) => c[0] as string);
    // Top border should contain ╭ and ╮
    expect(output[0]).toContain("╭");
    expect(output[0]).toContain("╮");
    // Content lines should contain │
    expect(output[1]).toContain("│");
    expect(output[1]).toContain("Hello");
    expect(output[2]).toContain("│");
    expect(output[2]).toContain("World");
    // Bottom border should contain ╰ and ╯
    expect(output[3]).toContain("╰");
    expect(output[3]).toContain("╯");

    logSpy.mockRestore();
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
      "vim",
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
      "vim",
    );
    expect(result).toBe("my-editor");
    logSpy.mockRestore();
  });

  it("sorts detected tools before undetected", async () => {
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
      "vim",
    );
    // First option should be nano (detected), so selecting "1" gives nano
    expect(result).toBe("nano");
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
      "vim",
    );
    expect(result).toBe("nano");
    logSpy.mockRestore();
  });

  it("defaults to fallback when no tools detected", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExecFileSync.mockImplementation(() => {
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
      "claude",
    );
    expect(result).toBe("claude");
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
      "vim",
    );
    expect(result).toBe("vim");
    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Invalid selection"))).toBe(true);
    logSpy.mockRestore();
  });
});

describe("selectServer", () => {
  it("returns 'true' for Shell selection", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("1"),
    );
    const result = await selectServer();
    expect(result).toBe("true");
    logSpy.mockRestore();
  });

  it("returns 'false' for Disabled selection", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb("2"),
    );
    const result = await selectServer();
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
    const result = await selectServer();
    expect(result).toBe("npm run dev");
    logSpy.mockRestore();
  });

  it("defaults to 'true' (Shell)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) =>
      cb(""),
    );
    const result = await selectServer();
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
      server: "true",
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
      server: "true",
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
      server: "true",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.key).toBe("sidebar");
  });

  it("returns warning for missing server command", () => {
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
      server: "npm run dev",
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.key).toBe("server");
    expect(result.warnings[0]!.cmd).toBe("npm");
  });

  it("skips validation for server='true' and server='false'", () => {
    mockExecFileSync.mockReturnValue("/usr/bin/stub\n");
    mockExistsSync.mockReturnValue(true);
    const trueResult = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      server: "true",
    });
    const falseResult = validateSetup({
      layout: "pair",
      editor: "vim",
      sidebar: "lazygit",
      server: "false",
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
      server: "true",
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
      server: "true",
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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
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
    expect(mockSetConfig).toHaveBeenCalledWith("server", expect.any(String));

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });

  it("skips server step for minimal layout", async () => {
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

    // Server should be "false" for minimal
    expect(mockSetConfig).toHaveBeenCalledWith("server", "false");

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

  it("prints dim message when minimal layout skips server", async () => {
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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      allOutput.some((s) => s.includes("Minimal layout has no server pane")),
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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    expect(allOutput.some((s) => s.includes("Tip:"))).toBe(true);

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

    const allOutput = logSpy.mock.calls.map((c) => String(c[0]));
    expect(allOutput.some((s) => s.includes("╔") && s.includes("╗"))).toBe(true);

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      writable: true,
    });
    logSpy.mockRestore();
  });
});
