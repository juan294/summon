/**
 * Tests for src/ui/output.ts (#568 FE-S1, #598 UX-H1)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Isolate supportsColor so we can control color output per test
const mockSupportsColor = vi.fn(() => false);
const mockFormatUserError = vi.fn((msg: string) => `summon: error: ${msg}`);

vi.mock("../utils.js", () => ({
  supportsColor: () => mockSupportsColor(),
  formatUserError: (msg: string) => mockFormatUserError(msg),
}));

const { out, err, fail } = await import("./output.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockSupportsColor.mockReturnValue(false);
  mockFormatUserError.mockImplementation((msg: string) => `summon: error: ${msg}`);
});

describe("out()", () => {
  it("writes message + newline to stdout", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    out("hello world");
    expect(writeSpy).toHaveBeenCalledWith("hello world\n");
    writeSpy.mockRestore();
  });

  it("writes empty string as just newline", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    out("");
    expect(writeSpy).toHaveBeenCalledWith("\n");
    writeSpy.mockRestore();
  });
});

describe("err()", () => {
  it("writes message + newline to stderr without any prefix", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    err("hint: run summon --help");
    expect(writeSpy).toHaveBeenCalledWith("hint: run summon --help\n");
    writeSpy.mockRestore();
  });

  it("writes empty string as just newline (blank separator)", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    err("");
    expect(writeSpy).toHaveBeenCalledWith("\n");
    writeSpy.mockRestore();
  });
});

describe("fail()", () => {
  it("writes branded summon: error: prefix in no-color mode", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    fail("something went wrong");
    expect(writeSpy).toHaveBeenCalledWith("summon: error: something went wrong\n");
    writeSpy.mockRestore();
  });

  it("delegates to formatUserError (color handled there)", () => {
    mockFormatUserError.mockReturnValue("\x1b[31m✗ summon: error:\x1b[0m colored msg");
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    fail("colored msg");
    expect(mockFormatUserError).toHaveBeenCalledWith("colored msg");
    expect(writeSpy).toHaveBeenCalledWith("\x1b[31m✗ summon: error:\x1b[0m colored msg\n");
    writeSpy.mockRestore();
  });

  it("never calls process.exit", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit called"); });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => fail("msg")).not.toThrow("exit called");
    exitSpy.mockRestore();
  });
});
