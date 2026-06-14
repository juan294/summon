import { describe, it, expect } from "vitest";
import { isWideCodePoint, getDisplayWidth, truncate } from "./width.js";

describe("isWideCodePoint", () => {
  it("returns true for a CJK code point", () => {
    expect(isWideCodePoint(0x4e00)).toBe(true); // CJK Unified Ideograph
  });

  it("returns false for an ASCII code point", () => {
    expect(isWideCodePoint(0x0041)).toBe(false); // 'A'
  });

  it("returns true for an emoji in the 1F300-1FFFF range", () => {
    expect(isWideCodePoint(0x1f680)).toBe(true); // 🚀
  });

  it("returns false for a regular Latin character", () => {
    expect(isWideCodePoint(0x0061)).toBe(false); // 'a'
  });
});

describe("getDisplayWidth", () => {
  it("ASCII string: each character is width 1", () => {
    expect(getDisplayWidth("hello")).toBe(5);
  });

  it("empty string: width 0", () => {
    expect(getDisplayWidth("")).toBe(0);
  });

  it("CJK characters: each is width 2", () => {
    expect(getDisplayWidth("日本語")).toBe(6);
  });

  it("mixed ASCII + CJK", () => {
    expect(getDisplayWidth("ab日")).toBe(4); // 1 + 1 + 2
  });

  it("emoji (wide): width 2 each", () => {
    expect(getDisplayWidth("🚀🚀")).toBe(4);
  });
});

describe("truncate — shared canonical implementation (#578 UX-L3)", () => {
  it("returns string unchanged when it fits within maxLen", () => {
    expect(truncate("main", 10)).toBe("main");
  });

  it("returns empty string when maxLen is 0", () => {
    expect(truncate("hello", 0)).toBe("");
  });

  it("returns empty string when maxLen is negative", () => {
    expect(truncate("hello", -1)).toBe("");
  });

  it("returns just ellipsis when maxLen is 1", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  it("truncates with ellipsis when string exceeds maxLen", () => {
    const result = truncate("a-very-long-branch-name", 20);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("exact-length string is returned unchanged", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("truncates to exactly maxLen characters including ellipsis for ASCII", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toBe("abcd…");
    expect(result.length).toBe(5);
  });

  it("wide chars (CJK): fits exactly at display width — no truncation", () => {
    // "日本語" = display width 6
    expect(truncate("日本語", 6)).toBe("日本語");
  });

  it("wide chars (CJK): truncates when display width exceeds maxLen", () => {
    // "日本語app" = 6 + 3 = 9; truncate to 5: "日本…" = 4 + 1 = 5
    expect(truncate("日本語app", 5)).toBe("日本…");
  });

  it("wide chars (emoji): fits exactly without truncation", () => {
    // "🚀🚀" = display width 4; maxLen 4 — no truncation
    expect(truncate("🚀🚀", 4)).toBe("🚀🚀");
  });

  it("wide chars (emoji): truncates with ellipsis at correct display column", () => {
    // "🚀🚀🚀" = display width 6; maxLen 5: "🚀🚀…" = 4 + 1 = 5
    expect(truncate("🚀🚀🚀", 5)).toBe("🚀🚀…");
  });

  it("ASCII strings behave correctly (regression from refactor)", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
    expect(truncate("abcdef", 5)).toBe("abcd…");
  });

  it("monitor.ts truncate and ansi.ts truncateLine produce identical results", async () => {
    // Cross-module consistency check: both modules must delegate to the same implementation
    const { truncate: monitorTruncate } = await import("../monitor.js");
    const { truncateLine } = await import("./ansi.js");

    const testCases: [string, number][] = [
      ["hello world", 5],
      ["日本語abc", 5],
      ["🚀🚀🚀", 5],
      ["short", 20],
      ["", 10],
    ];

    for (const [str, len] of testCases) {
      expect(monitorTruncate(str, len)).toBe(truncate(str, len));
      expect(truncateLine(str, len)).toBe(truncate(str, len));
    }
  });
});
