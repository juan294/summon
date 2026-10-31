import { describe, expect, it } from "vitest";
import { escapeControlChars, isDisplaySafe, validateTitleText } from "./sanitize.js";

describe("escapeControlChars", () => {
  it("escapes controls and bidi overrides; keeps plain and wide text", () => {
    expect(escapeControlChars("a\x1b[31m\tb\u202e\u2066")).toBe("a\\u001b[31m\\u0009b\\u202e\\u2066");
    expect(escapeControlChars("editor · 日本 ✳")).toBe("editor · 日本 ✳");
  });

  it("escapes exactly the class edges that titles reject, and nothing next to them", () => {
    const inside = ["\x00", "\x1f", "\x7f", "\x9f", "\u202a", "\u202e", "\u2066", "\u2069"];
    const outside = [" ", "~", "\xa0", "\u2029", "\u202f", "\u2065", "\u206a"];
    expect(inside.map(escapeControlChars)).toEqual(["\\u0000", "\\u001f", "\\u007f", "\\u009f", "\\u202a", "\\u202e", "\\u2066", "\\u2069"]);
    expect(outside.map(escapeControlChars)).toEqual(outside);
    for (const char of inside) expect(validateTitleText(`a${char}b`)).toBe("Title cannot contain control or bidi override/isolate characters.");
    for (const char of outside) expect(validateTitleText(`a${char}b`)).toBeNull();
  });

  it("leaves a ZWJ emoji sequence unchanged, so it displays as one grapheme (FE-L1)", () => {
    const family = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
    expect(escapeControlChars(`build ${family}`)).toBe(`build ${family}`);
    expect(isDisplaySafe(family)).toBe(true);
  });
});
