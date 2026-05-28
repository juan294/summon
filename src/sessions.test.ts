import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be a literal — vi.mock factory is hoisted before variable declarations
const TEST_SESSIONS_DIR = "/tmp/test-summon-sessions";

// Mock paths module so SESSIONS_DIR is controlled in tests
vi.mock("./paths.js", () => ({
  CONFIG_DIR: "/tmp/test-summon",
  STATUS_DIR: "/tmp/test-summon/status",
  SNAPSHOTS_DIR: "/tmp/test-summon/snapshots",
  LAYOUTS_DIR: "/tmp/test-summon/layouts",
  SESSIONS_DIR: "/tmp/test-summon-sessions",
  TRUST_FILE: "/tmp/test-summon/trust.json",
}));

// Mock the filesystem
vi.mock("node:fs", () => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    existsSync: (path: string) => store.has(path) || dirs.has(path),
    mkdirSync: vi.fn((_path: string, _opts?: unknown) => { dirs.add(_path as string); }),
    readFileSync: vi.fn((path: string) => {
      if (!store.has(path)) {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return store.get(path) ?? "";
    }),
    readdirSync: vi.fn((path: string) => {
      if (!dirs.has(path as string) && !store.has(path as string)) {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      const prefix = (path as string).endsWith("/") ? path as string : (path as string) + "/";
      const names: string[] = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
          names.push(key.slice(prefix.length));
        }
      }
      return names;
    }),
    writeFileSync: vi.fn((path: string, data: string, _opts?: unknown) => {
      store.set(path, data);
    }),
    unlinkSync: vi.fn((path: string) => {
      if (!store.has(path)) {
        const error = new Error(`ENOENT: no such file '${path}'`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      store.delete(path);
    }),
    __store: store,
    __dirs: dirs,
  };
});

// Access internal store for cleanup
import * as fs from "node:fs";
const { __store: store, __dirs: dirs } = fs as unknown as {
  __store: Map<string, string>;
  __dirs: Set<string>;
};

import {
  isValidSessionName,
  sessionPath,
  listSessions,
  readSession,
  writeSession,
  deleteSession,
  sessionExists,
} from "./sessions.js";

beforeEach(() => {
  store.clear();
  dirs.clear();
});

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
    dirs.add(TEST_SESSIONS_DIR);
    writeSession("mywork", ["projectA", "projectB", "projectC"]);
    const result = readSession("mywork");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });

  it("returns null for non-existent session", () => {
    expect(readSession("nonexistent")).toBeNull();
  });

  it("strips # comments and blank lines", () => {
    const filePath = `${TEST_SESSIONS_DIR}/commented`;
    store.set(filePath, "# this is a comment\nprojectA\n\nprojectB\n# another comment\nprojectC\n");
    dirs.add(TEST_SESSIONS_DIR);
    const result = readSession("commented");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });

  it("handles CRLF line endings and preserves order", () => {
    const filePath = `${TEST_SESSIONS_DIR}/crlf-session`;
    store.set(filePath, "projectA\r\nprojectB\r\nprojectC\r\n");
    dirs.add(TEST_SESSIONS_DIR);
    const result = readSession("crlf-session");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });

  it("handles CR-only line endings", () => {
    const filePath = `${TEST_SESSIONS_DIR}/cr-session`;
    store.set(filePath, "projectA\rprojectB\rprojectC\r");
    dirs.add(TEST_SESSIONS_DIR);
    const result = readSession("cr-session");
    expect(result).toEqual(["projectA", "projectB", "projectC"]);
  });
});

describe("listSessions", () => {
  it("returns empty array when SESSIONS_DIR does not exist", () => {
    expect(listSessions()).toEqual([]);
  });

  it("returns sorted session names", () => {
    dirs.add(TEST_SESSIONS_DIR);
    store.set(`${TEST_SESSIONS_DIR}/zebra`, "projA\n");
    store.set(`${TEST_SESSIONS_DIR}/alpha`, "projB\n");
    store.set(`${TEST_SESSIONS_DIR}/mango`, "projC\n");
    const result = listSessions();
    expect(result).toEqual(["alpha", "mango", "zebra"]);
  });
});

describe("deleteSession", () => {
  it("returns true when session exists and deletes it", () => {
    dirs.add(TEST_SESSIONS_DIR);
    writeSession("todelete", ["projA"]);
    expect(sessionExists("todelete")).toBe(true);
    const result = deleteSession("todelete");
    expect(result).toBe(true);
    expect(sessionExists("todelete")).toBe(false);
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
    const mkdirSpy = vi.mocked(fs.mkdirSync);
    const writeFileSpy = vi.mocked(fs.writeFileSync);
    mkdirSpy.mockClear();
    writeFileSpy.mockClear();

    writeSession("newses", ["projA"]);

    expect(mkdirSpy).toHaveBeenCalledWith(
      TEST_SESSIONS_DIR,
      expect.objectContaining({ recursive: true, mode: 0o700 })
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      `${TEST_SESSIONS_DIR}/newses`,
      "projA\n",
      expect.objectContaining({ mode: 0o600 })
    );
  });
});
