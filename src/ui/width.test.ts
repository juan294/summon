import { describe, it, expect, vi } from "vitest";
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

describe("FE-L1: emoji, zero-width code points and graphemes", () => {
  it("counts emoji-presentation symbols in U+2300–2BFF as 2 columns", () => {
    for (const s of ["✨", "✅", "❌", "⚡", "⭐", "⌚", "⌛"]) {
      expect(getDisplayWidth(s)).toBe(2);
    }
  });

  it("keeps text-presentation symbols narrow (the status glyphs and dots)", () => {
    for (const s of ["⚠", "✓", "✗", "⋯", "●", "○", "❤"]) {
      expect(getDisplayWidth(s)).toBe(1);
    }
  });

  it("counts CJK Extension B and later as 2 columns", () => {
    expect(isWideCodePoint(0x20000)).toBe(true);
    expect(isWideCodePoint(0x3fffd)).toBe(true);
    expect(getDisplayWidth("\u{20BB7}\u{2A6D6}")).toBe(4);
  });

  it("counts a NFD accent as 0 columns", () => {
    expect(getDisplayWidth("café")).toBe(4);
    expect(getDisplayWidth("café")).toBe(4);
  });

  it("counts a ZWJ sequence as one wide character", () => {
    expect(getDisplayWidth("\u{1F468}‍\u{1F469}‍\u{1F467}")).toBe(2);
    expect(getDisplayWidth("a‍b")).toBe(2);
  });

  it("counts a VS16 emoji as 2 columns and the selector itself as 0", () => {
    expect(getDisplayWidth("❤️")).toBe(2);
    expect(getDisplayWidth("✅️")).toBe(2);
    expect(getDisplayWidth("️")).toBe(0);
  });

  it("counts a flag (two regional indicators) as 2 columns", () => {
    expect(getDisplayWidth("\u{1F1FA}\u{1F1F8}")).toBe(2);
  });

  it("CJK still counts 2 per character", () => {
    expect(getDisplayWidth("日本語")).toBe(6);
  });

  it("never truncates inside a grapheme", () => {
    // "cafe" + U+0301: the accent stays with its "e" or both go
    expect(truncate("café-bar", 5)).toBe("café…");
    expect(truncate("café-bar", 4)).toBe("caf…");
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    expect(truncate(`${family}${family}x`, 4)).toBe(`${family}…`);
    expect(truncate(`ab${family}cd`, 4)).toBe("ab…");
    expect(truncate("❤️❤️xx", 4)).toBe("❤️…");
  });

  it("truncated output always fits the requested width", () => {
    const samples = ["✨feat/sparkle-branch", "é".repeat(30), "\u{20BB7}".repeat(20), "\u{1F1FA}\u{1F1F8}".repeat(10)];
    for (const s of samples) {
      for (let max = 1; max <= 12; max++) {
        expect(getDisplayWidth(truncate(s, max))).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe("Intl.Segmenter is created lazily (cold start)", () => {
  it("is never constructed on import or for pure-ASCII text, and once for other text", async () => {
    vi.resetModules();
    const Real = Intl.Segmenter;
    const constructed = vi.fn();
    const setSegmenter = (value: typeof Real) => Object.defineProperty(Intl, "Segmenter", { value, configurable: true, writable: true });
    setSegmenter(class extends Real {
      constructor(...args: ConstructorParameters<typeof Real>) {
        super(...args);
        constructed();
      }
    });
    try {
      const fresh = await import("./width.js");
      expect(fresh.getDisplayWidth("hello world")).toBe(11);
      expect(fresh.truncate("abcdefghij", 5)).toBe("abcd…");
      expect(fresh.truncate("short", 20)).toBe("short");
      expect(constructed).not.toHaveBeenCalled();
      expect(fresh.getDisplayWidth("日本語")).toBe(6);
      expect(fresh.truncate("café-bar", 5)).toBe("café…");
      expect(constructed).toHaveBeenCalledTimes(1);
    } finally {
      setSegmenter(Real);
    }
  });
});
