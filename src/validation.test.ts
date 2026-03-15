import { describe, it, expect, vi } from "vitest";
import { parseIntInRange, validateIntFlag, validateFloatFlag } from "./validation.js";

describe("parseIntInRange", () => {
  it("returns ok:true with parsed value for valid integer in range", () => {
    const result = parseIntInRange("5", 1, 10);
    expect(result).toEqual({ ok: true, value: 5 });
  });

  it("returns ok:true at the minimum boundary", () => {
    const result = parseIntInRange("1", 1, 10);
    expect(result).toEqual({ ok: true, value: 1 });
  });

  it("returns ok:true at the maximum boundary", () => {
    const result = parseIntInRange("10", 1, 10);
    expect(result).toEqual({ ok: true, value: 10 });
  });

  it("returns ok:false for value below minimum", () => {
    const result = parseIntInRange("0", 1, 10);
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false for value above maximum", () => {
    const result = parseIntInRange("11", 1, 10);
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false for NaN input", () => {
    const result = parseIntInRange("foo", 1, 10);
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false for empty string", () => {
    const result = parseIntInRange("", 1, 10);
    expect(result).toEqual({ ok: false });
  });

  it("uses MAX_SAFE_INTEGER as default max", () => {
    const result = parseIntInRange("999999", 1);
    expect(result).toEqual({ ok: true, value: 999999 });
  });

  it("returns ok:false for negative values when min is 1", () => {
    const result = parseIntInRange("-1", 1);
    expect(result).toEqual({ ok: false });
  });

  it("handles float strings by truncating to integer", () => {
    // parseInt("3.7") returns 3
    const result = parseIntInRange("3.7", 1, 10);
    expect(result).toEqual({ ok: true, value: 3 });
  });
});

describe("validateIntFlag", () => {
  it("returns parsed value on success", () => {
    expect(validateIntFlag("panes", "3", 1)).toBe(3);
  });

  it("exits on invalid value", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    expect(() => validateIntFlag("panes", "abc", 1)).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--panes"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("positive integer"));

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits on out-of-range value with range description", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    expect(() => validateIntFlag("editor-size", "200", 1, 99)).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("1-99"));

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("validateFloatFlag", () => {
  it("returns parsed value on success", () => {
    expect(validateFloatFlag("font-size", "14.5")).toBe(14.5);
  });

  it("exits on non-numeric value", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    expect(() => validateFloatFlag("font-size", "abc")).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--font-size"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("positive number"));

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits on zero", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    expect(() => validateFloatFlag("font-size", "0")).toThrow("exit");

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
