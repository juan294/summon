import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs";
import { SESSIONS_DIR as TEST_SESSIONS_DIR } from "./paths.js";

vi.mock("./paths.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./paths.js")>();
  const { mkdtempSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return { ...real, SESSIONS_DIR: mkdtempSync(join(tmpdir(), "summon-session-test-")) };
});

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync), writeFileSync: vi.fn(fs.writeFileSync), renameSync: vi.fn(fs.renameSync) };
});

// Mock node:path so we can spy on resolve for the traversal-guard test
vi.mock("node:path", async () => {
  const real = await vi.importActual<typeof import("node:path")>("node:path");
  return {
    ...real,
    resolve: vi.fn((...args: string[]) => real.resolve(...args)),
    join: vi.fn((...args: string[]) => real.join(...args)),
  };
});

// Import mocked path.resolve so traversal-guard tests can override it
import { resolve as pathResolve } from "node:path";

import {
  isValidSessionName,
  sessionPath,
  listSessions,
  readSession,
  writeSession,
  deleteSession,
} from "./sessions.js";

beforeEach(() => {
  vi.mocked(fs.renameSync).mockReset();
  fs.rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_SESSIONS_DIR);
});

afterAll(() => fs.rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true }));

describe("isValidSessionName", () => {
  it("accepts valid names", () => {
    expect(isValidSessionName("foo")).toBe(true);
    expect(isValidSessionName("my-session")).toBe(true);
    expect(isValidSessionName("MySession1")).toBe(true);
    expect(isValidSessionName("a")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(isValidSessionName("")).toBe(false);
    expect(isValidSessionName("1foo")).toBe(false);
    expect(isValidSessionName("foo bar")).toBe(false);
    expect(isValidSessionName("foo/bar")).toBe(false);
    expect(isValidSessionName("foo=bar")).toBe(false);
  });
});

describe("sessionPath", () => {
  it("returns path under SESSIONS_DIR for valid name", () => {
    const p = sessionPath("mysession");
    expect(p).toBe(`${TEST_SESSIONS_DIR}/mysession`);
  });

  it("rejects names with invalid characters", () => {
    expect(() => sessionPath("foo bar")).toThrow("Invalid session name");
    expect(() => sessionPath("foo=bar")).toThrow("Invalid session name");
    expect(() => sessionPath("")).toThrow("Invalid session name");
  });

  it("rejects names containing /", () => {
    expect(() => sessionPath("foo/bar")).toThrow("Invalid session name");
  });

  it("rejects names with ..", () => {
    expect(() => sessionPath("..")).toThrow("Invalid session name");
  });
});

describe("writeSession + readSession round-trip", () => {
  it("preserves project order", () => {
    writeSession("mywork", ["projectA", "projectB", "projectC"]);
    const result = readSession("mywork");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });

  it("returns null for non-existent session", () => {
    expect(readSession("nonexistent")).toBeNull();
  });

  it("strips # comments and blank lines", () => {
    const filePath = `${TEST_SESSIONS_DIR}/commented`;
    fs.writeFileSync(filePath, "# this is a comment\nprojectA\n\nprojectB\n# another comment\nprojectC\n");
    const result = readSession("commented");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });

  it("handles CRLF line endings and preserves order", () => {
    const filePath = `${TEST_SESSIONS_DIR}/crlf-session`;
    fs.writeFileSync(filePath, "projectA\r\nprojectB\r\nprojectC\r\n");
    const result = readSession("crlf-session");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });

  it("handles CR-only line endings", () => {
    const filePath = `${TEST_SESSIONS_DIR}/cr-session`;
    fs.writeFileSync(filePath, "projectA\rprojectB\rprojectC\r");
    const result = readSession("cr-session");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });
});

describe("listSessions", () => {
  it("returns empty array when SESSIONS_DIR does not exist", () => {
    fs.rmdirSync(TEST_SESSIONS_DIR);
    expect(listSessions()).toEqual([]);
  });

  it("returns sorted session names", () => {
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/zebra`, "projA\n");
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/alpha`, "projB\n");
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/mango`, "projC\n");
    const result = listSessions();
    expect(result).toEqual(["alpha", "mango", "zebra"]);
  });

  // BE-M4 #605: orphaned .tmp and dotfiles must not appear in session list
  it("filters out .tmp files (BE-M4 #605)", () => {
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/mywork`, "projA\n");
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/mywork.12345.abc.tmp`, "projA\n");
    const result = listSessions();
    expect(result).toEqual(["mywork"]);
    expect(result).not.toContain("mywork.12345.abc.tmp");
  });

  it("filters out dotfiles (BE-M4 #605)", () => {
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/mywork`, "projA\n");
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/.DS_Store`, "");
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/.hidden`, "");
    const result = listSessions();
    expect(result).toEqual(["mywork"]);
    expect(result.some(n => n.startsWith("."))).toBe(false);
  });
});

describe("deleteSession", () => {
  it("returns true when session exists and deletes it", () => {
    writeSession("todelete", ["projA"]);
    expect(readSession("todelete")).not.toBeNull();
    const result = deleteSession("todelete");
    expect(result).toBe(true);
    expect(readSession("todelete")).toBeNull();
  });

  it("returns false when session does not exist", () => {
    expect(deleteSession("doesnotexist")).toBe(false);
  });
});

describe("writeSession validation", () => {
  it("rejects project names containing =", () => {
    expect(() => writeSession("s", ["valid", "bad=name"])).toThrow("Invalid project name");
  });

  it("rejects project names containing spaces", () => {
    expect(() => writeSession("s", ["valid", "bad name"])).toThrow("Invalid project name");
  });

  it("rejects project names starting with a digit", () => {
    expect(() => writeSession("s", ["1invalid"])).toThrow("Invalid project name");
  });

  it("creates SESSIONS_DIR with mode 0o700 and file with mode 0o600", () => {
    writeSession("newses", ["projA"]);
    expect(fs.statSync(TEST_SESSIONS_DIR).mode & 0o777).toBe(0o700);
    expect(fs.statSync(sessionPath("newses")).mode & 0o777).toBe(0o600);
  });

  it("refuses an existing session symlink and preserves its target", () => {
    const target = sessionPath("other");
    fs.writeFileSync(target, "original");
    fs.symlinkSync(target, sessionPath("newses"));
    expect(() => writeSession("newses", ["projA"])).toThrow();
    expect(fs.lstatSync(sessionPath("newses")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("original");
  });

  it("preserves the entire previous list during and after a failed write", () => {
    writeSession("work", ["original", "list"]);
    let seen: string[] | null = null;
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      seen = readSession("work");
      throw new Error("write failed");
    });
    expect(() => writeSession("work", ["next"])).toThrow("write failed");
    expect(seen).toEqual(["original", "list"]);
    expect(readSession("work")).toEqual(["original", "list"]);
    expect(fs.readdirSync(TEST_SESSIONS_DIR)).toEqual(["work"]);
  });

  it("removes only its staging file when publication fails", () => {
    writeSession("work", ["original"]);
    fs.writeFileSync(`${TEST_SESSIONS_DIR}/other.tmp`, "other writer");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error("rename failed"); });
    expect(() => writeSession("work", ["next"])).toThrow("rename failed");
    expect(readSession("work")).toEqual(["original"]);
    expect(fs.readdirSync(TEST_SESSIONS_DIR).sort()).toEqual(["other.tmp", "work"]);
  });
});

// QA-L2 #555: Traversal rejection — second guard in sessionPath (lines 16-18 of sessions.ts)
// The regex already blocks slashes and "..", but the path-resolution guard is defense-in-depth.
// We force resolve() to return a path outside SESSIONS_DIR to exercise that branch.
describe("sessionPath traversal guard (QA-L2 #555)", () => {
  it("throws 'Invalid session path' when resolve() escapes SESSIONS_DIR", () => {
    // Override resolve for the call made inside sessionPath to simulate a traversal escape.
    // The mocked node:path wraps the real module with a vi.fn, so mockReturnValueOnce only
    // affects the next call — which is the resolve(join(SESSIONS_DIR, name)) call inside
    // sessionPath(). SESSIONS_DIR_RESOLVED was already computed at module init using the real
    // resolve, so the guard comparison still works correctly.
    vi.mocked(pathResolve).mockReturnValueOnce("/etc/passwd");

    expect(() => sessionPath("validname")).toThrow("Invalid session path");
  });

  it("does NOT throw for a legitimately valid session name", () => {
    // Sanity-check: ensure the mock override is scoped (mockReturnValueOnce is consumed).
    // A real valid name must still resolve inside the sessions dir and not throw.
    expect(() => sessionPath("validname")).not.toThrow();
  });
});

// QA-L2 #555: readSession non-ENOENT rethrow (lines 32-34 of sessions.ts)
// When readFileSync throws something other than ENOENT (e.g. EACCES permission denied),
// readSession must rethrow — it must not swallow the error or return null.
describe("readSession non-ENOENT rethrow (QA-L2 #555)", () => {
  it("rethrows EACCES permission denied error", () => {
    const permError = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw permError;
    });

    expect(() => readSession("mysession")).toThrow(permError);
  });

  it("rethrows a generic Error with no .code property", () => {
    const genericError = new Error("Unexpected I/O failure");
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw genericError;
    });

    expect(() => readSession("mysession")).toThrow(genericError);
  });

  it("still returns null for a genuine ENOENT (regression guard)", () => {
    // Ensure the ENOENT swallow is unaffected by the non-ENOENT rethrow branch.
    // The default mock readFileSync already throws ENOENT for missing keys, so this
    // verifies the happy-path ENOENT branch still returns null.
    expect(readSession("doesnotexist")).toBeNull();
  });
});
