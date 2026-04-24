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

vi.mock("../utils.js", () => ({
  exitWithUsageHint: (message?: string) => mockExitWithUsageHint(message),
}));

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
  it("rejects reserved preset names", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockIsPresetName.mockReturnValue(true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => validateLayoutNameOrExit("pair")).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith('Error: "pair" is a reserved preset name. Choose a different name.');
  });

  it("rejects invalid layout names", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockIsValidLayoutName.mockReturnValue(false);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => validateLayoutNameOrExit("bad name")).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith('Error: Invalid layout name "bad name".');
    expect(errorSpy).toHaveBeenCalledWith(
      "Names must start with a letter and contain only letters, digits, hyphens, and underscores.",
    );
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListCustomLayouts.mockReturnValue(["team-layout"]);

    expect(() => validateLayoutOrExit("wat", "--layout")).toThrow("usage:");
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: --layout must be a valid preset or custom layout name, got "wat".',
    );
    expect(errorSpy).toHaveBeenCalledWith("Valid presets: minimal, pair");
    expect(errorSpy).toHaveBeenCalledWith("Custom layouts: team-layout");
  });

  it("exits via exitWithUsageHint on path-traversal input, does not throw", () => {
    mockIsCustomLayout.mockImplementationOnce(() => {
      throw new Error('Invalid layout path: "../../../etc/passwd"');
    });
    expect(() => validateLayoutOrExit("../../../etc/passwd", "--layout")).toThrow("usage:");
    expect(mockExitWithUsageHint).toHaveBeenCalledWith("Error: --layout is not a valid layout name.");
  });
});

describe("layoutNotFoundOrExit", () => {
  it("prints guidance before exiting", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => layoutNotFoundOrExit("missing")).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith("Error: Layout not found: missing");
    expect(errorSpy).toHaveBeenCalledWith("Run 'summon layout list' to see available layouts.");
  });
});
