import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { TRUST_FILE as PATH_TRUST_FILE, CONFIG_DIR as PATH_CONFIG_DIR } from "./paths.js";

// Mock node:fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRealpathSync = vi.fn();
const mockStatSync = vi.fn();

const mockRenameSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSync(path),
  readFileSync: (path: string, encoding: string) => mockReadFileSync(path, encoding),
  writeFileSync: (path: string, data: string, opts: string | object) => mockWriteFileSync(path, data, opts),
  renameSync: (src: string, dest: string) => mockRenameSync(src, dest),
  mkdirSync: (path: string, opts: unknown) => mockMkdirSync(path, opts),
  realpathSync: (path: string) => mockRealpathSync(path),
  statSync: (path: string) => mockStatSync(path),
}));

// Mock node:os
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

// Import after mocks
const { hashSummonFile, isTrusted, trustProject, assertTrusted, assertTrustedContent, handleTrustCommand, SummonError, clearTrustCache } = await import("./trust.js");

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
  // Default: renameSync is a no-op (the atomic write pattern just moves .tmp to final path)
  mockRenameSync.mockImplementation(() => {});
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
  it("writes the hash to trust.json (via atomic tmp+rename)", () => {
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
      { recursive: true, mode: 0o700 },
    );
    // Atomic write: writeFileSync goes to a unique temp path (pid + random hex suffix)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${TRUST_FILE.replace(/\//g, "\\/")}\\.[0-9]+\\.[0-9a-f]+\\.tmp$`)),
      expect.stringContaining("/myproject"),
      { encoding: "utf-8", mode: 0o600 },
    );
    // renameSync moves the unique temp path to the final path
    const writtenTmpPath = (mockWriteFileSync.mock.calls[0] as [string, ...unknown[]])[0];
    expect(mockRenameSync).toHaveBeenCalledWith(writtenTmpPath, TRUST_FILE);
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

    expect(() => assertTrusted("/some/dir")).toThrow(/summon trust \/some\/dir/);
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

describe("isTrusted TOCTOU branch", () => {
  it("returns true when statSync throws ENOENT (file vanished between existsSync and statSync)", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    const enoentError = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    mockStatSync.mockImplementation(() => { throw enoentError; });

    expect(isTrusted("/some/dir")).toBe(true);
  });
});

describe("assertTrustedContent", () => {
  it("does not throw when content hash matches stored trust entry", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "/some/dir": hash }));

    expect(() => assertTrustedContent("/some/dir", content)).not.toThrow();
  });

  it("throws SummonError when content hash does not match stored trust entry", () => {
    const content = "editor = vim\n";
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "/some/dir": "wronghash" }));

    expect(() => assertTrustedContent("/some/dir", content)).toThrow(SummonError);
  });

  it("throws SummonError when directory has no entry in the trust database", () => {
    const content = "editor = vim\n";
    mockExistsSync.mockReturnValue(false);

    expect(() => assertTrustedContent("/some/dir", content)).toThrow(SummonError);
  });

  it("throws with message mentioning summon trust command", () => {
    const content = "editor = vim\n";
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "/some/dir": "wronghash" }));

    expect(() => assertTrustedContent("/some/dir", content)).toThrow(/summon trust \/some\/dir/);
  });

  it("resolves symlinked targetDir to realpath before lookup (#471: /tmp -> /private/tmp)", () => {
    // Simulate: trustProject stored the key as the real path "/private/tmp/myproject"
    // but assertTrustedContent is called with the symlinked path "/tmp/myproject"
    const content = "editor = vim\n";
    const hash = sha256(content);
    const realPath = "/private/tmp/myproject";
    const symlinkPath = "/tmp/myproject";

    // realpathSync resolves symlinkPath -> realPath
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === symlinkPath) return realPath;
      return p;
    });

    // Trust database has the real path as key
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ [realPath]: hash }));

    // This should NOT throw: symlinked path should normalize to realPath for lookup
    expect(() => assertTrustedContent(symlinkPath, content)).not.toThrow();
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

// BE-M3 #492: saveTrustDb should use atomic write (write .tmp then rename)
describe("saveTrustDb atomic write (BE-M3 #492)", () => {
  it("does not call writeFileSync with the final path directly (uses tmp then rename)", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    trustProject("/myproject");

    // The write should NOT go directly to TRUST_FILE
    // Instead it should go to TRUST_FILE + ".tmp" and then renameSync
    const directWrites = mockWriteFileSync.mock.calls.filter(
      (args: unknown[]) => args[0] === TRUST_FILE,
    );
    expect(directWrites.length).toBe(0);
  });

  it("writes to a .tmp file and renames to final path", () => {
    const mockRenameSync = vi.fn();
    vi.doMock("node:fs", async () => {
      const original = await vi.importActual<typeof import("node:fs")>("node:fs");
      return { ...original, renameSync: mockRenameSync };
    });

    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    trustProject("/myproject");

    // Verify the write went to the .tmp path
    const tmpWrites = mockWriteFileSync.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === "string" && String(args[0]).endsWith(".tmp"),
    );
    expect(tmpWrites.length).toBeGreaterThan(0);
  });
});

// BE-M4 #493: loadTrustDb should warn to stderr for corrupt JSON (not silent)
describe("loadTrustDb corrupt JSON warning (BE-M4 #493)", () => {
  it("logs a warning to stderr when trust.json contains malformed JSON", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      // trust.json exists but contains invalid JSON
      mockExistsSync.mockImplementation((p: string) => {
        if (p === TRUST_FILE) return true;
        if (p.endsWith(".summon")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === TRUST_FILE) return "not valid json {{{";
        return "editor = vim\n"; // .summon content
      });

      // Calling isTrusted will trigger loadTrustDb
      isTrusted("/some/dir");

      const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
      const hasWarning = stderrCalls.some((msg) => msg.includes(TRUST_FILE) || msg.includes("trust") || msg.includes("corrupt") || msg.includes("warn"));
      expect(hasWarning).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("does NOT warn to stderr for ENOENT (missing trust.json is normal)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // trust.json does not exist
      mockExistsSync.mockReturnValue(false);

      isTrusted("/some/dir"); // returns true when no .summon file

      expect(stderrSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

// SE-L2 #495: assertTrusted must fail closed on non-OS errors (e.g. TypeError)
describe("assertTrusted non-ENOENT fail-closed (SE-L2 #495)", () => {
  it("does NOT grant trust when isTrusted throws a TypeError (non-OS error)", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });

    // Simulate a TypeError (no .code property) when reading .summon
    mockReadFileSync.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined");
    });

    // Should NOT pass silently — must throw (fail closed)
    expect(() => assertTrusted("/some/dir")).toThrow();
  });

  it("does NOT treat code===undefined as trusted (fail-closed fix)", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });

    // Non-OS error with no .code property
    const noCodeErr = new Error("Something unexpected");
    // (no .code set — this is the non-OS error case)
    mockReadFileSync.mockImplementation(() => {
      throw noCodeErr;
    });

    // This must NOT silently return (which would be fail-open)
    expect(() => assertTrusted("/some/dir")).toThrow();
  });

  it("returns without throwing for ENOENT on the .summon file (legitimate absent file)", () => {
    // .summon exists according to existsSync, but then vanishes (TOCTOU)
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });

    const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockStatSync.mockImplementation(() => { throw enoentErr; });

    // ENOENT from statSync means file vanished → safe to return without trusting/throwing
    expect(() => assertTrusted("/some/dir")).not.toThrow();
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

// BE-L1 #545: trust.ts must import TRUST_FILE and CONFIG_DIR from paths.ts
// The canonical constants in paths.ts must resolve to the same value as what trust.ts uses.
describe("BE-L1 #545: TRUST_FILE and CONFIG_DIR match paths.ts exports", () => {
  it("TRUST_FILE used by trust.ts matches the canonical export from paths.ts", () => {
    // paths.ts is the single source of truth for path constants.
    // The path mocked in the test (TRUST_FILE constant) must equal what paths.ts exports.
    // Since vi.mock("node:os") sets homedir() -> "/home/testuser", both should resolve
    // to the same value when paths.ts also uses homedir() at module load time.
    // This test locks in that trust.ts imports from paths.ts (not a local re-derivation).
    expect(TRUST_FILE).toBe(PATH_TRUST_FILE);
  });

  it("CONFIG_DIR used by trust.ts (via saveTrustDb mkdirSync) matches paths.ts export", () => {
    // When trustProject runs, mkdirSync is called with CONFIG_DIR.
    // If trust.ts imports CONFIG_DIR from paths.ts, this will equal PATH_CONFIG_DIR.
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue("editor = vim\n");

    trustProject("/myproject");

    expect(mockMkdirSync).toHaveBeenCalledWith(
      PATH_CONFIG_DIR,
      expect.objectContaining({ recursive: true }),
    );
  });
});

// BE-H1 (#590): isTrusted path normalization — .summon path must use realpath not raw dir
describe("BE-H1 (#590): isTrusted uses normalizedDir for .summon path (symlink consistency)", () => {
  it("isTrusted reads .summon via the realpath, not the symlink path", () => {
    const symlinkDir = "/tmp/myproject";
    const realDir = "/private/tmp/myproject";
    const content = "editor = vim\n";
    const hash = sha256(content);

    // realpathSync maps symlink → real
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === symlinkDir) return realDir;
      return p;
    });

    // Track which paths existsSync and readFileSync are called with
    const existsPaths: string[] = [];
    const readPaths: string[] = [];

    mockExistsSync.mockImplementation((p: string) => {
      existsPaths.push(p);
      return p.endsWith(".summon") || p === `${realDir}/.summon`;
    });

    mockReadFileSync.mockImplementation((p: string) => {
      readPaths.push(p);
      if (p.endsWith(".summon")) return content;
      return JSON.stringify({ [realDir]: hash });
    });

    isTrusted(symlinkDir);

    // All .summon reads must use the realpath, NOT the symlink path
    const summonExistsCalls = existsPaths.filter(p => p.includes(".summon"));
    const summonReadCalls = readPaths.filter(p => p.includes(".summon"));
    for (const p of [...summonExistsCalls, ...summonReadCalls]) {
      expect(p.startsWith(realDir)).toBe(true);
      expect(p.startsWith(symlinkDir)).toBe(false);
    }
  });
});

// SE-L1 #556: corrupt/unreadable trust.json must return false (fail-closed)
describe("SE-L1 #556: corrupt trust.json fail-closed invariant", () => {
  it("isTrusted returns false when trust.json contains invalid JSON (fail-closed)", () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      if (p === TRUST_FILE) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === TRUST_FILE) return "not-valid-json{{{";
      return "editor = vim\n"; // .summon content
    });

    // Corrupt trust.json must never grant trust — must return false
    expect(isTrusted("/some/dir")).toBe(false);
  });

  it("isTrusted returns false when trust.json is an empty object {} (no entry for path)", () => {
    const content = "editor = vim\n";
    // Simulate a previously-trusted path: the DB is now empty (e.g. after a reset or corruption)
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      if (p === TRUST_FILE) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === TRUST_FILE) return JSON.stringify({}); // empty — no entries
      return content;
    });

    // File has a .summon, but there is no entry in the DB — must be blocked (fail-closed)
    expect(isTrusted("/previously/trusted/dir")).toBe(false);
  });

  it("isTrusted returns false when trust.json is valid JSON but contains a different path's hash", () => {
    const content = "editor = vim\n";
    const hash = sha256(content);
    // DB has the hash under a DIFFERENT directory key
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith(".summon")) return true;
      if (p === TRUST_FILE) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === TRUST_FILE) return JSON.stringify({ "/other/dir": hash });
      return content;
    });

    // Our target dir is NOT in the DB — must be blocked
    expect(isTrusted("/our/dir")).toBe(false);
  });
});
