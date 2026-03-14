import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
  setConfig,
  removeConfig,
  getConfig,
  listConfig,
  readKVFile,
  resetConfigCache,
  isFirstRun,
  LAYOUTS_DIR,
  listCustomLayouts,
  readCustomLayout,
  saveCustomLayout,
  deleteCustomLayout,
  isValidLayoutName,
  isCustomLayout,
} from "./config.js";

// Mock the filesystem — config.ts uses module-level constants derived from
// homedir(), so we mock the individual fs functions that readKV/writeKV use.
vi.mock("node:fs", () => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    existsSync: (path: string) => store.has(path) || dirs.has(path),
    mkdirSync: vi.fn((_path: string, _opts?: unknown) => { dirs.add(_path); }),
    readFileSync: (path: string) => store.get(path) ?? "",
    writeFileSync: vi.fn((path: string, data: string) => store.set(path, data)),
    readdirSync: vi.fn((path: string) => {
      const prefix = path.endsWith("/") ? path : path + "/";
      const names: string[] = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
          names.push(key.slice(prefix.length));
        }
      }
      return names;
    }),
    unlinkSync: vi.fn((path: string) => {
      if (!store.has(path)) throw new Error(`ENOENT: no such file '${path}'`);
      store.delete(path);
    }),
    __store: store,
    __dirs: dirs,
  };
});

// Access the internal store for cleanup
async function getStore(): Promise<Map<string, string>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __store: Map<string, string> }).__store;
}

async function getDirs(): Promise<Set<string>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __dirs: Set<string> }).__dirs;
}

beforeEach(async () => {
  const store = await getStore();
  store.clear();
  const dirs = await getDirs();
  dirs.clear();
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

  it("removes a config key", () => {
    setConfig("editor", "vim");
    const result = removeConfig("editor");
    expect(result).toBe(true);
    expect(getConfig("editor")).toBeUndefined();
  });

  it("returns false when removing non-existent config key", () => {
    const result = removeConfig("nonexistent");
    expect(result).toBe(false);
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

  it("skips lines without an equals sign", async () => {
    const store = await getStore();
    store.set("/tmp/.summon", "editor=vim\ncomment line with no equals\npanes=3\n");
    const map = readKVFile("/tmp/.summon");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("3");
    expect(map.size).toBe(2);
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

describe("isFirstRun", () => {
  it("returns true when config file does not exist", () => {
    // store is empty after beforeEach clear + resetConfigCache
    expect(isFirstRun()).toBe(true);
  });

  it("returns false when config file exists", () => {
    setConfig("editor", "vim"); // triggers ensureConfig, creates config file
    expect(isFirstRun()).toBe(false);
  });

  it("does not create config file as side effect", async () => {
    const store = await getStore();
    const sizeBefore = store.size;
    isFirstRun();
    expect(store.size).toBe(sizeBefore);
  });
});

describe("VALID_KEYS", () => {
  it("includes starship-preset", async () => {
    const { VALID_KEYS } = await import("./config.js");
    expect(VALID_KEYS).toContain("starship-preset");
  });
});

describe("ensureConfig initial content", () => {
  it("creates empty config file on first run", async () => {
    const store = await getStore();
    getConfig("editor"); // triggers ensureConfig
    const configPath = [...store.keys()].find((k) => k.endsWith("/config"));
    expect(configPath).toBeDefined();
    expect(store.get(configPath!)).toBe("");
  });
});

describe("custom layouts", () => {
  it("LAYOUTS_DIR is under CONFIG_DIR", () => {
    expect(LAYOUTS_DIR).toContain("summon");
    expect(LAYOUTS_DIR).toContain("layouts");
  });

  it("listCustomLayouts returns empty array when no dir exists", () => {
    const result = listCustomLayouts();
    expect(result).toEqual([]);
  });

  it("listCustomLayouts returns sorted layout names", async () => {
    const store = await getStore();
    const dirs = await getDirs();
    dirs.add(LAYOUTS_DIR);
    store.set(`${LAYOUTS_DIR}/zeta`, "panes=3\n");
    store.set(`${LAYOUTS_DIR}/alpha`, "panes=2\n");
    store.set(`${LAYOUTS_DIR}/mid`, "panes=1\n");
    const result = listCustomLayouts();
    expect(result).toEqual(["alpha", "mid", "zeta"]);
  });

  it("saveCustomLayout creates file with correct content", async () => {
    const store = await getStore();
    const entries = new Map([["panes", "3"], ["editor", "vim"]]);
    saveCustomLayout("mywork", entries);
    const filePath = `${LAYOUTS_DIR}/mywork`;
    expect(store.has(filePath)).toBe(true);
    const content = store.get(filePath)!;
    expect(content).toContain("panes=3");
    expect(content).toContain("editor=vim");
  });

  it("saveCustomLayout creates LAYOUTS_DIR if needed", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();
    saveCustomLayout("test", new Map([["panes", "2"]]));
    expect(mkdirSpy).toHaveBeenCalledWith(LAYOUTS_DIR, { recursive: true, mode: 0o700 });
  });

  it("saveCustomLayout writes with 0o600 permissions", async () => {
    const fs = await import("node:fs");
    const writeSpy = fs.writeFileSync as ReturnType<typeof vi.fn>;
    saveCustomLayout("test", new Map([["panes", "2"]]));
    const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
    expect(lastCall![2]).toEqual({ mode: 0o600 });
  });

  it("readCustomLayout returns Map for existing layout", async () => {
    const store = await getStore();
    store.set(`${LAYOUTS_DIR}/mywork`, "panes=3\neditor=vim\n");
    const result = readCustomLayout("mywork");
    expect(result).not.toBeNull();
    expect(result!.get("panes")).toBe("3");
    expect(result!.get("editor")).toBe("vim");
  });

  it("readCustomLayout returns null for missing layout", () => {
    const result = readCustomLayout("nonexistent");
    expect(result).toBeNull();
  });

  it("deleteCustomLayout returns true when file exists", async () => {
    const store = await getStore();
    store.set(`${LAYOUTS_DIR}/mywork`, "panes=3\n");
    const result = deleteCustomLayout("mywork");
    expect(result).toBe(true);
    expect(store.has(`${LAYOUTS_DIR}/mywork`)).toBe(false);
  });

  it("deleteCustomLayout returns false when file missing", () => {
    const result = deleteCustomLayout("nonexistent");
    expect(result).toBe(false);
  });

  it("isValidLayoutName accepts valid names", () => {
    expect(isValidLayoutName("mywork")).toBe(true);
    expect(isValidLayoutName("my-work")).toBe(true);
    expect(isValidLayoutName("my_work")).toBe(true);
    expect(isValidLayoutName("MyWork123")).toBe(true);
    expect(isValidLayoutName("a")).toBe(true);
  });

  it("isValidLayoutName rejects reserved preset names", () => {
    expect(isValidLayoutName("minimal")).toBe(false);
    expect(isValidLayoutName("full")).toBe(false);
    expect(isValidLayoutName("pair")).toBe(false);
    expect(isValidLayoutName("cli")).toBe(false);
    expect(isValidLayoutName("btop")).toBe(false);
  });

  it("isValidLayoutName rejects invalid names", () => {
    expect(isValidLayoutName("")).toBe(false);
    expect(isValidLayoutName("123abc")).toBe(false);
    expect(isValidLayoutName("-start")).toBe(false);
    expect(isValidLayoutName("has space")).toBe(false);
    expect(isValidLayoutName("has/slash")).toBe(false);
    expect(isValidLayoutName("has.dot")).toBe(false);
  });

  it("isCustomLayout returns true when file exists", async () => {
    const store = await getStore();
    store.set(`${LAYOUTS_DIR}/mywork`, "panes=3\n");
    expect(isCustomLayout("mywork")).toBe(true);
  });

  it("isCustomLayout returns false when file missing", () => {
    expect(isCustomLayout("nonexistent")).toBe(false);
  });
});
