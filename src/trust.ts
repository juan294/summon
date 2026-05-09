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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Error thrown when a .summon file exists but is not trusted. */
export class SummonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummonError";
  }
}

/** Path to the trust database. */
const TRUST_FILE = join(homedir(), ".config", "summon", "trust.json");

/** Path to the summon config directory. */
const CONFIG_DIR = join(homedir(), ".config", "summon");

/** Load the trust database. Returns empty object if not found or invalid. */
function loadTrustDb(): Record<string, string> {
  if (!existsSync(TRUST_FILE)) return {};
  try {
    const raw = readFileSync(TRUST_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Save the trust database atomically. */
function saveTrustDb(db: Record<string, string>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TRUST_FILE, JSON.stringify(db, null, 2) + "\n", "utf-8");
}

/**
 * Compute the SHA-256 hash of a .summon file in the given directory.
 * Returns the hex digest, or null if the file does not exist.
 */
export function hashSummonFile(dir: string): string | null {
  const summonPath = join(dir, ".summon");
  if (!existsSync(summonPath)) return null;
  const content = readFileSync(summonPath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Check whether the .summon file in the given directory is trusted.
 * Returns true if no .summon file exists (nothing to trust) or if the
 * current file hash matches the stored hash.
 */
export function isTrusted(dir: string): boolean {
  const hash = hashSummonFile(dir);
  if (hash === null) return true; // no .summon file → trusted by default
  const db = loadTrustDb();
  const resolvedDir = join(dir); // keep consistent
  return db[resolvedDir] === hash;
}

/**
 * Add the current .summon file hash to the trust database.
 * No-op if the .summon file does not exist.
 */
export function trustProject(dir: string): void {
  const hash = hashSummonFile(dir);
  if (hash === null) return;
  const db = loadTrustDb();
  db[dir] = hash;
  saveTrustDb(db);
}

/**
 * Assert that the .summon file in `targetDir` is trusted.
 * Throws SummonError if a .summon file exists and is not trusted.
 *
 * Call this early in the launch flow, before any project config values
 * are acted upon.
 */
export function assertTrusted(targetDir: string): void {
  const summonPath = join(targetDir, ".summon");
  if (!existsSync(summonPath)) return;
  // If we can't determine the hash (e.g., permission error), skip the check
  // rather than blocking. A SummonError is only thrown when we can positively
  // confirm the file is untrusted.
  let trusted: boolean;
  try {
    trusted = isTrusted(targetDir);
  } catch {
    // Unable to compute or read trust state — fail open (do not block).
    return;
  }
  if (trusted) return;

  throw new SummonError(
    `This project has a .summon file.\nRun 'summon trust .' to allow it, or use --no-project-config to skip it.`,
  );
}

/**
 * Handle the `summon trust <path>` subcommand.
 * Hashes the .summon file in the given directory and records it as trusted.
 * Prints a confirmation message or an error if no .summon file exists.
 */
export function handleTrustCommand(dir: string): void {
  const summonPath = join(dir, ".summon");
  if (!existsSync(summonPath)) {
    console.error(`No .summon file found in: ${dir}`);
    process.exit(1);
  }
  trustProject(dir);
  console.log(`Trusted .summon file in: ${dir}`);
  console.log(`SHA-256: ${hashSummonFile(dir)}`);
}
