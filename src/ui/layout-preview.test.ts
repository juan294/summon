import { describe, it, expect } from "vitest";
import {
  renderLayoutPreview,
  renderMiniPreview,
  renderTemplateGallery,
  centerLabel,
  visibleLength,
} from "./layout-preview.js";

// Box-drawing character constants for assertions
const BOX_TL = "┌"; // ┌
const BOX_TR = "┐"; // ┐
const BOX_BL = "└"; // └
const BOX_BR = "┘"; // ┘
const BOX_H  = "─"; // ─
const BOX_V  = "│"; // │

describe("renderLayoutPreview", () => {
  it("renders a single-pane layout with box-drawing borders", () => {
    const result = renderLayoutPreview([["editor"]]);
    expect(result).toContain(BOX_TL);
    expect(result).toContain(BOX_TR);
    expect(result).toContain(BOX_BL);
    expect(result).toContain(BOX_BR);
    expect(result).toContain(BOX_H);
    expect(result).toContain(BOX_V);
    expect(result).toContain("editor");
  });

  it("renders a 2-pane horizontal layout (two columns, one row each)", () => {
    const result = renderLayoutPreview([["left"], ["right"]]);
    // Both pane labels present
    expect(result).toContain("left");
    expect(result).toContain("right");
    // Has top/bottom corners and verticals
    expect(result).toContain(BOX_TL);
    expect(result).toContain(BOX_BR);
    // Vertical separator between columns
    expect(result).toContain(BOX_V);
  });

  it("renders a 2-pane vertical layout (one column, two rows)", () => {
    const result = renderLayoutPreview([["top", "bottom"]]);
    expect(result).toContain("top");
    expect(result).toContain("bottom");
    // Has a row separator (teeRight ├ or teeLeft ┤)
    expect(result).toContain("├"); // ├
  });

  it("renders a 2×2 grid layout with row separators and column separators", () => {
    const result = renderLayoutPreview([["a", "b"], ["c", "d"]]);
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).toContain("d");
    // Cross character ┼ appears when separator lines span multiple columns with splits
    // At minimum a row separator exists
    expect(result).toContain("─"); // ─ (horizontal separator line)
  });

  it("returns a multi-line string", () => {
    const result = renderLayoutPreview([["vim"]]);
    const lines = result.split("\n");
    // top border + (PANE_HEIGHT=3 content rows) + bottom border = at least 5 lines
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it("renders columns of different heights without error", () => {
    const result = renderLayoutPreview([["e1", "e2"], ["side"]]);
    expect(result).toContain("e1");
    expect(result).toContain("e2");
    expect(result).toContain("side");
  });

  it("renders placeholder '?' labels in dim style", () => {
    const result = renderLayoutPreview([["nvim", "?"]]);
    // The placeholder is rendered (may be dim/ANSI escaped)
    expect(result).toContain("?");
  });
});

describe("renderMiniPreview", () => {
  it("renders a single column with top and bottom borders", () => {
    const lines = renderMiniPreview([1]);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain(BOX_TL);
    expect(lines[lines.length - 1]).toContain(BOX_BL);
  });

  it("renders two columns", () => {
    const lines = renderMiniPreview([1, 1]);
    // Top border has two segments joined by teeDown ┬
    expect(lines[0]).toContain("┬"); // ┬
  });

  it("renders a column with 2 rows (includes row separator)", () => {
    const lines = renderMiniPreview([2, 1]);
    const joined = lines.join("\n");
    // Row separator character ├ or ┤ should appear
    expect(joined).toMatch(/[├┤┼]/);
  });

  it("returns more lines for taller columns", () => {
    const tall = renderMiniPreview([3]);
    const short = renderMiniPreview([1]);
    expect(tall.length).toBeGreaterThan(short.length);
  });
});

describe("renderTemplateGallery", () => {
  const templates = [
    { label: "1 + 1", columns: [1, 1] },
    { label: "2 + 1", columns: [2, 1] },
    { label: "1 + 2", columns: [1, 2] },
  ];

  it("returns empty string for empty templates array", () => {
    expect(renderTemplateGallery([], 120)).toBe("");
  });

  it("contains all template labels", () => {
    const output = renderTemplateGallery(templates, 120);
    expect(output).toContain("1 + 1");
    expect(output).toContain("2 + 1");
    expect(output).toContain("1 + 2");
  });

  it("contains numbered entries starting from 1", () => {
    const output = renderTemplateGallery(templates, 120);
    expect(output).toContain("1)");
    expect(output).toContain("2)");
    expect(output).toContain("3)");
  });

  it("appends 'Build from scratch' as the final entry", () => {
    const output = renderTemplateGallery(templates, 120);
    expect(output).toContain("Build from scratch");
    // It should be numbered one past the last template
    expect(output).toContain(`${templates.length + 1})`);
  });

  it("restricts items per row on narrow terminals", () => {
    // On very narrow terminals, perRow should be 1 so each item occupies full width
    const narrow = renderTemplateGallery(templates, 25);
    const wide = renderTemplateGallery(templates, 200);
    // Narrow output should have more lines than wide (items stacked)
    expect(narrow.split("\n").length).toBeGreaterThanOrEqual(wide.split("\n").length);
  });
});

describe("visibleLength", () => {
  it("returns the length of plain strings unchanged", () => {
    expect(visibleLength("hello")).toBe(5);
  });

  it("excludes ANSI escape sequences from the count", () => {
    expect(visibleLength("\x1b[1mhello\x1b[0m")).toBe(5);
  });

  it("returns 0 for an empty string", () => {
    expect(visibleLength("")).toBe(0);
  });

  it("handles multiple ANSI codes correctly", () => {
    expect(visibleLength("\x1b[32mOK\x1b[0m \x1b[31mERR\x1b[0m")).toBe(6); // "OK ERR"
  });
});

describe("centerLabel", () => {
  it("centers a short label within the given width", () => {
    const result = centerLabel("hi", 10);
    expect(result.length).toBe(10);
    expect(result.trim()).toBe("hi");
  });

  it("truncates a label that exceeds maxLen (width - 2) and adds ellipsis", () => {
    const result = centerLabel("toolongtext", 8);
    expect(result.length).toBe(8);
    expect(result).toContain("…"); // …
  });

  it("produces output of exactly the requested width", () => {
    for (const width of [6, 10, 14, 20]) {
      expect(centerLabel("x", width).length).toBe(width);
    }
  });
});
