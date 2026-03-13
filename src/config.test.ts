import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
  setConfig,
  getConfig,
  listConfig,
  readKVFile,
  resetConfigCache,
} from "./config.js";

// Mock the filesystem — config.ts uses module-level constants derived from
// homedir(), so we mock the individual fs functions that readKV/writeKV use.
vi.mock("node:fs", () => {
  const store = new Map<string, string>();
  return {
    existsSync: (path: string) => store.has(path),
    mkdirSync: vi.fn(),
    readFileSync: (path: string) => store.get(path) ?? "",
    writeFileSync: vi.fn((path: string, data: string) => store.set(path, data)),
    __store: store,
  };
});

// Access the internal store for cleanup
async function getStore(): Promise<Map<string, string>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __store: Map<string, string> }).__store;
}

beforeEach(async () => {
  const store = await getStore();
  store.clear();
  resetConfigCache();
});

describe("project CRUD", () => {
  it("adds and retrieves a project", () => {
    addProject("myapp", "/home/user/myapp");
    expect(getProject("myapp")).toBe("/home/user/myapp");
  });

  it("returns undefined for unknown project", () => {
    expect(getProject("nope")).toBeUndefined();
  });

  it("lists all projects", () => {
    addProject("foo", "/foo");
    addProject("bar", "/bar");
    const projects = listProjects();
    expect(projects.size).toBe(2);
    expect(projects.get("foo")).toBe("/foo");
    expect(projects.get("bar")).toBe("/bar");
  });

  it("removes a project", () => {
    addProject("myapp", "/home/user/myapp");
    const result = removeProject("myapp");
    expect(result).toBe(true);
    expect(getProject("myapp")).toBeUndefined();
  });

  it("returns false when removing non-existent project", () => {
    const result = removeProject("ghost");
    expect(result).toBe(false);
  });

  it("overwrites existing project path", () => {
    addProject("myapp", "/old/path");
    addProject("myapp", "/new/path");
    expect(getProject("myapp")).toBe("/new/path");
  });
});

describe("machine config", () => {
  it("sets and retrieves a config value", () => {
    setConfig("editor", "vim");
    expect(getConfig("editor")).toBe("vim");
  });

  it("returns undefined for unset key", () => {
    expect(getConfig("nonexistent")).toBeUndefined();
  });

  it("lists all config values", () => {
    setConfig("editor", "vim");
    setConfig("panes", "4");
    const config = listConfig();
    expect(config.get("editor")).toBe("vim");
    expect(config.get("panes")).toBe("4");
  });

  it("handles values containing '=' characters", () => {
    setConfig("cmd", "FOO=bar baz");
    expect(getConfig("cmd")).toBe("FOO=bar baz");
  });

  it("overwrites existing config value", () => {
    setConfig("editor", "vim");
    setConfig("editor", "nano");
    expect(getConfig("editor")).toBe("nano");
  });
});

describe("readKVFile", () => {
  it("reads an existing file", async () => {
    const store = await getStore();
    store.set("/tmp/.summon", "editor=vim\npanes=2\n");
    const map = readKVFile("/tmp/.summon");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("2");
  });

  it("returns empty map for missing file", () => {
    const map = readKVFile("/nonexistent/.summon");
    expect(map.size).toBe(0);
  });
});

describe("ensureConfig caching (#25)", () => {
  it("calls mkdirSync only once across multiple config reads", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();

    // Multiple config operations that each call readKV → ensureConfig
    getConfig("editor");
    listConfig();
    listProjects();
    getProject("foo");

    expect(mkdirSpy).toHaveBeenCalledTimes(1);
  });

  it("re-runs filesystem operations after resetConfigCache()", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();

    getConfig("editor");
    expect(mkdirSpy).toHaveBeenCalledTimes(1);

    resetConfigCache();
    getConfig("editor");
    expect(mkdirSpy).toHaveBeenCalledTimes(2);
  });
});

describe("file permissions (#47)", () => {
  it("creates config directory with mode 0o700", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();

    getConfig("editor");

    expect(mkdirSpy).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true, mode: 0o700 },
    );
  });

  it("writes config files with mode 0o600 during ensureConfig", async () => {
    const fs = await import("node:fs");
    const writeSpy = fs.writeFileSync as ReturnType<typeof vi.fn>;
    writeSpy.mockClear();

    getConfig("editor");

    // Both initial file writes (projects + config) should include mode 0o600
    const initWrites = writeSpy.mock.calls.filter(
      (c: unknown[]) =>
        String(c[0]).endsWith("/projects") || String(c[0]).endsWith("/config"),
    );
    expect(initWrites.length).toBeGreaterThanOrEqual(2);
    for (const call of initWrites) {
      expect(call[2]).toEqual({ mode: 0o600 });
    }
  });

  it("writes files with mode 0o600 in writeKV", async () => {
    const fs = await import("node:fs");
    const writeSpy = fs.writeFileSync as ReturnType<typeof vi.fn>;

    setConfig("editor", "vim");

    // The last writeFileSync call is from writeKV
    const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
    expect(String(lastCall![0])).toContain("/config");
    expect(lastCall![2]).toEqual({ mode: 0o600 });
  });
});

describe("writeKV newline sanitization (#26)", () => {
  it("strips newlines from config values", () => {
    setConfig("key", "value\ninjected=evil");
    expect(getConfig("key")).toBe("valueinjected=evil");
  });

  it("strips newlines from config keys", () => {
    setConfig("bad\nkey", "value");
    expect(getConfig("badkey")).toBe("value");
  });

  it("strips carriage returns from values", () => {
    setConfig("key", "value\r\nwith-cr");
    expect(getConfig("key")).toBe("valuewith-cr");
  });

  it("strips newlines from project names and paths", () => {
    addProject("my\napp", "/home/\nuser/app");
    expect(getProject("myapp")).toBe("/home/user/app");
  });
});
