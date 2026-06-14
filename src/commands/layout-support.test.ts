import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPresetNames = vi.fn();
const mockIsPresetName = vi.fn();
const mockIsCustomLayout = vi.fn();
const mockIsValidLayoutName = vi.fn();
const mockListCustomLayouts = vi.fn();
const mockExitWithUsageHint = vi.fn((message?: string) => {
  throw new Error(`usage:${message ?? ""}`);
});

vi.mock("../layout.js", () => ({
  getPresetNames: (...args: unknown[]) => mockGetPresetNames(...args),
  isPresetName: (...args: unknown[]) => mockIsPresetName(...args),
}));

vi.mock("../config.js", () => ({
  isCustomLayout: (...args: unknown[]) => mockIsCustomLayout(...args),
  isValidLayoutName: (...args: unknown[]) => mockIsValidLayoutName(...args),
  listCustomLayouts: (...args: unknown[]) => mockListCustomLayouts(...args),
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
  };
});

const {
  layoutNotFoundOrExit,
  treeToGrid,
  validateLayoutNameOrExit,
  validateLayoutOrExit,
} = await import("./layout-support.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPresetNames.mockReturnValue(["minimal", "pair"]);
  mockIsPresetName.mockReturnValue(false);
  mockIsCustomLayout.mockReturnValue(false);
  mockIsValidLayoutName.mockReturnValue(true);
  mockListCustomLayouts.mockReturnValue([]);
});

describe("treeToGrid", () => {
  it("maps right splits to columns and down splits to rows", () => {
    const tree = {
      type: "split",
      direction: "right",
      first: {
        type: "split",
        direction: "down",
        first: { type: "pane", name: "editor" },
        second: { type: "pane", name: "shell" },
      },
      second: { type: "pane", name: "sidebar" },
    };

    expect(treeToGrid(tree as never, new Map([
      ["editor", "nvim"],
      ["shell", "zsh"],
      ["sidebar", "lazygit"],
    ]))).toEqual([
      ["nvim", "zsh"],
      ["lazygit"],
    ]);
  });

  it("falls back to pane names when no command label is defined", () => {
    const tree = { type: "pane", name: "editor" };

    expect(treeToGrid(tree as never, new Map())).toEqual([["editor"]]);
  });

  it("flattens nested non-down splits into a single row", () => {
    const tree = {
      type: "split",
      direction: "up",
      first: { type: "pane", name: "left" },
      second: {
        type: "split",
        direction: "right",
        first: { type: "pane", name: "top" },
        second: { type: "pane", name: "bottom" },
      },
    };

    expect(treeToGrid(tree as never, new Map())).toEqual([["left | top | bottom"]]);
  });
});

describe("validateLayoutNameOrExit", () => {
  it("accepts valid non-preset layout names", () => {
    expect(() => validateLayoutNameOrExit("team-layout")).not.toThrow();
  });

  it("rejects reserved preset names", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockIsPresetName.mockReturnValue(true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => validateLayoutNameOrExit("pair")).toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain('"pair" is a reserved preset name. Choose a different name.');
    expect(allWrites).toContain("summon: error:");
    writeSpy.mockRestore();
  });

  it("rejects invalid layout names", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockIsValidLayoutName.mockReturnValue(false);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => validateLayoutNameOrExit("bad name")).toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain('Invalid layout name "bad name".');
    expect(allWrites).toContain(
      "Names must start with a letter and contain only letters, digits, hyphens, and underscores.",
    );
    writeSpy.mockRestore();
  });
});

describe("validateLayoutOrExit", () => {
  it("accepts preset or custom layouts", () => {
    mockIsPresetName.mockReturnValueOnce(true);
    expect(() => validateLayoutOrExit("pair", "--layout")).not.toThrow();

    mockIsPresetName.mockReturnValueOnce(false);
    mockIsCustomLayout.mockReturnValueOnce(true);
    expect(() => validateLayoutOrExit("custom", "--layout")).not.toThrow();
  });

  it("prints valid preset and custom layout lists for invalid names", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockListCustomLayouts.mockReturnValue(["team-layout"]);

    expect(() => validateLayoutOrExit("wat", "--layout")).toThrow("usage:");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain(
      '--layout must be a valid preset or custom layout name, got "wat".',
    );
    expect(allWrites).toContain("Valid presets: minimal, pair");
    expect(allWrites).toContain("Custom layouts: team-layout");
    writeSpy.mockRestore();
  });

  it("omits custom layout guidance when there are no custom layouts", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(() => validateLayoutOrExit("wat", "--layout")).toThrow("usage:");

    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).not.toContain("Custom layouts:");
    writeSpy.mockRestore();
  });

  it("exits via exitWithUsageHint on path-traversal input, does not throw", () => {
    mockIsCustomLayout.mockImplementationOnce(() => {
      throw new Error('Invalid layout path: "../../../etc/passwd"');
    });
    expect(() => validateLayoutOrExit("../../../etc/passwd", "--layout")).toThrow("usage:");
    expect(mockExitWithUsageHint).toHaveBeenCalledWith("--layout is not a valid layout name.");
  });
});

describe("layoutNotFoundOrExit", () => {
  it("prints guidance before exiting", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => layoutNotFoundOrExit("missing")).toThrow("exit:1");
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("Layout not found: missing");
    expect(allWrites).toContain("summon: error:");
    expect(allWrites).toContain("Run 'summon layout list' to see available layouts.");
    writeSpy.mockRestore();
  });
});
