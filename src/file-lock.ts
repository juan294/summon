import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

const pause = new Int32Array(new SharedArrayBuffer(4));

/**
 * BE-L2: an owner token older than this is stale whatever the PID probe says (a reused PID, or
 * EPERM). A token dated this far in the future (the clock jumped back) is stale too. Every critical
 * section is local I/O on one small file (a key=value config file, a status record, the trust DB),
 * idempotent side-file removal and at most a warning written to stderr: no subprocess, network or
 * git call runs under the lock, so a transaction takes milliseconds and a waiter gives up after 3 s.
 * One minute is 20 times that wait. Only an owner suspended mid-transaction (Ctrl-Z, system sleep)
 * for a minute could lose the lock.
 */
export const STALE_LOCK_MS = 60_000;

const TOKEN_RE = /^([1-9]\d*)-[0-9a-f-]{36}\.owner$/;

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** Remove only the observed owner's token; a replacement owner keeps the directory nonempty. True when the directory is gone. */
function removeOwner(directory: string, token?: string): boolean {
  if (token) {
    try { unlinkSync(join(directory, token)); } catch (error) {
      if (code(error) !== "ENOENT") throw error;
    }
  }
  try { rmdirSync(directory); } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(code(error) ?? "")) throw error;
    return code(error) === "ENOENT";
  }
  return true;
}

export type LockState =
  | { kind: "absent" }
  /** Empty: an interrupted release. */
  | { kind: "released" }
  /** Not exactly one well-formed owner token: never removed automatically. */
  | { kind: "unrecognized"; entries: string[] }
  /** `live` within STALE_LOCK_MS, `dead` once the PID is proven absent, `expired` past the bound. */
  | { kind: "live" | "dead" | "expired"; pid: number; token: string; ageMs: number };

/** Why a lock is in its state, for diagnostics (raw entry names: escape before printing). */
export function describeLock(state: LockState): string {
  switch (state.kind) {
    case "absent": return "no lock";
    case "released": return "interrupted release";
    case "unrecognized": return state.entries.join(", ");
    case "live": return `held by process ${state.pid}`;
    case "dead": return `owner process ${state.pid} is gone`;
    case "expired": {
      const seconds = Math.round(Math.abs(state.ageMs) / 1000);
      return state.ageMs >= 0 ? `owner token is ${seconds} s old` : `owner token is dated ${seconds} s in the future`;
    }
  }
}

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
  return { kind: !alive ? "dead" : Math.abs(ageMs) > STALE_LOCK_MS ? "expired" : "live", pid, token, ageMs };
}

/** Remove a released, dead or expired lock (only its observed token); live and unrecognized locks stay. `removed`: this call removed the directory. */
export function recoverStaleLock(directory: string): { state: LockState; removed: boolean } {
  const state = inspectLock(directory);
  if (state.kind === "released") return { state, removed: removeOwner(directory) };
  if (state.kind === "dead" || state.kind === "expired") return { state, removed: removeOwner(directory, state.token) };
  return { state, removed: false };
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

/** The lock directory, this attempt's owner token and its staging directory for `file`. */
interface LockAttempt {
  directory: string;
  token: string;
  staging: string;
  acquired: boolean;
  stagingCreated: boolean;
}

function newAttempt(file: string): LockAttempt {
  const directory = `${file}.lock`;
  const token = `${process.pid}-${randomUUID()}.owner`;
  return { directory, token, staging: `${directory}-${token}.tmp`, acquired: false, stagingCreated: false };
}

/** One acquisition step: true when this attempt published the lock; otherwise any stale owner is recovered. */
function tryAcquire(attempt: LockAttempt): boolean {
  const { directory, token, staging } = attempt;
  // A waiter holds no staging directory while the canonical lock exists.
  if (!existsSync(directory)) {
    mkdirSync(staging, { mode: 0o700 });
    attempt.stagingCreated = true;
    writeFileSync(join(staging, token), "", { mode: 0o600, flag: "wx" });
    try {
      // Publish a NONEMPTY directory atomically. rename cannot replace another
      // nonempty owner, including one acquired during stale-owner recovery.
      renameSync(staging, directory);
      attempt.acquired = true;
      attempt.stagingCreated = false;
      return true;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(code(error) ?? "")) throw error;
    }
    // Another process won publication. Dispose only our own attempt BEFORE
    // recovery or sleep, so interrupting a blocked waiter leaves no artifact.
    removeOwner(staging, token);
    attempt.stagingCreated = false;
  }
  recoverStaleLock(directory);
  return false;
}

/** After an acquisition or transaction error: remove what this attempt holds, never masking the error. */
function abandon(attempt: LockAttempt): void {
  try {
    if (attempt.acquired) removeOwner(attempt.directory, attempt.token);
    else if (attempt.stagingCreated) removeOwner(attempt.staging, attempt.token);
  } catch { /* best effort */ }
}

function release(file: string, attempt: LockAttempt): void {
  removeOwner(attempt.directory, attempt.token);
  sweepStaleStaging(file);
}

/** Serialize synchronous read-modify-write transactions across processes, per file. */
export function withFileLock<T>(file: string, action: () => T, timeoutMs = 3000): T {
  const attempt = newAttempt(file);
  let result: T;
  try {
    const deadline = performance.now() + timeoutMs;
    while (!tryAcquire(attempt)) {
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for config lock: ${attempt.directory}. Retry after the other summon process finishes; summon doctor names a lock that stays.`);
      }
      Atomics.wait(pause, 0, 0, 10);
    }
    result = action();
  } catch (error) {
    // Preserve a transaction/acquisition error rather than masking it with cleanup.
    abandon(attempt);
    throw error;
  }
  release(file, attempt);
  return result;
}

export interface AsyncLockOptions {
  /** Give up after this long; it should exceed STALE_LOCK_MS so a hung owner is recovered before a waiter gives up. */
  timeoutMs: number;
  /** The error message when the wait times out. */
  timeoutMessage: string;
  /** Called once, when the first attempt finds the lock held. */
  onWait?: () => void;
  /** Pause between attempts (default 50 ms); the event loop keeps running meanwhile. */
  pollMs?: number;
}

/**
 * `withFileLock` for an asynchronous transaction that may run subprocesses (BE-L1: a Rex launch from its decision to
 * its publication). Same lock directory protocol, owner tokens and stale/dead-owner recovery; the wait does not block
 * the event loop. A transaction longer than STALE_LOCK_MS can be taken over by a waiter, which then runs unserialized.
 */
export async function withFileLockAsync<T>(file: string, action: () => Promise<T>, options: AsyncLockOptions): Promise<T> {
  const attempt = newAttempt(file);
  let result: T;
  try {
    const deadline = performance.now() + options.timeoutMs;
    let waiting = false;
    while (!tryAcquire(attempt)) {
      if (performance.now() >= deadline) throw new Error(options.timeoutMessage);
      if (!waiting) {
        waiting = true;
        options.onWait?.();
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 50));
    }
    result = await action();
  } catch (error) {
    abandon(attempt);
    throw error;
  }
  release(file, attempt);
  return result;
}
