import { describe, it, expect } from "vitest";
import { LAYOUT_INFO, GRID_TEMPLATES } from "./setup-gallery.js";

describe("LAYOUT_INFO", () => {
  it("exports a non-empty record", () => {
    expect(Object.keys(LAYOUT_INFO).length).toBeGreaterThan(0);
  });

  it("contains the canonical named layouts", () => {
    const keys = Object.keys(LAYOUT_INFO);
    expect(keys).toContain("minimal");
    expect(keys).toContain("pair");
    expect(keys).toContain("full");
    expect(keys).toContain("cli");
    expect(keys).toContain("btop");
  });

  it("every entry has a non-empty desc field", () => {
    for (const [name, info] of Object.entries(LAYOUT_INFO)) {
      expect(typeof info.desc, `${name}.desc should be a string`).toBe("string");
      expect(info.desc.length, `${name}.desc should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty diagram field", () => {
    for (const [name, info] of Object.entries(LAYOUT_INFO)) {
      expect(typeof info.diagram, `${name}.diagram should be a string`).toBe("string");
      expect(info.diagram.length, `${name}.diagram should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("every diagram contains box-drawing characters", () => {
    const BOX_CHARS = /[┌┐└┘─│]/;
    for (const [name, info] of Object.entries(LAYOUT_INFO)) {
      expect(BOX_CHARS.test(info.diagram), `${name}.diagram should contain box-drawing chars`).toBe(true);
    }
  });

  it("layout names are unique (no duplicates)", () => {
    const keys = Object.keys(LAYOUT_INFO);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

describe("GRID_TEMPLATES", () => {
  it("exports a non-empty readonly array", () => {
    expect(GRID_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("every template has a non-empty label", () => {
    for (const t of GRID_TEMPLATES) {
      expect(typeof t.label).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("every template has a columns array with at least one column", () => {
    for (const t of GRID_TEMPLATES) {
      expect(Array.isArray(t.columns)).toBe(true);
      expect(t.columns.length).toBeGreaterThan(0);
    }
  });

  it("every column value is a positive integer", () => {
    for (const t of GRID_TEMPLATES) {
      for (const count of t.columns) {
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
    }
  });

  it("template labels are unique (no duplicates)", () => {
    const labels = GRID_TEMPLATES.map((t) => t.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  it("includes standard templates covering 1-pane and multi-pane configurations", () => {
    // At minimum, there should be a 2-column template and a 3-column template
    const twoCol = GRID_TEMPLATES.some((t) => t.columns.length === 2);
    const threeCol = GRID_TEMPLATES.some((t) => t.columns.length === 3);
    expect(twoCol).toBe(true);
    expect(threeCol).toBe(true);
  });
});
