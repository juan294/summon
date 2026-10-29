import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const pause = new Int32Array(new SharedArrayBuffer(4));

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

function recoverDeadOwner(directory: string): void {
  let tokens: string[];
  try { tokens = readdirSync(directory); } catch (error) {
    if (code(error) === "ENOENT") return;
    throw error;
  }
  // Empty means an interrupted release. Unknown/corrupt ownership fails closed.
  if (tokens.length === 0) return removeOwner(directory);
  if (tokens.length !== 1) return;
  const token = tokens[0]!;
  const match = /^([1-9]\d*)-[0-9a-f-]{36}\.owner$/.exec(token);
  if (!match) return;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid)) return;
  try { process.kill(pid, 0); } catch (error) {
    // EPERM and PID reuse are treated as live; only proven absent processes qualify.
    if (code(error) === "ESRCH") removeOwner(directory, token);
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
      recoverDeadOwner(directory);
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for config lock: ${directory}. Retry after the other summon process finishes; an unrecognized lock requires inspection.`);
      }
      Atomics.wait(pause, 0, 0, 10);
    }
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
