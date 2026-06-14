/**
 * Persistent cross-invocation config cache (#516 / #330 PE-S2).
 *
 * A strict read-through accelerator: cache entries are keyed on absolute
 * path + mtimeMs + size. Any mismatch → MISS; caller re-reads from disk.
 *
 * Opt-out: set SUMMON_NO_CACHE=1 to disable read and write.
 * Corrupt cache.json → silently ignored, never throws.
 */
import { readFileSync } from "node:fs";
import { CACHE_FILE } from "./paths.js";
import { atomicWrite } from "./utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  size: number;
  /** KV pairs serialised as a JSON array of [key, value] tuples. */
  data: [string, string][];
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** Whether the in-memory cache has been loaded from disk. */
let loaded = false;
/** The live in-memory cache. */
let mem: CacheFile = { version: 1, entries: {} };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isNoCache(): boolean {
  return process.env["SUMMON_NO_CACHE"] === "1";
}

/** Load cache.json into memory (best-effort; any error → treat all as miss). */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (isNoCache()) return;
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>)["version"] === 1 &&
      typeof (parsed as Record<string, unknown>)["entries"] === "object"
    ) {
      mem = parsed as CacheFile;
    }
    // version !== 1 or unexpected shape → leave mem as empty (all entries are miss)
  } catch {
    // Unreadable or corrupt cache.json → silently ignore
    mem = { version: 1, entries: {} };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up `path` in the persistent cache.
 *
 * Returns the cached Map when `mtimeMs` and `size` both match; null on miss.
 * Returns null when SUMMON_NO_CACHE=1.
 */
export function getCachedKV(
  path: string,
  mtimeMs: number,
  size: number,
): Map<string, string> | null {
  if (isNoCache()) return null;
  ensureLoaded();
  const entry = mem.entries[path];
  if (!entry) return null;
  if (entry.mtimeMs !== mtimeMs || entry.size !== size) return null;
  // Return a defensive copy so mutations do not corrupt the cache
  return new Map(entry.data);
}

/**
 * Store `data` for `path` with the given `mtimeMs` + `size` as the
 * invalidation key.  Does nothing when SUMMON_NO_CACHE=1.
 */
export function putCachedKV(
  path: string,
  data: Map<string, string>,
  mtimeMs: number,
  size: number,
): void {
  if (isNoCache()) return;
  ensureLoaded();
  mem.entries[path] = {
    mtimeMs,
    size,
    data: [...data.entries()],
  };
}

/**
 * Write the in-memory cache to disk atomically (mode 0o600).
 *
 * Called once at process exit via `process.on("exit")` and also exported for
 * tests to trigger manually. Does nothing when SUMMON_NO_CACHE=1 or if the
 * cache has never been populated.
 */
export function flushCacheToDisk(): void {
  if (isNoCache()) return;
  if (!loaded) return;
  try {
    atomicWrite(CACHE_FILE, JSON.stringify(mem), { mode: 0o600 });
  } catch {
    // Best-effort: if write fails (e.g. missing directory) silently swallow.
  }
}

// Register a one-time process exit flush so callers do not need to manage it.
// The handler is idempotent because flushCacheToDisk itself is safe to call
// multiple times (it just re-serialises the same in-memory state).
process.on("exit", flushCacheToDisk);

/**
 * Remove the persistent cache entry for `path`.
 * Called by config.ts after a write so the next read is always a definite miss.
 */
export function invalidateCachedKV(path: string): void {
  if (!loaded) return; // nothing to invalidate yet
  delete mem.entries[path];
}

/**
 * Reset the in-memory cache state.
 * @internal — exported for testing only.
 */
export function resetPersistentCache(): void {
  loaded = false;
  mem = { version: 1, entries: {} };
}
