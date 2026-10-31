import { describe, expect, it } from "vitest";
import { escapeControlChars, isDisplaySafe } from "./sanitize.js";

describe("escapeControlChars", () => {
  it("escapes controls and bidi overrides; keeps plain and wide text", () => {
    expect(escapeControlChars("a\x1b[31m\tb\u202e\u2066")).toBe("a\\u001b[31m\\u0009b\\u202e\\u2066");
    expect(escapeControlChars("editor · 日本 ✳")).toBe("editor · 日本 ✳");
  });

  it("leaves a ZWJ emoji sequence unchanged, so it displays as one grapheme (FE-L1)", () => {
    const family = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
    expect(escapeControlChars(`build ${family}`)).toBe(`build ${family}`);
    expect(isDisplaySafe(family)).toBe(true);
  });
});
