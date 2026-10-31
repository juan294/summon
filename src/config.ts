import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { isPresetName } from "./layout.js";
import { CONFIG_DIR, LAYOUTS_DIR } from "./paths.js";
import { PROJECT_NAME_RE as STRICT_PROJECT_NAME_RE } from "./validation.js";
import { atomicWrite } from "./utils.js";
import { withFileLock } from "./file-lock.js";

// Re-export path constants for backward compatibility
export { CONFIG_DIR, LAYOUTS_DIR, STATUS_DIR, SNAPSHOTS_DIR } from "./paths.js";

const PROJECTS_FILE = join(CONFIG_DIR, "projects");
const CONFIG_FILE = join(CONFIG_DIR, "config");

let configEnsured = false;

function ensureConfig(): void {
  if (configEnsured) return;
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  for (const file of [PROJECTS_FILE, CONFIG_FILE]) {
    try { writeFileSync(file, "", { mode: 0o600, flag: "wx" }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  configEnsured = true;
}

/** @internal — exported for testing only */
export function resetConfigCache(): void {
  configEnsured = false;
  fileCache.clear();
  commentStore.clear();
}

/**
 * Check if this is a first-run scenario (config file does not exist yet).
 * Does NOT call ensureConfig() — must not create the file as a side effect.
 */
export function isFirstRun(): boolean {
  return !existsSync(CONFIG_FILE);
}

// --- Memoization cache keyed by file path ---

interface CacheEntry {
  mtime: number;
  data: Map<string, string>;
}

const fileCache = new Map<string, CacheEntry>();

/**
 * Comment line storage: maps file path → array of { line: string, beforeKey: string | null }.
 * `beforeKey` is the key of the KV pair that immediately follows the comment block,
 * or null if the comment appears at the end of the file (or there are no keys after it).
 * This is used by writeKV to re-insert comments in their original positions (BE-L1 #494).
 */
const commentStore = new Map<string, Array<{ line: string; beforeKey: string | null }>>();

// --- Per-project config ---

/**
 * Parse a KV config string (already read from disk) into a Map.
 * Same parsing logic as readKVFile but operates on a pre-read string.
 * Use this when the file content has already been read (e.g. for TOCTOU prevention).
 */
const MAX_MALFORMED_WARNINGS = 5;

export function readKVFromString(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const trimmed = content.trim();
  if (!trimmed) return map;
  let warnCount = 0;
  let skippedCount = 0;
  for (const line of trimmed.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0) {
        if (warnCount < MAX_MALFORMED_WARNINGS) {
          process.stderr.write("summon: warning: ignored malformed config line: " + trimmedLine + "\n");
          warnCount++;
        } else {
          skippedCount++;
        }
      }
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }
  if (skippedCount > 0) {
    process.stderr.write("summon: warning: " + skippedCount + " additional malformed config line(s) suppressed\n");
  }
  return map;
}

/**
 * Parse a KV content string and extract comment lines with their associated key.
 * Returns an array of { line, beforeKey } entries for use by writeKV.
 * @internal
 */
function parseCommentsFromString(content: string): Array<{ line: string; beforeKey: string | null }> {
  const comments: Array<{ line: string; beforeKey: string | null }> = [];
  const normalized = content.trim().replace(/\r\n?/g, "\n");
  if (!normalized) return comments;

  const lines = normalized.split("\n");
  // We need to find, for each comment line, the key of the next KV line after it.
  // Collect pending comment lines and flush them when we see a KV line.
  const pending: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith("#")) {
      pending.push(line);
    } else {
      const idx = line.indexOf("=");
      const key = idx !== -1 ? line.slice(0, idx).trim() : null;
      for (const commentLine of pending) {
        comments.push({ line: commentLine, beforeKey: key });
      }
      pending.length = 0;
    }
  }
  // Comments at the end of the file (no following KV line)
  for (const commentLine of pending) {
    comments.push({ line: commentLine, beforeKey: null });
  }
  return comments;
}

const MAX_CONFIG_FILE_BYTES = 1_048_576; // 1 MiB

export function readKVFile(path: string): Map<string, string> {
  let content: string;
  try {
    const stat = statSync(path);
    if (stat.size > MAX_CONFIG_FILE_BYTES) {
      process.stderr.write(
        `summon: warning: config file too large (${stat.size} bytes), skipping: ${path}\n`,
      );
      return new Map<string, string>();
    }
    content = readFileSync(path, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map<string, string>();
    throw err;
  }
  // Capture comment lines for this file so writeKV can restore them (BE-L1 #494)
  commentStore.set(path, parseCommentsFromString(content));
  return readKVFromString(content);
}

/**
 * In-process mtime memoization. PE-M1: there is no cross-invocation cache; a persistent cache.json measured no
 * gain over reading these small files (45.05 ms vs 44.34 ms median per `summon list`) and wrote on every exit.
 */
function readKVCached(file: string): Map<string, string> {
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    // File doesn't exist — bypass cache, let readKVFile handle it
    fileCache.delete(file);
    return readKVFile(file);
  }

  const cached = fileCache.get(file);
  if (cached !== undefined && cached.mtime === mtime) {
    return cached.data;
  }

  const data = readKVFile(file);
  fileCache.set(file, { mtime, data });
  return data;
}

function readKV(file: string): Map<string, string> {
  ensureConfig();
  return readKVCached(file);
}

function formatKVLines(map: Map<string, string>): string {
  const lines = [...map.entries()].map(
    ([k, v]) =>
      `${k.replace(/[\n\r]/g, "")}=${v.replace(/[\n\r]/g, "")}`,
  );
  return lines.join("\n") + "\n";
}

/**
 * Format KV lines with comment lines re-inserted at their original positions (BE-L1 #494).
 * Comments are associated with the key they precede; if that key no longer exists in `map`,
 * comments associated with a null key (end-of-file) are kept at the end.
 * Comments for deleted keys are dropped.
 */
function formatKVLinesWithComments(
  map: Map<string, string>,
  comments: Array<{ line: string; beforeKey: string | null }>,
): string {
  const result: string[] = [];

  // Index comments by the key they precede
  const byKey = new Map<string | null, string[]>();
  for (const { line, beforeKey } of comments) {
    const existing = byKey.get(beforeKey) ?? [];
    existing.push(line);
    byKey.set(beforeKey, existing);
  }

  for (const [k, v] of map.entries()) {
    const commentsBeforeKey = byKey.get(k);
    if (commentsBeforeKey) {
      result.push(...commentsBeforeKey);
      byKey.delete(k);
    }
    result.push(`${k.replace(/[\n\r]/g, "")}=${v.replace(/[\n\r]/g, "")}`);
  }

  // Append any remaining comments that were at the end of file (beforeKey=null)
  // or that were for keys no longer present (we drop those — only null-keyed ones remain)
  const trailing = byKey.get(null);
  if (trailing) {
    result.push(...trailing);
  }

  return result.join("\n") + "\n";
}

function writeKV(file: string, map: Map<string, string>): void {
  const comments = commentStore.get(file) ?? [];
  const content = comments.length > 0
    ? formatKVLinesWithComments(map, comments)
    : formatKVLines(map);
  // Atomic write: write to .tmp then rename (BE-M3 #492)
  atomicWrite(file, content, { mode: 0o600 });
  // Invalidate the cache after write so subsequent reads see fresh data
  fileCache.delete(file);
  // Update comment store to reflect what was actually written
  commentStore.set(file, parseCommentsFromString(content));
}

/** Read authoritative bytes and comments only after acquiring the per-file lock. */
function mutateKV<T>(file: string, mutate: (map: Map<string, string>) => { result: T; changed: boolean }): T {
  ensureConfig();
  return withFileLock(file, () => {
    const map = readKVFile(file);
    const { result, changed } = mutate(map);
    if (changed) writeKV(file, map);
    return result;
  });
}

// --- Projects ---

export function addProject(name: string, path: string): void {
  if (!STRICT_PROJECT_NAME_RE.test(name)) {
    throw new Error(`Invalid project name: "${name}". Names must start with a letter, digit, or underscore, contain only letters, digits, and "_.-", and be 1-64 chars.`);
  }
  const resolvedPath = resolve(path);
  mutateKV(PROJECTS_FILE, (projects) => {
    projects.set(name, resolvedPath);
    return { result: undefined, changed: true };
  });
}

export function removeProject(name: string): boolean {
  return mutateKV(PROJECTS_FILE, (projects) => {
    const existed = projects.delete(name);
    return { result: existed, changed: existed };
  });
}

export function getProject(name: string): string | undefined {
  return readKV(PROJECTS_FILE).get(name);
}

export function listProjects(): Map<string, string> {
  return readKV(PROJECTS_FILE);
}

// --- Machine config ---

export function setConfig(key: string, value: string): void {
  if (key.includes("=") || key.includes("\n") || key.includes("\r") || key.startsWith("#")) {
    throw new Error(`Invalid config key: "${key}". Keys must not contain '=', newlines, or start with '#'.`);
  }
  mutateKV(CONFIG_FILE, (config) => {
    config.set(key, value);
    return { result: undefined, changed: true };
  });
}

export function removeConfig(key: string): boolean {
  return mutateKV(CONFIG_FILE, (config) => {
    const existed = config.delete(key);
    return { result: existed, changed: existed };
  });
}

export function listConfig(): Map<string, string> {
  const config = readKV(CONFIG_FILE);
  for (const key of config.keys()) {
    // env.<KEY> entries are valid (see handleSetCommand) — don't flag them.
    if (!KNOWN_CONFIG_KEYS.has(key) && !key.startsWith("env.")) {
      console.warn(`summon: unknown config key: ${key}`);
    }
  }
  return config;
}

export const VALID_KEYS = ["editor", "sidebar", "secondary-editor", "panes", "editor-size", "shell", "layout", "auto-resize", "starship-preset", "new-window", "new-tab", "fullscreen", "maximize", "float", "font-size", "on-start", "on-stop", "clean"];

/** Set of all known config keys — used to warn on unknown/misspelled keys. */
export const KNOWN_CONFIG_KEYS = new Set(VALID_KEYS);

/** Config keys that accept only "true" or "false" values. */
export const BOOLEAN_KEYS = new Set(["auto-resize", "new-window", "new-tab", "fullscreen", "maximize", "float", "clean"]);

export const CLI_FLAGS = [
  "--help", "--version", "--layout", "--editor", "--panes",
  "--editor-size", "--sidebar", "--shell", "--auto-resize",
  "--no-auto-resize", "--starship-preset", "--dry-run",
  "--env", "--new-window", "--new-tab", "--fullscreen", "--maximize", "--float", "--font-size", "--on-start", "--once",
  "--clean", "--no-clean", "--no-project-config", "--verbose", "--json", "--set", "--reset", "--detach-tab", "--orphans",
  "-h", "-v", "-l", "-e", "-p", "-s", "-n",
];

// --- Custom layouts ---

export const LAYOUT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function isValidLayoutName(name: string): boolean {
  return LAYOUT_NAME_RE.test(name) && !isPresetName(name);
}

/** @internal — exported for testing only */
export function layoutPath(name: string): string {
  const filePath = join(LAYOUTS_DIR, name);
  if (!resolve(filePath).startsWith(resolve(LAYOUTS_DIR) + sep)) {
    throw new Error(`Invalid layout path: "${name}"`);
  }
  return filePath;
}

export function listCustomLayouts(): string[] {
  if (!existsSync(LAYOUTS_DIR)) return [];
  // BE-M4 #605: filter out orphaned .tmp files and dotfiles so they never appear as phantom entries
  return readdirSync(LAYOUTS_DIR)
    .filter(f => !f.startsWith(".") && !f.endsWith(".tmp"))
    .sort();
}

export function readCustomLayout(name: string): Map<string, string> | null {
  const filePath = layoutPath(name);
  if (!existsSync(filePath)) return null;
  // Use readKVCached (not readKVFile) so custom layout reads participate in
  // the mtime-based memoization — fixes #402 AR-M3 implicit coupling.
  return readKVCached(filePath);
}

export function saveCustomLayout(name: string, entries: Map<string, string>): void {
  mkdirSync(LAYOUTS_DIR, { recursive: true, mode: 0o700 });
  atomicWrite(layoutPath(name), formatKVLines(entries), { mode: 0o600 });
}

export function deleteCustomLayout(name: string): boolean {
  try {
    unlinkSync(layoutPath(name));
    return true;
  } catch {
    return false;
  }
}

export function isCustomLayout(name: string): boolean {
  return existsSync(layoutPath(name));
}
