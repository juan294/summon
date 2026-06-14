import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CACHE_FILE } from "./paths.js";

// We mock the filesystem for cache.ts to work without real disk I/O.
// cache.ts uses node:fs for statSync, readFileSync, and atomicWrite (via utils.ts).
// We intercept those via vi.mock.
vi.mock("node:fs", () => {
  const store = new Map<string, string>();
  const sizes = new Map<string, number>();
  const mtimes = new Map<string, number>();
  return {
    existsSync: (path: string) => store.has(path),
    readFileSync: vi.fn((path: string, _enc?: string) => {
      const v = store.get(path);
      if (v === undefined) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return v;
    }),
    writeFileSync: vi.fn((path: string, data: string) => {
      store.set(path, data);
    }),
    renameSync: vi.fn((src: string, dest: string) => {
      const data = store.get(src);
      if (data === undefined) throw new Error(`ENOENT: no such file '${src}'`);
      store.set(dest, data);
      store.delete(src);
    }),
    statSync: vi.fn((path: string) => {
      if (!store.has(path)) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return {
        mtimeMs: mtimes.get(path) ?? 1000,
        size: sizes.get(path) ?? 100,
      };
    }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((path: string) => { store.delete(path); }),
    readdirSync: vi.fn(() => []),
    __store: store,
    __sizes: sizes,
    __mtimes: mtimes,
  };
});

async function getStore(): Promise<Map<string, string>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __store: Map<string, string> }).__store;
}
async function getMtimes(): Promise<Map<string, number>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __mtimes: Map<string, number> }).__mtimes;
}
async function getSizes(): Promise<Map<string, number>> {
  const mod = await import("node:fs");
  return (mod as unknown as { __sizes: Map<string, number> }).__sizes;
}

// Import after mock so module uses the mocked fs
const { getCachedKV, putCachedKV, resetPersistentCache } = await import("./cache.js");

beforeEach(async () => {
  const store = await getStore();
  store.clear();
  const mtimes = await getMtimes();
  mtimes.clear();
  const sizes = await getSizes();
  sizes.clear();
  resetPersistentCache();
  // Reset env
  delete process.env["SUMMON_NO_CACHE"];
});

afterEach(() => {
  delete process.env["SUMMON_NO_CACHE"];
});

describe("getCachedKV / putCachedKV — basic HIT/MISS", () => {
  it("returns null when cache file does not exist (cold start)", async () => {
    const result = getCachedKV("/some/config", 1000, 100);
    expect(result).toBeNull();
  });

  it("returns null when no entry for the path exists in cache", async () => {
    const store = await getStore();
    const mtimes = await getMtimes();
    const sizes = await getSizes();
    // Put a different path in cache
    store.set("/other/config", "key=value\n");
    mtimes.set("/other/config", 1000);
    sizes.set("/other/config", 100);
    putCachedKV("/other/config", new Map([["key", "value"]]), 1000, 100);

    const result = getCachedKV("/some/config", 1000, 100);
    expect(result).toBeNull();
  });

  it("HIT: returns same data after put with matching mtimeMs and size", async () => {
    const data = new Map([["editor", "vim"], ["panes", "3"]]);
    putCachedKV("/config/path", data, 1234, 56);
    const hit = getCachedKV("/config/path", 1234, 56);
    expect(hit).not.toBeNull();
    expect(hit!.get("editor")).toBe("vim");
    expect(hit!.get("panes")).toBe("3");
  });

  it("MISS: returns null when mtimeMs differs", async () => {
    const data = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", data, 1000, 100);
    // Different mtime
    const miss = getCachedKV("/config/path", 2000, 100);
    expect(miss).toBeNull();
  });

  it("MISS: returns null when size differs", async () => {
    const data = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", data, 1000, 100);
    // Different size
    const miss = getCachedKV("/config/path", 1000, 200);
    expect(miss).toBeNull();
  });

  it("HIT returns a copy — mutations do not affect cached data", async () => {
    const data = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", data, 1000, 100);
    const hit = getCachedKV("/config/path", 1000, 100)!;
    hit.set("editor", "nano");
    // Cache entry should not be affected
    const hit2 = getCachedKV("/config/path", 1000, 100)!;
    expect(hit2.get("editor")).toBe("vim");
  });
});

describe("persistent cache — disk round-trip", () => {
  it("persists to disk and is recovered on fresh module load (simulated by resetPersistentCache)", async () => {
    const data = new Map([["editor", "vim"]]);
    putCachedKV("/abs/config", data, 999, 42);

    // Flush to disk
    const { flushCacheToDisk } = await import("./cache.js");
    flushCacheToDisk();

    const store = await getStore();
    // cache.json should exist on disk now
    expect(store.has(CACHE_FILE)).toBe(true);

    // Simulate fresh process by resetting in-memory cache
    resetPersistentCache();

    // Now a get should re-read cache.json from disk
    const hit = getCachedKV("/abs/config", 999, 42);
    expect(hit).not.toBeNull();
    expect(hit!.get("editor")).toBe("vim");
  });

  it("corrupt cache.json is silently ignored (no throw, behaves as cold)", async () => {
    const store = await getStore();
    store.set(CACHE_FILE, "{this is not valid json{{");
    resetPersistentCache();

    // Should not throw; no entry
    expect(() => getCachedKV("/abs/config", 1000, 100)).not.toThrow();
    const result = getCachedKV("/abs/config", 1000, 100);
    expect(result).toBeNull();
  });

  it("cache.json with version != 1 is treated as MISS", async () => {
    const store = await getStore();
    const badVersion = JSON.stringify({
      version: 99,
      entries: { "/abs/config": { mtimeMs: 1000, size: 100, data: [["editor", "vim"]] } },
    });
    store.set(CACHE_FILE, badVersion);
    resetPersistentCache();

    const result = getCachedKV("/abs/config", 1000, 100);
    expect(result).toBeNull();
  });

  it("valid cache.json with matching entry is a HIT after resetPersistentCache", async () => {
    const store = await getStore();
    const cacheJson = JSON.stringify({
      version: 1,
      entries: {
        "/abs/config": { mtimeMs: 1000, size: 100, data: [["editor", "vim"], ["panes", "2"]] },
      },
    });
    store.set(CACHE_FILE, cacheJson);
    resetPersistentCache();

    const hit = getCachedKV("/abs/config", 1000, 100);
    expect(hit).not.toBeNull();
    expect(hit!.get("editor")).toBe("vim");
    expect(hit!.get("panes")).toBe("2");
  });
});

describe("SUMMON_NO_CACHE=1", () => {
  it("getCachedKV returns null when SUMMON_NO_CACHE=1 (no read)", async () => {
    process.env["SUMMON_NO_CACHE"] = "1";
    const data = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", data, 1000, 100);
    // Even after put, get returns null when env is set
    const result = getCachedKV("/config/path", 1000, 100);
    expect(result).toBeNull();
  });

  it("flushCacheToDisk does not write when SUMMON_NO_CACHE=1", async () => {
    process.env["SUMMON_NO_CACHE"] = "1";
    const { flushCacheToDisk } = await import("./cache.js");
    const fs = await import("node:fs");
    const writeSpy = fs.writeFileSync as ReturnType<typeof vi.fn>;
    writeSpy.mockClear();

    const data = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", data, 1000, 100);
    flushCacheToDisk();

    const cacheWrites = writeSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && String(c[0]).includes("cache"),
    );
    expect(cacheWrites.length).toBe(0);
  });
});

describe("cache does not serve stale data across file edits", () => {
  it("after edit (mtime change) the new data is not served by the old cache entry", async () => {
    // Simulate: put entry with mtime=1000, then file changes to mtime=2000
    const oldData = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", oldData, 1000, 100);

    // File changed — new mtime
    const hit = getCachedKV("/config/path", 2000, 100);
    // Must be null — no stale data served
    expect(hit).toBeNull();
  });

  it("after size change the old cache entry is not served", async () => {
    const data = new Map([["editor", "vim"]]);
    putCachedKV("/config/path", data, 1000, 100);

    const hit = getCachedKV("/config/path", 1000, 200);
    expect(hit).toBeNull();
  });
});
