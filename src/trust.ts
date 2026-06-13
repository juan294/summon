/**
 * Trust management for .summon project configuration files.
 *
 * Implements a direnv-style allowlist: before any .summon file's values are
 * acted upon, the file must be explicitly trusted by the user via `summon trust <dir>`.
 * Trust is stored as a SHA-256 hash of the file content in ~/.config/summon/trust.json.
 * If the file changes (content changes, hash changes), trust is revoked and must be
 * re-granted.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { atomicWrite } from "./utils.js";
import { TRUST_FILE, CONFIG_DIR } from "./paths.js";

/** Error thrown when a .summon file exists but is not trusted. */
export class SummonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummonError";
  }
}

/** Mtime-based cache: avoid rehashing on every launch when the file hasn't changed. */
const trustCache = new Map<string, { mtimeMs: number; trusted: boolean }>();

export function clearTrustCache(): void {
  trustCache.clear();
}

/** Load the trust database. Returns empty object if not found or invalid. */
function loadTrustDb(): Record<string, string> {
  if (!existsSync(TRUST_FILE)) return {};
  try {
    const raw = readFileSync(TRUST_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    // Wrong shape (e.g. an array) — warn and return empty
    process.stderr.write(
      `summon: warning: trust database at ${TRUST_FILE} has unexpected shape; treating as empty.\n`,
    );
    return {};
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {}; // vanished between existsSync and readFileSync — normal
    // Corrupt JSON or permission denied — warn and return empty (BE-M4)
    process.stderr.write(
      `summon: warning: could not read trust database at ${TRUST_FILE}: ${(err as Error).message ?? String(err)}\n`,
    );
    return {};
  }
}

/** Save the trust database atomically (BE-M3). */
function saveTrustDb(db: Record<string, string>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  atomicWrite(TRUST_FILE, JSON.stringify(db, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

/**
 * Compute the SHA-256 hash of a string.
 * Returns the hex digest.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compute the SHA-256 hash of a .summon file in the given directory.
 * Returns the hex digest, or null if the file does not exist.
 */
export function hashSummonFile(dir: string): string | null {
  const summonPath = join(dir, ".summon");
  if (!existsSync(summonPath)) return null;
  const content = readFileSync(summonPath, "utf-8");
  return hashContent(content);
}

/**
 * Check whether the .summon file in the given directory is trusted.
 * Returns true if no .summon file exists (nothing to trust) or if the
 * current file hash matches the stored hash. Results are mtime-memoized
 * so repeated launches do not rehash an unchanged file.
 */
export function isTrusted(dir: string): boolean {
  const normalizedDir = (() => { try { return realpathSync(dir); } catch { return resolve(dir); } })();
  // BE-H1 (#590): use normalizedDir (realpath) for all fs operations so that symlinked
  // paths (e.g. macOS /tmp → /private/tmp) stat and read the same file that was hashed
  // and keyed when the project was trusted via trustProject().
  const summonPath = join(normalizedDir, ".summon");

  if (!existsSync(summonPath)) return true; // no .summon file → trusted by default

  // Use mtime to skip rehash when file is unchanged
  let mtimeMs: number;
  try {
    mtimeMs = statSync(summonPath).mtimeMs;
  } catch {
    // File disappeared between existsSync and statSync → treat as absent
    return true;
  }

  const cached = trustCache.get(normalizedDir);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.trusted;

  const content = readFileSync(summonPath, "utf-8");
  const hash = hashContent(content);
  const db = loadTrustDb();
  const trusted = db[normalizedDir] === hash;
  trustCache.set(normalizedDir, { mtimeMs, trusted });
  return trusted;
}

/**
 * Add the current .summon file hash to the trust database.
 * No-op if the .summon file does not exist.
 */
export function trustProject(dir: string): void {
  const normalizedDir = (() => { try { return realpathSync(dir); } catch { return resolve(dir); } })();
  const hash = hashSummonFile(dir);
  if (hash === null) return;
  const db = loadTrustDb();
  db[normalizedDir] = hash;
  saveTrustDb(db);
}

/**
 * Assert that the .summon file is trusted using pre-read content.
 * Throws SummonError if the content hash does not match the stored trust hash.
 *
 * Use this variant when the file content has already been read from disk,
 * to avoid a TOCTOU race between hashing and parsing (BE-B2 #357).
 *
 * Normalizes `targetDir` via `realpathSync` so that symlinked paths (e.g.
 * macOS /tmp → /private/tmp) resolve to the same key used by `trustProject`.
 *
 * INVARIANT (SE-L3 #610): All launch-ACTING callers — those that execute commands
 * from a .summon file — MUST use assertTrustedContent with the exact bytes they
 * parsed (read-once, hash, compare). This ensures the bytes that were hashed are
 * the same bytes that will be acted upon, eliminating any TOCTOU window between
 * the trust check and command execution. assertTrusted re-reads the file from
 * disk and is NOT safe for acting callers.
 */
export function assertTrustedContent(targetDir: string, content: string): void {
  const normalizedDir = (() => { try { return realpathSync(targetDir); } catch { return resolve(targetDir); } })();
  const hash = hashContent(content);
  const db = loadTrustDb();
  if (db[normalizedDir] === hash) return;

  throw new SummonError(
    `This project has a .summon file.\nRun 'summon trust ${normalizedDir}' to allow it, or use --no-project-config to skip it.`,
  );
}

/**
 * Assert that the .summon file in `targetDir` is trusted.
 * Throws SummonError if a .summon file exists and is not trusted.
 *
 * Call this early in the launch flow, before any project config values
 * are acted upon.
 *
 * INVARIANT (SE-L3 #610): assertTrusted is intended ONLY for read-only or
 * non-acting callers (e.g. status checks, informational displays). It re-reads
 * the .summon file from disk internally and is NOT TOCTOU-safe for callers that
 * will execute commands derived from that file. Any caller that will act on the
 * contents of .summon MUST use assertTrustedContent instead, passing the exact
 * bytes it already read and intends to parse.
 */
export function assertTrusted(targetDir: string, opts?: { skip?: boolean }): void {
  if (opts?.skip) return;
  const normalizedDir = (() => { try { return realpathSync(targetDir); } catch { return resolve(targetDir); } })();
  const summonPath = join(targetDir, ".summon");
  if (!existsSync(summonPath)) return;
  // If we can't determine the hash (e.g., permission error), skip the check
  // rather than blocking. A SummonError is only thrown when we can positively
  // confirm the file is untrusted.
  let trusted: boolean;
  try {
    trusted = isTrusted(targetDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return; // file vanished between existsSync and read → nothing to check
    // All other errors (non-OS errors like TypeError, or OS errors like EACCES) → fail closed
    throw new Error(
      `Cannot verify trust for this project; run 'summon trust ${normalizedDir}' to re-establish`,
      { cause: err },
    );
  }
  if (trusted) return;

  throw new SummonError(
    `This project has a .summon file.\nRun 'summon trust ${normalizedDir}' to allow it, or use --no-project-config to skip it.`,
  );
}

/**
 * Handle the `summon trust <path>` subcommand.
 * Hashes the .summon file in the given directory and records it as trusted.
 * Prints a confirmation message or an error if no .summon file exists.
 */
export function handleTrustCommand(dir: string): void {
  const resolvedDir = resolve(dir);
  const summonPath = join(resolvedDir, ".summon");
  if (!existsSync(summonPath)) {
    console.error(`No .summon file found in: ${resolvedDir}`);
    process.exit(1);
  }
  trustProject(resolvedDir);
  console.log(`Trusted .summon file in: ${resolvedDir}`);
  console.log(`SHA-256: ${hashSummonFile(resolvedDir)}`);
}
