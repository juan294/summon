import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * BE-L2: an owner token older than this is stale whatever the PID probe says (a reused PID, or
 * EPERM). Every critical section is local I/O on one small file (a key=value config file, a status
 * record, the trust DB) plus idempotent side-file removal: no subprocess, network or git call runs
 * under the lock, so a transaction takes milliseconds and a waiter gives up after 3 s. One minute
 * is 20 times that wait. Only an owner suspended mid-transaction (Ctrl-Z, sleep) for a minute could
 * lose the lock.
 */
export const STALE_LOCK_MS = 60_000;

const TOKEN_RE = /^([1-9]\d*)-[0-9a-f-]{36}\.owner$/;

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** Remove only the observed owner's token; a replacement owner keeps the directory nonempty. */
function removeOwner(directory: string, token?: string): void {
  if (token) {
    try { unlinkSync(join(directory, token)); } catch (error) {
      if (code(error) !== "ENOENT") throw error;
    }
  }
  try { rmdirSync(directory); } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(code(error) ?? "")) throw error;
  }
}

export type LockState =
  | { kind: "absent" }
  /** Empty: an interrupted release. */
  | { kind: "released" }
  /** Not exactly one well-formed owner token: never removed automatically. */
  | { kind: "unrecognized"; entries: string[] }
  /** `live` within STALE_LOCK_MS, `dead` once the PID is proven absent, `expired` past the bound. */
  | { kind: "live" | "dead" | "expired"; pid: number; token: string; ageMs: number };

/** Classify a lock directory without changing it (recovery and `summon doctor` share this rule). */
export function inspectLock(directory: string): LockState {
  let entries: string[];
  try { entries = readdirSync(directory); } catch (error) {
    if (code(error) === "ENOENT") return { kind: "absent" };
    throw error;
  }
  if (entries.length === 0) return { kind: "released" };
  const token = entries[0]!;
  const pid = entries.length === 1 ? Number(TOKEN_RE.exec(token)?.[1]) : NaN;
  if (!Number.isSafeInteger(pid)) return { kind: "unrecognized", entries };
  let ageMs: number;
  try { ageMs = Date.now() - lstatSync(join(directory, token)).mtimeMs; } catch (error) {
    if (code(error) === "ENOENT") return { kind: "absent" }; // released meanwhile
    throw error;
  }
  let alive = true;
  try { process.kill(pid, 0); } catch (error) {
    // Only ESRCH proves absence; EPERM may be a reused PID, which the age bound settles.
    alive = code(error) !== "ESRCH";
  }
  return { kind: !alive ? "dead" : ageMs > STALE_LOCK_MS ? "expired" : "live", pid, token, ageMs };
}

/** Remove a released, dead or expired lock (only its observed token); live and unrecognized locks stay. */
export function recoverStaleLock(directory: string): LockState {
  const state = inspectLock(directory);
  if (state.kind === "released") removeOwner(directory);
  else if (state.kind === "dead" || state.kind === "expired") removeOwner(directory, state.token);
  return state;
}

/** Remove this file's staging directories that killed acquirers left past STALE_LOCK_MS. They never block, so this is best effort. */
function sweepStaleStaging(file: string): void {
  const parent = dirname(file);
  const prefix = `${basename(file)}.lock-`;
  let names: string[];
  try { names = readdirSync(parent); } catch { return; }
  for (const name of names) {
    const token = name.startsWith(prefix) && name.endsWith(".tmp") ? name.slice(prefix.length, -".tmp".length) : "";
    if (!TOKEN_RE.test(token)) continue;
    const staging = join(parent, name);
    try {
      if (Date.now() - lstatSync(staging).mtimeMs > STALE_LOCK_MS) removeOwner(staging, token);
    } catch { /* vanished or not removable */ }
  }
}

/** Serialize synchronous read-modify-write transactions across processes, per file. */
export function withFileLock<T>(file: string, action: () => T, timeoutMs = 3000): T {
  const directory = `${file}.lock`;
  const token = `${process.pid}-${randomUUID()}.owner`;
  const staging = `${directory}-${token}.tmp`;
  let acquired = false;
  let stagingCreated = false;
  let result: T;
  try {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      // A waiter holds no staging directory while the canonical lock exists.
      if (!existsSync(directory)) {
        mkdirSync(staging, { mode: 0o700 });
        stagingCreated = true;
        writeFileSync(join(staging, token), "", { mode: 0o600, flag: "wx" });
        try {
          // Publish a NONEMPTY directory atomically. rename cannot replace another
          // nonempty owner, including one acquired during stale-owner recovery.
          renameSync(staging, directory);
          acquired = true;
          stagingCreated = false;
          break;
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes(code(error) ?? "")) throw error;
        }
        // Another process won publication. Dispose only our own attempt BEFORE
        // recovery or sleep, so interrupting a blocked waiter leaves no artifact.
        removeOwner(staging, token);
        stagingCreated = false;
      }
      recoverStaleLock(directory);
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for config lock: ${directory}. Retry after the other summon process finishes; summon doctor names a lock that stays.`);
      }
      Atomics.wait(pause, 0, 0, 10);
    }
    sweepStaleStaging(file);
    result = action();
  } catch (error) {
    // Preserve a transaction/acquisition error rather than masking it with cleanup.
    try {
      if (acquired) removeOwner(directory, token);
      else if (stagingCreated) removeOwner(staging, token);
    } catch { /* best effort */ }
    throw error;
  }
  removeOwner(directory, token);
  return result;
}
