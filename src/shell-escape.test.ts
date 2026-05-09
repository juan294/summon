import { describe, it, expect } from "vitest";
import { escapeAppleScript, shellQuote, shellDoubleQuote } from "./shell-escape.js";

describe("escapeAppleScript", () => {
  it("returns empty string unchanged", () => {
    expect(escapeAppleScript("")).toBe("");
  });

  it("leaves already-safe strings unchanged", () => {
    expect(escapeAppleScript("hello world")).toBe("hello world");
  });

  it("escapes backslash", () => {
    expect(escapeAppleScript("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quote", () => {
    expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
  });

  it("escapes newline", () => {
    expect(escapeAppleScript("a\nb")).toBe("a\\nb");
  });

  it("escapes carriage return", () => {
    expect(escapeAppleScript("a\rb")).toBe("a\\rb");
  });

  it("escapes composed payload", () => {
    expect(escapeAppleScript('back\\slash "quote"\nnewline\rreturn')).toBe(
      'back\\\\slash \\"quote\\"\\nnewline\\rreturn',
    );
  });
});

describe("shellQuote", () => {
  it("returns empty string as empty single-quoted string", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("wraps already-safe string in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quote", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("handles dollar sign (no escaping needed in single quotes)", () => {
    expect(shellQuote("$HOME")).toBe("'$HOME'");
  });

  it("handles backtick (no escaping needed in single quotes)", () => {
    expect(shellQuote("`pwd`")).toBe("'`pwd`'");
  });

  it("handles double quote (no escaping needed in single quotes)", () => {
    expect(shellQuote('"hello"')).toBe("'\"hello\"'");
  });

  it("escapes composed payload", () => {
    expect(shellQuote("it's a $test `backtick` \"quote\"")).toBe(
      "'it'\\''s a $test `backtick` \"quote\"'",
    );
  });
});

describe("shellDoubleQuote", () => {
  it("returns empty string unchanged", () => {
    expect(shellDoubleQuote("")).toBe("");
  });

  it("leaves already-safe strings unchanged", () => {
    expect(shellDoubleQuote("hello world")).toBe("hello world");
  });

  it("escapes backslash", () => {
    expect(shellDoubleQuote("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quote", () => {
    expect(shellDoubleQuote('"hello"')).toBe('\\"hello\\"');
  });

  it("escapes dollar sign", () => {
    expect(shellDoubleQuote("$HOME")).toBe("\\$HOME");
  });

  it("escapes backtick", () => {
    expect(shellDoubleQuote("`pwd`")).toBe("\\`pwd\\`");
  });

  it("escapes composed payload", () => {
    expect(shellDoubleQuote('back\\slash "quote" $var `cmd`')).toBe(
      'back\\\\slash \\"quote\\" \\$var \\`cmd\\`',
    );
  });
});
