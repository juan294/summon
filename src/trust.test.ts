import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Mock node:fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRealpathSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
  readFileSync: (path: string, encoding: string) => mockReadFileSync(path, encoding),
  writeFileSync: (path: string, data: string, encoding: string) => mockWriteFileSync(path, data, encoding),
  mkdirSync: (path: string, opts: unknown) => mockMkdirSync(path, opts),
  realpathSync: (path: string) => mockRealpathSync(path),
  statSync: (path: string) => mockStatSync(path),
}));

// Mock node:os
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

// Import after mocks
const { hashSummonFile, isTrusted, trustProject, assertTrusted, handleTrustCommand, SummonError, clearTrustCache } = await import("./trust.js");

const TRUST_FILE = "/home/testuser/.config/summon/trust.json";

/** Helper: compute expected sha256 hex of content */
function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTrustCache();
  // Default: realpathSync resolves to the same path (simulates absolute paths that exist)
  mockRealpathSync.mockImplementation((p: string) => p);
  // Default: statSync returns a fake mtime
  mockStatSync.mockImplementation(() => ({ mtimeMs: 1000 }));
});

describe("SummonError", () => {
  it("is an instance of Error", () => {
    const err = new SummonError("test message");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SummonError);
  });

  it("has name SummonError", () => {
    const err = new SummonError("test message");
    expect(err.name).toBe("SummonError");
  });

  it("preserves the message", () => {
    const err = new SummonError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });
});

describe("hashSummonFile", () => {
  it("returns null when no .summon file exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(hashSummonFile("/some/dir")).toBeNull();
  });

  it("returns a sha256 hex string when .summon exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("editor = vim\n");
    const result = hashSummonFile("/some/dir");
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns same hash for same content", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("editor = vim\n");
    const h1 = hashSummonFile("/dir1");
    const h2 = hashSummonFile("/dir2");
    expect(h1).toBe(h2);
  });

  it("returns different hash for different content", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce("editor = vim\n")
      .mockReturnValueOnce("editor = nano\n");
    const h1 = hashSummonFile("/dir1");
    const h2 = hashSummonFile("/dir2");
    expect(h1).not.toBe(h2);
  });

  it("reads from <dir>/.summon path", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("");
    hashSummonFile("/my/project");
    expect(mockReadFileSync).toHaveBeenCalledWith("/my/project/.summon", "utf-8");
  });

  it("returns hash matching manual sha256 calculation", () => {
    const content = "editor = vim\nsidebar = lazygit\n";
    const expected = sha256(content);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);
    expect(hashSummonFile("/proj")).toBe(expected);
  });
});

describe("isTrusted", () => {
  it("returns true when no .summon file exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(isTrusted("/some/dir")).toBe(true);
  });

  it("returns false when .summon exists but trust.json does not exist", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      if (p === TRUST_FILE) return false;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");
    expect(isTrusted("/some/dir")).toBe(false);
  });

  it("returns false when .summon exists and hash doesn't match", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return "editor = vim\n";
      // trust.json with wrong hash
      return JSON.stringify({ "/some/dir": "deadbeef" });
    });
    expect(isTrusted("/some/dir")).toBe(false);
  });

  it("returns true when .summon hash matches stored hash", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ "/some/dir": hash });
    });
    expect(isTrusted("/some/dir")).toBe(true);
  });

  it("returns false when trust.json is malformed JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return "editor = vim\n";
      return "not-json{{{";
    });
    expect(isTrusted("/some/dir")).toBe(false);
  });

  it("returns false when trust.json contains an array (wrong shape)", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return "editor = vim\n";
      return JSON.stringify([]);
    });
    expect(isTrusted("/some/dir")).toBe(false);
  });

  it("computes and stores the same hash for matching content", () => {
    const content = "editor = vim\nsidebar = lazygit\n";
    const expectedHash = sha256(content);

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ "/proj": expectedHash });
    });

    expect(isTrusted("/proj")).toBe(true);
  });
});

describe("trustProject", () => {
  it("writes the hash to trust.json", () => {
    const content = "editor = vim\n";
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      if (p === TRUST_FILE) return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(content);

    trustProject("/myproject");

    expect(mockMkdirSync).toHaveBeenCalledWith(
      "/home/testuser/.config/summon",
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      TRUST_FILE,
      expect.stringContaining("/myproject"),
      "utf-8",
    );
  });

  it("no-ops when no .summon file exists", () => {
    mockExistsSync.mockReturnValue(false);
    trustProject("/myproject");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("merges with existing trust database", () => {
    const content = "editor = vim\n";
    const existingHash = sha256("other content\n");
    const existingDb = JSON.stringify({ "/other": existingHash });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return existingDb;
    });

    trustProject("/myproject");

    const written = mockWriteFileSync.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as Record<string, string>;
    expect(parsed["/other"]).toBe(existingHash);
    expect(typeof parsed["/myproject"]).toBe("string");
    expect(parsed["/myproject"]).toHaveLength(64); // sha256 hex
  });

  it("overwrites stale hash when content changes", () => {
    const oldContent = "editor = vim\n";
    const newContent = "editor = nano\n";
    const oldHash = sha256(oldContent);
    const existingDb = JSON.stringify({ "/proj": oldHash });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return newContent;
      return existingDb;
    });

    trustProject("/proj");

    const written = mockWriteFileSync.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as Record<string, string>;
    const newHash = sha256(newContent);
    expect(parsed["/proj"]).toBe(newHash);
    expect(parsed["/proj"]).not.toBe(oldHash);
  });
});

describe("assertTrusted", () => {
  it("does not throw when no .summon file exists", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => assertTrusted("/some/dir")).not.toThrow();
  });

  it("throws SummonError when .summon exists but is not trusted", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false; // trust.json doesn't exist
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    expect(() => assertTrusted("/some/dir")).toThrow(SummonError);
  });

  it("throws with the correct message mentioning summon trust command", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    expect(() => assertTrusted("/some/dir")).toThrow(/summon trust \./);
  });

  it("throws with message mentioning --no-project-config", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    expect(() => assertTrusted("/some/dir")).toThrow(/--no-project-config/);
  });

  it("does not throw when .summon exists and is trusted", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ "/some/dir": hash });
    });

    expect(() => assertTrusted("/some/dir")).not.toThrow();
  });
});

describe("path normalization", () => {
  it("trusting via relative path (.) is found when queried with absolute path", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    const absPath = "/home/testuser/myproject";

    // realpathSync resolves "." to the absolute path
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === ".") return absPath;
      return p;
    });

    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      if (p === TRUST_FILE) return false; // no existing trust.json before write
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      // After trust is written, simulate reading it back
      return JSON.stringify({ [absPath]: hash });
    });

    // Trust via relative path "."
    trustProject(".");

    // Verify the DB was written with the absolute key
    const written = mockWriteFileSync.mock.calls[0]![1] as string;
    const parsed = JSON.parse(written) as Record<string, string>;
    expect(parsed[absPath]).toBe(hash);
    expect(parsed["."]).toBeUndefined();

    // Now isTrusted with the absolute path should return true
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ [absPath]: hash });
    });

    expect(isTrusted(absPath)).toBe(true);
  });

  it("trusting via absolute path is found when queried with relative path (.)", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    const absPath = "/home/testuser/myproject";

    // realpathSync normalizes both absolute path and "." to absPath
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === "." || p === absPath) return absPath;
      return p;
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ [absPath]: hash });
    });

    // isTrusted with "." should normalize to absPath and find the trust entry
    expect(isTrusted(".")).toBe(true);
  });
});

describe("isTrusted mtime memoization", () => {
  it("does not rehash on second call when mtime is unchanged", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    mockStatSync.mockReturnValue({ mtimeMs: 5000 });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ "/proj": hash });
    });
    mockExistsSync.mockReturnValue(true);

    isTrusted("/proj");
    isTrusted("/proj");

    // readFileSync for .summon should be called only once (second call hits cache)
    const summonCalls = mockReadFileSync.mock.calls.filter((args: unknown[]) => typeof args[0] === "string" && args[0].endsWith(".summon"));
    expect(summonCalls.length).toBe(1);
  });

  it("rehashes when mtime changes", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    mockStatSync.mockReturnValueOnce({ mtimeMs: 5000 }).mockReturnValueOnce({ mtimeMs: 6000 });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ "/proj": hash });
    });
    mockExistsSync.mockReturnValue(true);

    isTrusted("/proj");
    isTrusted("/proj");

    const summonCalls = mockReadFileSync.mock.calls.filter((args: unknown[]) => typeof args[0] === "string" && args[0].endsWith(".summon"));
    expect(summonCalls.length).toBe(2);
  });

  it("returns true immediately when file does not exist (no statSync call)", () => {
    mockExistsSync.mockReturnValue(false);

    expect(isTrusted("/proj")).toBe(true);
    expect(mockStatSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});

describe("assertTrusted fail-closed", () => {
  it("throws when isTrusted throws a non-ENOENT error (e.g. EACCES on .summon file)", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false; // trust.json doesn't exist
    });

    // Simulate a permission error when reading the .summon file itself
    const permError = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    mockReadFileSync.mockImplementation((_p: string) => {
      throw permError;
    });

    expect(() => assertTrusted("/some/dir")).toThrow(/Cannot verify trust/);
  });
});

describe("handleTrustCommand", () => {
  it("exits with error when no .summon file exists", () => {
    mockExistsSync.mockReturnValue(false);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => handleTrustCommand("/some/dir")).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No .summon file found"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("prints confirmation when .summon file is trusted", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    handleTrustCommand("/myproject");

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Trusted .summon file"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("SHA-256"));
    logSpy.mockRestore();
  });

  it("writes to trust.json when trusting a project", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    handleTrustCommand("/myproject");

    expect(mockWriteFileSync).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
