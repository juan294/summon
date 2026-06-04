import { describe, it, expect } from "vitest";
import {
  visibleLength,
  centerLabel,
  renderLayoutPreview,
  renderMiniPreview,
  renderTemplateGallery,
  getDisplayWidth,
} from "./layout-preview.js";

describe("visibleLength", () => {
  it("returns string length when no ANSI codes present", () => {
    expect(visibleLength("hello")).toBe(5);
  });

  it("strips ANSI codes from length count", () => {
    expect(visibleLength("\x1b[32mhello\x1b[0m")).toBe(5);
  });

  it("handles empty string", () => {
    expect(visibleLength("")).toBe(0);
  });
});

// --- FE-M1: getDisplayWidth for CJK/emoji ---

describe("getDisplayWidth (FE-M1 #505)", () => {
  it("ASCII character is width 1", () => {
    expect(getDisplayWidth("a")).toBe(1);
  });

  it("CJK character (あ, U+3042) is width 2", () => {
    expect(getDisplayWidth("あ")).toBe(2);
  });

  it("CJK character (中, U+4E2D) is width 2", () => {
    expect(getDisplayWidth("中")).toBe(2);
  });

  it("Hangul character (한, U+D55C) is width 2", () => {
    expect(getDisplayWidth("한")).toBe(2);
  });

  it("CJK Compatibility (U+F900 range) is width 2", () => {
    expect(getDisplayWidth("豈")).toBe(2);
  });

  it("CJK Unified Extension A (U+3400) is width 2", () => {
    expect(getDisplayWidth("㐀")).toBe(2);
  });

  it("wide emoji (🌟, U+1F31F) is width 2", () => {
    expect(getDisplayWidth("🌟")).toBe(2);
  });

  it("mixed string counts display widths correctly", () => {
    // "hello" (5) + "あ" (2) = 7
    expect(getDisplayWidth("helloあ")).toBe(7);
  });

  it("empty string is width 0", () => {
    expect(getDisplayWidth("")).toBe(0);
  });

  it("pure ASCII string matches character count", () => {
    expect(getDisplayWidth("editor")).toBe(6);
  });
});

// --- FE-M4: PreviewRenderer maxWidth clamping ---

describe("renderLayoutPreview maxWidth (FE-M4 #507)", () => {
  it("with maxWidth=40, no line exceeds 40 characters", () => {
    const grid = [["editor", "terminal"], ["sidebar"]];
    const result = renderLayoutPreview(grid, 40);
    for (const line of result.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it("without maxWidth, renders normally", () => {
    const grid = [["editor"], ["sidebar"]];
    const result = renderLayoutPreview(grid);
    expect(result).toContain("editor");
    expect(result).toContain("sidebar");
  });

  it("with very narrow maxWidth=20, still renders some output", () => {
    const grid = [["editor"]];
    const result = renderLayoutPreview(grid, 20);
    expect(result.length).toBeGreaterThan(0);
    for (const line of result.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("centerLabel", () => {
  it("centers short text in a wider cell", () => {
    const result = centerLabel("hi", 10);
    expect(result).toContain("hi");
    expect(result.length).toBe(10);
  });

  it("truncates text that exceeds width", () => {
    const result = centerLabel("a very long label that is too wide", 10);
    expect(result.length).toBe(10);
    expect(result).toContain("…");
  });
});

describe("renderLayoutPreview (basic)", () => {
  it("renders a grid layout with box-drawing characters", () => {
    const grid = [["editor"], ["sidebar"]];
    const result = renderLayoutPreview(grid);
    expect(result).toContain("┌");
    expect(result).toContain("┐");
    expect(result).toContain("└");
    expect(result).toContain("┘");
    expect(result).toContain("editor");
  });

  it("renders a multi-row column", () => {
    const grid = [["editor", "shell"], ["sidebar"]];
    const result = renderLayoutPreview(grid);
    expect(result).toContain("editor");
    expect(result).toContain("shell");
    expect(result).toContain("sidebar");
  });
});

describe("renderMiniPreview", () => {
  it("returns non-empty array of lines", () => {
    const lines = renderMiniPreview([1, 2]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("┌");
  });
});

describe("renderTemplateGallery", () => {
  it("returns empty string for empty template list", () => {
    expect(renderTemplateGallery([], 80)).toBe("");
  });

  it("renders a numbered list of templates", () => {
    const result = renderTemplateGallery(
      [{ label: "1+1", columns: [1, 1] }, { label: "2+1", columns: [2, 1] }],
      80,
    );
    expect(result).toContain("1)");
    expect(result).toContain("2)");
    expect(result).toContain("Build from scratch");
  });
});
