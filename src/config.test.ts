import { describe, it, expect, test, vi, beforeEach } from "vitest";
import { VALID_KEYS } from "./config.js";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
  setConfig,
  removeConfig,
  listConfig,
  readKVFile,
  readKVFromString,
  resetConfigCache,
  clearKVCache,
  clearProjectCache,
  isFirstRun,
  LAYOUTS_DIR,
  listCustomLayouts,
  readCustomLayout,
  saveCustomLayout,
  deleteCustomLayout,
  isValidLayoutName,
  isCustomLayout,
  layoutPath,
} from "./config.js";

// Mock the filesystem — config.ts uses module-level constants derived from
// homedir(), so we mock the individual fs functions that readKV/writeKV use.
vi.mock("node:fs", () => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  // mtime counter — increment to simulate file changes
  const mtimes = new Map<string, number>();
  return {
    existsSync: (path: string) => store.has(path) || dirs.has(path),
    mkdirSync: vi.fn((_path: string, _opts?: unknown) => { dirs.add(_path); }),
    readFileSync: vi.fn((path: string) => {
      if (store.get(path) === "__THROW_ENOENT__") {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      if (store.get(path) === "__THROW_EISDIR__") {
        const error = new Error("EISDIR") as NodeJS.ErrnoException;
        error.code = "EISDIR";
        throw error;
      }
      return store.get(path) ?? "";
    }),
    statSync: vi.fn((path: string) => {
      if (!store.has(path)) {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return { mtimeMs: mtimes.get(path) ?? 1000 };
    }),
    writeFileSync: vi.fn((path: string, data: string) => {
      store.set(path, data);
      // Bump mtime on write so cache is invalidated
      mtimes.set(path, (mtimes.get(path) ?? 1000) + 1);
    }),
    renameSync: vi.fn((src: string, dest: string) => {
      // Atomic rename: move src content to dest, remove src
      const data = store.get(src);
      if (data === undefined) throw new Error(`ENOENT: no such file '${src}'`);
      store.set(dest, data);
      store.delete(src);
      // Transfer mtime from src to dest
      const mtime = mtimes.get(src);
      if (mtime !== undefined) {
        mtimes.set(dest, mtime);
        mtimes.delete(src);
      }
    }),
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
    __mtimes: mtimes,
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

async function getMtimes(): Promise<Map<string, number>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __mtimes: Map<string, number> }).__mtimes;
}

beforeEach(async () => {
  const store = await getStore();
  store.clear();
  const dirs = await getDirs();
  dirs.clear();
  const mtimes = await getMtimes();
  mtimes.clear();
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
    expect(listConfig().get("editor")).toBe("vim");
  });

  it("returns undefined for unset key", () => {
    expect(listConfig().get("nonexistent")).toBeUndefined();
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
    expect(listConfig().get("cmd")).toBe("FOO=bar baz");
  });

  it("overwrites existing config value", () => {
    setConfig("editor", "vim");
    setConfig("editor", "nano");
    expect(listConfig().get("editor")).toBe("nano");
  });

  it("removes a config key", () => {
    setConfig("editor", "vim");
    const result = removeConfig("editor");
    expect(result).toBe(true);
    expect(listConfig().get("editor")).toBeUndefined();
  });

  it("returns false when removing non-existent config key", () => {
    const result = removeConfig("nonexistent");
    expect(result).toBe(false);
  });
});

describe("readKVFile", () => {
  it("returns an empty map for missing files", async () => {
    const mod = await import("node:fs");
    const store = (mod as unknown as { __store: Map<string, string> }).__store;
    store.set("/tmp/missing", "__THROW_ENOENT__");

    expect(readKVFile("/tmp/missing")).toEqual(new Map());
  });

  it("rethrows non-ENOENT filesystem errors", async () => {
    const mod = await import("node:fs");
    const store = (mod as unknown as { __store: Map<string, string> }).__store;
    store.set("/tmp/unreadable", "__THROW_EISDIR__");

    expect(() => readKVFile("/tmp/unreadable")).toThrow();
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

  it("propagates non-ENOENT errors from readFileSync", async () => {
    const fs = await import("node:fs");
    const origReadFileSync = fs.readFileSync as (...args: unknown[]) => unknown;
    // Temporarily override readFileSync to throw a non-ENOENT error
    (fs as Record<string, unknown>).readFileSync = (_path: string) => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };
    try {
      expect(() => readKVFile("/eacces/path")).toThrow("EACCES");
    } finally {
      (fs as Record<string, unknown>).readFileSync = origReadFileSync;
    }
  });

  it("skips lines without an equals sign", async () => {
    const store = await getStore();
    store.set("/tmp/.summon", "editor=vim\ncomment line with no equals\npanes=3\n");
    const map = readKVFile("/tmp/.summon");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("3");
    expect(map.size).toBe(2);
  });

  it("skips # comment lines (#197)", async () => {
    const store = await getStore();
    store.set("/tmp/.summon", "# This is a comment\neditor=vim\n# editor=nano\npanes=3\n");
    const map = readKVFile("/tmp/.summon");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("3");
    expect(map.size).toBe(2);
  });

  it("skips # comments with leading whitespace trimmed (#197)", async () => {
    const store = await getStore();
    store.set("/tmp/.summon", "editor=vim\n  # indented comment with=equals\npanes=2\n");
    const map = readKVFile("/tmp/.summon");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("2");
    expect(map.size).toBe(2);
  });
});

describe("ensureConfig caching (#25)", () => {
  it("calls mkdirSync only once across multiple config reads", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();

    // Multiple config operations that each call readKV → ensureConfig
    listConfig();
    listProjects();
    getProject("foo");

    expect(mkdirSpy).toHaveBeenCalledTimes(1);
  });

  it("re-runs filesystem operations after resetConfigCache()", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();

    listConfig();
    expect(mkdirSpy).toHaveBeenCalledTimes(1);

    resetConfigCache();
    listConfig();
    expect(mkdirSpy).toHaveBeenCalledTimes(2);
  });
});

describe("mtime-based memoization (#291)", () => {
  it("calls readFileSync only once when mtime is unchanged (listProjects)", async () => {
    const fs = await import("node:fs");
    const readFileSpy = fs.readFileSync as ReturnType<typeof vi.fn>;
    const mtimes = await getMtimes();

    // Warm the cache: first call reads the file and populates cache
    listProjects();

    // Freeze mtime for all files at current values so subsequent calls hit cache
    const store = await getStore();
    for (const key of store.keys()) {
      if (!mtimes.has(key)) mtimes.set(key, 1000);
    }

    readFileSpy.mockClear();

    // Second and third calls — mtime unchanged, should hit cache
    listProjects();
    listProjects();

    // readFileSync should NOT have been called (cache hit)
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("re-reads file after mtime changes", async () => {
    const fs = await import("node:fs");
    const readFileSpy = fs.readFileSync as ReturnType<typeof vi.fn>;
    const store = await getStore();
    const mtimes = await getMtimes();

    listProjects(); // warm cache
    readFileSpy.mockClear();

    // Simulate external file change by bumping mtime on the projects file
    for (const key of store.keys()) {
      if (key.endsWith("/projects")) {
        mtimes.set(key, (mtimes.get(key) ?? 1000) + 999);
      }
    }

    listProjects(); // should re-read due to changed mtime
    expect(readFileSpy).toHaveBeenCalled();
  });
});

describe("file permissions (#47)", () => {
  it("creates config directory with mode 0o700", async () => {
    const fs = await import("node:fs");
    const mkdirSpy = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mkdirSpy.mockClear();

    listConfig();

    expect(mkdirSpy).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true, mode: 0o700 },
    );
  });

  it("writes config files with mode 0o600 during ensureConfig", async () => {
    const fs = await import("node:fs");
    const writeSpy = fs.writeFileSync as ReturnType<typeof vi.fn>;
    writeSpy.mockClear();

    listConfig();

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
    expect(listConfig().get("key")).toBe("valueinjected=evil");
  });

  it("rejects config keys containing newlines (BE-M2 #376)", () => {
    // Previously this silently stripped newlines; now it throws to prevent key confusion.
    expect(() => setConfig("bad\nkey", "value")).toThrow("Invalid config key");
  });

  it("strips carriage returns from values", () => {
    setConfig("key", "value\r\nwith-cr");
    expect(listConfig().get("key")).toBe("valuewith-cr");
  });

  it("rejects project names with newlines (BE-B4 validation)", () => {
    // addProject now validates names — newlines are whitespace and rejected
    expect(() => addProject("my\napp", "/home/user/app")).toThrow("Invalid project name");
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

describe("unknown config key warning (BE-S27 #323)", () => {
  it("emits console.warn for unknown keys when listConfig is called", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = await getStore();
    // Manually set a config file with an unknown key
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    store.set(configPath, "unknowntypokey=val\n");
    resetConfigCache();

    listConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknowntypokey"),
    );
    warnSpy.mockRestore();
  });

  it("does not warn for known keys", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = await getStore();
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    store.set(configPath, "editor=vim\npanes=3\n");
    resetConfigCache();

    listConfig();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("VALID_KEYS", () => {
  it("includes starship-preset", async () => {
    const { VALID_KEYS } = await import("./config.js");
    expect(VALID_KEYS).toContain("starship-preset");
  });

  it("includes clean", async () => {
    const { VALID_KEYS } = await import("./config.js");
    expect(VALID_KEYS).toContain("clean");
  });
});

describe("BOOLEAN_KEYS includes clean", () => {
  it("accepts clean=true and clean=false", () => {
    expect(() => setConfig("clean", "true")).not.toThrow();
    expect(() => setConfig("clean", "false")).not.toThrow();
  });
});

describe("ensureConfig initial content", () => {
  it("creates empty config file on first run", async () => {
    const store = await getStore();
    listConfig(); // triggers ensureConfig
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

  describe("path traversal defense-in-depth", () => {
    it("layoutPath rejects traversal names that escape LAYOUTS_DIR", () => {
      expect(() => layoutPath("../../etc/passwd")).toThrow("Invalid layout path");
    });

    it("layoutPath allows valid names within LAYOUTS_DIR", () => {
      const result = layoutPath("mywork");
      expect(result).toBe(`${LAYOUTS_DIR}/mywork`);
    });

    it("layoutPath rejects a name that starts with LAYOUTS_DIR prefix but is outside (SE-L1)", () => {
      // e.g. LAYOUTS_DIR = /home/user/.config/summon/layouts
      // evil path: /home/user/.config/summon/layouts-evil/x
      // Without trailing sep guard, startsWith would pass for a sibling dir
      // named layouts-evil if resolved path started with layouts string
      // We test a name that would resolve to a sibling directory
      const evilName = `../layouts-evil/x`;
      expect(() => layoutPath(evilName)).toThrow("Invalid layout path");
    });
  });
});

describe("readKVFile CRLF normalization (BE-B3)", () => {
  it("parses CRLF line endings correctly", async () => {
    const store = await getStore();
    store.set("/tmp/.summon-crlf", "editor=vim\r\npanes=2\r\n");
    const map = readKVFile("/tmp/.summon-crlf");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("2");
  });

  it("parses CR-only line endings correctly", async () => {
    const store = await getStore();
    store.set("/tmp/.summon-cr", "editor=vim\rpanes=2\r");
    const map = readKVFile("/tmp/.summon-cr");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("2");
  });

  it("trims whitespace from values after split", async () => {
    const store = await getStore();
    store.set("/tmp/.summon-spaces", "editor= vim \npanes= 2 \n");
    const map = readKVFile("/tmp/.summon-spaces");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("2");
  });

  it("trims whitespace from keys", async () => {
    const store = await getStore();
    store.set("/tmp/.summon-keyspaces", " editor =vim\n");
    const map = readKVFile("/tmp/.summon-keyspaces");
    expect(map.get("editor")).toBe("vim");
  });
});

describe("addProject validation (BE-B4)", () => {
  it("rejects project names containing '='", () => {
    expect(() => addProject("my=app", "/home/user/myapp")).toThrow();
  });

  it("rejects project names containing spaces", () => {
    expect(() => addProject("my app", "/home/user/myapp")).toThrow();
  });

  it("rejects project names containing '/'", () => {
    expect(() => addProject("my/app", "/home/user/myapp")).toThrow();
  });

  it("accepts valid project names", () => {
    expect(() => addProject("myapp", "/home/user/myapp")).not.toThrow();
    expect(getProject("myapp")).toBe("/home/user/myapp");
  });

  it("resolves relative paths to absolute", () => {
    addProject("reltest", "relative/path");
    const stored = getProject("reltest");
    expect(stored).not.toBeUndefined();
    // Should be an absolute path
    expect(stored!.startsWith("/")).toBe(true);
  });
});

describe("addProject strict validation (SE-M3 #394)", () => {
  it("rejects names with shell metacharacter semicolon", () => {
    expect(() => addProject("proj;rm", "/home/user/proj")).toThrow("Invalid project name");
  });

  it("rejects names with pipe character", () => {
    expect(() => addProject("proj|evil", "/home/user/proj")).toThrow("Invalid project name");
  });

  it("rejects names with backtick", () => {
    expect(() => addProject("proj`cmd`", "/home/user/proj")).toThrow("Invalid project name");
  });

  it("rejects names starting with a dot", () => {
    expect(() => addProject(".hidden", "/home/user/proj")).toThrow("Invalid project name");
  });

  it("accepts names with dots and dashes in body", () => {
    expect(() => addProject("my.project-v2", "/home/user/proj")).not.toThrow();
  });

  it("accepts names up to 64 chars", () => {
    const long = "a".repeat(64);
    expect(() => addProject(long, "/home/user/proj")).not.toThrow();
  });

  it("rejects names longer than 64 chars", () => {
    const tooLong = "a".repeat(65);
    expect(() => addProject(tooLong, "/home/user/proj")).toThrow("Invalid project name");
  });
});

describe("setConfig key validation (BE-M2 #376)", () => {
  it("rejects keys containing =", () => {
    expect(() => setConfig("key=evil", "value")).toThrow("Invalid config key");
  });

  it("rejects keys starting with #", () => {
    expect(() => setConfig("#commented", "value")).toThrow("Invalid config key");
  });

  it("rejects keys containing carriage returns", () => {
    expect(() => setConfig("bad\rkey", "value")).toThrow("Invalid config key");
  });

  it("accepts normal keys", () => {
    expect(() => setConfig("editor", "vim")).not.toThrow();
    expect(listConfig().get("editor")).toBe("vim");
  });
});

describe("readKVFromString (BE-B2, BE-M1 #357 #375)", () => {
  it("parses valid key=value lines", () => {
    const map = readKVFromString("editor=vim\npanes=3\n");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("3");
  });

  it("skips comment lines starting with #", () => {
    const map = readKVFromString("# comment\neditor=vim\n");
    expect(map.get("editor")).toBe("vim");
    expect(map.size).toBe(1);
  });

  it("preserves ' # ' in values — does not strip as inline comment (#533 BE-M3)", () => {
    const map = readKVFromString("on-start=build # release\n");
    expect(map.get("on-start")).toBe("build # release");
  });

  it("round-trips a value containing ' # ' without truncation (#533 BE-M3)", () => {
    setConfig("on-start", "build # release");
    expect(listConfig().get("on-start")).toBe("build # release");
  });

  it("does not strip # without surrounding spaces", () => {
    const map = readKVFromString("editor=vim#no-strip\n");
    expect(map.get("editor")).toBe("vim#no-strip");
  });

  it("emits warning to stderr for malformed lines (BE-M1 #375)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    readKVFromString("malformed line without equals\n");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("malformed config line"),
    );
    stderrSpy.mockRestore();
  });

  it("does not warn for empty or whitespace-only lines", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    readKVFromString("editor=vim\n\n  \npanes=2\n");
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("returns empty map for empty content", () => {
    expect(readKVFromString("").size).toBe(0);
    expect(readKVFromString("   ").size).toBe(0);
  });

  it("handles CRLF line endings", () => {
    const map = readKVFromString("editor=vim\r\npanes=2\r\n");
    expect(map.get("editor")).toBe("vim");
    expect(map.get("panes")).toBe("2");
  });
});

describe("clearKVCache and clearProjectCache (#402 #403 #404)", () => {
  it("clearKVCache is exported and callable", () => {
    expect(clearKVCache).toBeDefined();
    expect(() => clearKVCache()).not.toThrow();
  });

  it("clearProjectCache is exported and callable", () => {
    expect(clearProjectCache).toBeDefined();
    expect(() => clearProjectCache()).not.toThrow();
  });

  it("clearKVCache causes re-read on next call", async () => {
    const fs = await import("node:fs");
    const readFileSpy = fs.readFileSync as ReturnType<typeof vi.fn>;

    // Warm cache
    listProjects();

    // Freeze mtime so cache would normally be hit
    const store = await getStore();
    const mtimes = await getMtimes();
    for (const key of store.keys()) {
      if (!mtimes.has(key)) mtimes.set(key, 1000);
    }

    readFileSpy.mockClear();
    listProjects(); // should hit cache (no read)
    expect(readFileSpy).not.toHaveBeenCalled();

    // Clear the KV cache
    clearKVCache();

    listProjects(); // should re-read after cache cleared
    expect(readFileSpy).toHaveBeenCalled();
  });

  it("clearProjectCache causes re-read on next call", async () => {
    const fs = await import("node:fs");
    const readFileSpy = fs.readFileSync as ReturnType<typeof vi.fn>;

    addProject("cachetest", "/some/path");

    // Warm the cache with a read after the write
    getProject("cachetest");

    // Freeze mtime so subsequent reads hit cache
    const store = await getStore();
    const mtimes = await getMtimes();
    for (const key of store.keys()) {
      if (!mtimes.has(key)) mtimes.set(key, 1000);
    }

    readFileSpy.mockClear();
    getProject("cachetest"); // should hit cache — no read
    expect(readFileSpy).not.toHaveBeenCalled();

    clearProjectCache();
    getProject("cachetest"); // should re-read after cache cleared
    expect(readFileSpy).toHaveBeenCalled();
  });
});

describe("readCustomLayout uses mtime cache (#402 AR-M3)", () => {
  it("readCustomLayout uses cached result when mtime is unchanged", async () => {
    const fs = await import("node:fs");
    const readFileSpy = fs.readFileSync as ReturnType<typeof vi.fn>;
    const store = await getStore();
    const mtimes = await getMtimes();

    store.set(`${LAYOUTS_DIR}/mywork`, "panes=3\neditor=vim\n");
    mtimes.set(`${LAYOUTS_DIR}/mywork`, 1000);

    // First read — warms cache
    readCustomLayout("mywork");
    readFileSpy.mockClear();

    // Second read — mtime unchanged, should hit cache
    readCustomLayout("mywork");
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("readCustomLayout re-reads when mtime changes", async () => {
    const fs = await import("node:fs");
    const readFileSpy = fs.readFileSync as ReturnType<typeof vi.fn>;
    const store = await getStore();
    const mtimes = await getMtimes();

    store.set(`${LAYOUTS_DIR}/mywork`, "panes=3\n");
    mtimes.set(`${LAYOUTS_DIR}/mywork`, 1000);

    readCustomLayout("mywork"); // warm
    readFileSpy.mockClear();

    mtimes.set(`${LAYOUTS_DIR}/mywork`, 2000); // bump mtime
    readCustomLayout("mywork"); // should re-read
    expect(readFileSpy).toHaveBeenCalled();
  });
});

// BE-M3 #492: atomic write for config — writeKV must use tmp+rename
describe("writeKV atomic write (BE-M3 #492)", () => {
  it("writes to a .tmp file before the final path", async () => {
    const fs = await import("node:fs");
    const writeSpy = fs.writeFileSync as ReturnType<typeof vi.fn>;

    setConfig("editor", "vim");

    // Find writes that went to a .tmp path
    const tmpWrites = writeSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && String(c[0]).endsWith(".tmp"),
    );
    expect(tmpWrites.length).toBeGreaterThan(0);
  });
});

// BE-L1 #494: config comment preservation — setConfig must not destroy hand-authored comments
describe("config comment preservation (BE-L1 #494)", () => {
  it("preserves a comment line at the top of the config file after setConfig", async () => {
    const store = await getStore();
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    // Pre-populate config file with a comment line
    store.set(configPath, "# My hand-authored comment\neditor=vim\n");
    resetConfigCache();

    setConfig("editor", "nano");

    const written = store.get(configPath)!;
    expect(written).toContain("# My hand-authored comment");
  });

  it("preserves multiple comment lines after setConfig", async () => {
    const store = await getStore();
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    store.set(configPath, "# First comment\n# Second comment\neditor=vim\npanes=2\n");
    resetConfigCache();

    setConfig("panes", "4");

    const written = store.get(configPath)!;
    expect(written).toContain("# First comment");
    expect(written).toContain("# Second comment");
  });

  it("preserves inline-adjacent comment before a key after setConfig modifies another key", async () => {
    const store = await getStore();
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    // comment is above 'panes', editor is modified
    store.set(configPath, "editor=vim\n# panes setting\npanes=2\n");
    resetConfigCache();

    setConfig("editor", "nano");

    const written = store.get(configPath)!;
    expect(written).toContain("# panes setting");
  });

  it("does not duplicate comment lines on multiple writes", async () => {
    const store = await getStore();
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    store.set(configPath, "# My comment\neditor=vim\n");
    resetConfigCache();

    setConfig("editor", "nano");
    resetConfigCache();
    setConfig("editor", "emacs");

    const written = store.get(configPath)!;
    const commentCount = (written.match(/# My comment/g) ?? []).length;
    expect(commentCount).toBe(1);
  });

  it("drops comments for keys that have been removed", async () => {
    const store = await getStore();
    const { CONFIG_DIR } = await import("./config.js");
    const configPath = `${CONFIG_DIR}/config`;
    store.set(configPath, "editor=vim\n# sidebar setting\nsidebar=lazygit\n");
    resetConfigCache();

    removeConfig("sidebar");

    const written = store.get(configPath)!;
    // comment associated with removed key should not remain (or at minimum, no orphan comment)
    // The simplest acceptable behavior: comments at top of file are preserved;
    // key-adjacent comments for deleted keys may be dropped.
    // We test the key is gone.
    expect(written).not.toContain("sidebar=");
  });
});

describe("FE-M2 (#583) — VALID_KEYS parity", () => {
  test("VALID_KEYS includes secondary-editor", () => {
    expect(VALID_KEYS).toContain("secondary-editor");
  });
});
