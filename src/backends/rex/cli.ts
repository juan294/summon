import { existsSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCommand } from "../../utils.js";
import { isDisplaySafe } from "../../ui/sanitize.js";
import type { RexDiscovery } from "../../backend-detect.js";
import { classifyRexFailure } from "./errors.js";
import { asRecord, isKindId, rexOpTraits } from "./types.js";
import type { RexOp, RexRawResult, RexResult } from "./types.js";

const BUNDLE_RELATIVE_CLI = join("Contents", "Helpers", "Rex Server.rex", "Contents", "MacOS", "rex");
export const BUNDLE_NAMES = ["Rex Beta.app", "Rex.app"] as const;

/** Rex's default local API socket (`unix://` + percent-encoded path), as the app reports it. */
export function defaultRexServer(home: string = homedir()): string {
  return `unix://${encodeURI(join(home, "Library", "Application Support", "rex", "server.sock"))}`;
}

/** Candidate `rex` binaries after PATH, in search order. */
export function rexCandidatePaths(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const candidates: string[] = [];
  const binDir = env["REX_BIN_DIR"];
  if (binDir) candidates.push(join(binDir, "rex"));
  for (const bundle of BUNDLE_NAMES) candidates.push(join("/Applications", bundle, BUNDLE_RELATIVE_CLI));
  for (const bundle of BUNDLE_NAMES) candidates.push(join(home, "Applications", bundle, BUNDLE_RELATIVE_CLI));
  return candidates;
}

export type { RexDiscovery } from "../../backend-detect.js";

/**
 * Locate the `rex` CLI: PATH first (as Rex terminals prepend REX_BIN_DIR to it), then
 * REX_BIN_DIR itself, then the bundled helper inside the app bundles.
 */
export function discoverRex(env: NodeJS.ProcessEnv = process.env, candidates: string[] = rexCandidatePaths(env)): RexDiscovery {
  const searched = ["PATH"];
  const onPath = resolveCommand("rex");
  if (onPath) return { path: onPath, searched };
  for (const candidate of candidates) {
    searched.push(candidate);
    if (existsSync(candidate)) return { path: candidate, searched };
  }
  return { path: null, searched };
}

// --- Process adapter (plan §3 cli.ts, D5) ---

/** Grace added to Node's process timeout so Rex's own `--timeout` reports first when it can. */
export const REX_PROCESS_GRACE_MS = 2000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface RunRexOptions {
  binary: string;
  /** Explicit server endpoint; every call passes `-S` (plan P6). */
  server: string;
  /** JSON written to stdin (`api call METHOD -`). */
  input?: string;
  timeoutMs: number;
  autostart: boolean;
}

/** `execFileSync`'s shape, injectable for tests. */
export type RexExec = (file: string, args: string[], options: Parameters<typeof execFileSync>[2]) => string | Buffer;

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return "";
}

export function rawResult(partial: Partial<RexRawResult>): RexRawResult {
  return { code: null, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "", ...partial };
}

/** The global flags every call carries, then the op's own argv; whether its stdout is JSON. */
function rexArgs(op: RexOp, argv: readonly string[], opts: RunRexOptions, runner: string): { args: string[]; expectJson: boolean } {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1000) throw new Error(`${runner}: timeoutMs must be at least 1000 (got ${opts.timeoutMs})`);
  const seconds = Math.ceil(opts.timeoutMs / 1000);
  return {
    args: ["--color", "never", "--timeout", `${seconds}s`, `--autostart=${opts.autostart}`, "-S", opts.server, ...argv],
    expectJson: rexOpTraits(op).json === true || argv.includes("--json"),
  };
}

/** A completed call: its stdout, parsed when the op prints JSON (unparseable JSON is `malformed`). */
function completed(op: RexOp, stdout: string, expectJson: boolean): RexResult {
  if (!expectJson) return { ok: true, op, stdout };
  try {
    return { ok: true, op, stdout, json: JSON.parse(stdout) as unknown };
  } catch {
    return classifyRexFailure(op, rawResult({ code: 0, stdout, malformed: true }));
  }
}

/**
 * Run one Rex CLI operation through an argv array (never a shell). The global flags are
 * always `--color never --timeout <s>s --autostart=<bool> -S <server>`; JSON is parsed when
 * argv carries `--json` or the op always prints JSON. Every failure is classified.
 */
export function runRex(op: RexOp, argv: readonly string[], opts: RunRexOptions, exec: RexExec = execFileSync): RexResult {
  const { args, expectJson } = rexArgs(op, argv, opts, "runRex");
  const hasInput = opts.input !== undefined;

  let stdout: string;
  try {
    stdout = text(exec(opts.binary, args, {
      ...(hasInput ? { input: opts.input } : {}),
      encoding: "utf-8",
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: opts.timeoutMs + REX_PROCESS_GRACE_MS,
      killSignal: "SIGKILL",
      stdio: [hasInput ? "pipe" : "ignore", "pipe", "pipe"],
    }));
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException & { status?: number | null; signal?: string | null; stdout?: unknown; stderr?: unknown };
    return classifyRexFailure(op, rawResult({
      code: typeof error.status === "number" ? error.status : null,
      signal: error.signal ?? null,
      timedOut: error.code === "ETIMEDOUT",
      enoent: error.code === "ENOENT",
      stdout: text(error.stdout),
      stderr: text(error.stderr),
      ...(error.code === "ENOBUFS" ? { malformed: true } : {}),
    }));
  }
  return completed(op, stdout, expectJson);
}

/** Options of an asynchronous call: `runRex`'s, plus a signal that ends the call early (a shared deadline). */
export interface RunRexAsyncOptions extends RunRexOptions {
  signal?: AbortSignal;
}

/** `execFile`'s callback shape as a promise, injectable for tests. A rejection carries `execFile`'s error fields. */
export type RexExecAsync = (file: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal; input?: string }) => Promise<string>;

/** The process boundary of `runRexAsync`: argv only, stdin closed (or the input written), killed with SIGKILL. */
export const execRexAsync: RexExecAsync = (file, args, options) => new Promise((resolve, reject) => {
  const child = execFile(file, args, {
    encoding: "utf-8",
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: options.timeoutMs + REX_PROCESS_GRACE_MS,
    killSignal: "SIGKILL",
    ...(options.signal ? { signal: options.signal } : {}),
  }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve(stdout);
  });
  child.stdin?.on("error", () => { /* the child exited before reading stdin */ });
  child.stdin?.end(options.input);
});

/**
 * `runRex` without blocking the event loop, so independent reads run side by side (live ports). Same argv,
 * same classification; a call ended by `signal` is a timeout. `execFile` reports the exit status in `code`
 * and a timeout as a kill, where `execFileSync` uses `status` and `ETIMEDOUT`.
 */
export async function runRexAsync(op: RexOp, argv: readonly string[], opts: RunRexAsyncOptions, exec: RexExecAsync = execRexAsync): Promise<RexResult> {
  const { args, expectJson } = rexArgs(op, argv, opts, "runRexAsync");
  let stdout: string;
  try {
    stdout = await exec(opts.binary, args, {
      timeoutMs: opts.timeoutMs,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
  } catch (caught) {
    const error = caught as Error & { code?: unknown; killed?: boolean; signal?: string | null; stdout?: unknown; stderr?: unknown };
    const aborted = error.name === "AbortError" || error.code === "ABORT_ERR";
    return classifyRexFailure(op, rawResult({
      code: typeof error.code === "number" ? error.code : null,
      signal: aborted ? null : error.signal ?? null,
      timedOut: aborted || (error.killed === true && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"),
      enoent: error.code === "ENOENT",
      stdout: text(error.stdout),
      stderr: text(error.stderr),
      ...(error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? { malformed: true } : {}),
    }));
  }
  return completed(op, stdout, expectJson);
}

// --- Bound CLI handle and probes (Phase 3) ---

export interface RexCallOptions {
  input?: string;
  /** Defaults to the read-only budget (3 s). */
  timeoutMs?: number;
  /** Defaults to false: reads never start a server. */
  autostart?: boolean;
}

/** A `rex` binary bound to one server (plan P6: every call passes `-S` explicitly). */
export interface RexCli {
  binary: string;
  server: string;
  call(op: RexOp, argv: readonly string[], opts?: RexCallOptions): RexResult;
}

/**
 * Rex's own `--timeout` for reads (`ls`, `session.view`, `client.list`, block calls). A server that is
 * gone fails at once (connection refused), so this only bounds a server that is slow to answer: on a
 * loaded machine a `session.view` during a launch burst (four login shells starting) took more than
 * 3 s and read as "could not be verified" (rex-e2e guide, 2026-10-30), so the window is 8 s.
 */
export const REX_READ_TIMEOUT_MS = 8000;

export function createRexCli(binary: string, server: string, exec: RexExec = execFileSync): RexCli {
  return {
    binary,
    server,
    call(op, argv, opts = {}) {
      return runRex(op, argv, {
        binary,
        server,
        ...(opts.input !== undefined ? { input: opts.input } : {}),
        timeoutMs: opts.timeoutMs ?? REX_READ_TIMEOUT_MS,
        autostart: opts.autostart ?? false,
      }, exec);
    },
  };
}

/** Resolve a full block selector to the canonical session ID on this server. Scope the lookup
 * explicitly because recovery can run inside a different session. Rex preview.23 accepts the
 * same block ID as the session selector. Null means Rex confirmed the block is gone. An
 * unavailable server or an invalid response leaves the owner unknown (undefined).
 */
export function resolveBlockSession(cli: RexCli, blockId: string): string | null | undefined {
  if (!isKindId(blockId, "block")) return;
  const result = cli.call("block-inspect", ["block", "inspect", "-s", blockId, blockId, "--json"], { timeoutMs: 2000 });
  if (!result.ok) {
    // Older servers also return exit 3 when they reject a block as the session selector.
    return result.kind === "not-found" && result.reason.includes("no open block has ID") ? null : undefined;
  }
  const inspected = asRecord(result.json);
  const sessionId = inspected?.["session_id"];
  if (isKindId(sessionId, "session") && asRecord(inspected?.["block"])?.["block_id"] === blockId) return sessionId;
}

export type WhoamiProbe =
  | { answers: true; hostId: string; sessionId?: string }
  | { answers: false; reason: string };

/** Validation probes answer in milliseconds on a healthy server; a dead socket must not stall a Ghostty launch. */
export const WHOAMI_TIMEOUT_MS = 1000;

/** `whoami --json` on a bound CLI: the server's host id and, inside Rex, the caller's session. */
export function whoamiOf(cli: RexCli): WhoamiProbe {
  const result = cli.call("whoami", ["whoami", "--json"], { timeoutMs: WHOAMI_TIMEOUT_MS });
  if (!result.ok) return { answers: false, reason: result.reason };
  const json = result.json as Record<string, unknown> | null;
  const hostId = json && typeof json === "object" ? json["host_id"] : undefined;
  if (typeof hostId !== "string" || hostId === "") return { answers: false, reason: "rex whoami returned no host id" };
  if (!isDisplaySafe(hostId)) return { answers: false, reason: "rex whoami returned an unusable host id" };
  const sessionId = json!["session_id"];
  return { answers: true, hostId, ...(isDisplaySafe(sessionId) ? { sessionId } : {}) };
}

/**
 * `rex -S <server> --autostart=false whoami --json`: validates an inherited REX_SERVER for the
 * detection table (plan P5) and yields the server's host id.
 */
export function probeWhoami(binary: string, server: string, exec: RexExec = execFileSync): WhoamiProbe {
  return whoamiOf(createRexCli(binary, server, exec));
}
