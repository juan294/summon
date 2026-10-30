import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCommand } from "../../utils.js";
import type { RexDiscovery } from "../../backend-detect.js";
import { classifyRexFailure } from "./errors.js";
import { rexOpTraits } from "./types.js";
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

/**
 * Run one Rex CLI operation through an argv array (never a shell). The global flags are
 * always `--color never --timeout <s>s --autostart=<bool> -S <server>`; JSON is parsed when
 * argv carries `--json` or the op always prints JSON. Every failure is classified.
 */
export function runRex(op: RexOp, argv: readonly string[], opts: RunRexOptions, exec: RexExec = execFileSync): RexResult {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1000) throw new Error(`runRex: timeoutMs must be at least 1000 (got ${opts.timeoutMs})`);
  const seconds = Math.ceil(opts.timeoutMs / 1000);
  const args = ["--color", "never", "--timeout", `${seconds}s`, `--autostart=${opts.autostart}`, "-S", opts.server, ...argv];
  const expectJson = rexOpTraits(op).json === true || argv.includes("--json");
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

  if (!expectJson) return { ok: true, op, stdout };
  try {
    return { ok: true, op, stdout, json: JSON.parse(stdout) as unknown };
  } catch {
    return classifyRexFailure(op, rawResult({ code: 0, stdout, malformed: true }));
  }
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
  const sessionId = json!["session_id"];
  return { answers: true, hostId, ...(typeof sessionId === "string" ? { sessionId } : {}) };
}

/**
 * `rex -S <server> --autostart=false whoami --json`: validates an inherited REX_SERVER for the
 * detection table (plan P5) and yields the server's host id.
 */
export function probeWhoami(binary: string, server: string, exec: RexExec = execFileSync): WhoamiProbe {
  return whoamiOf(createRexCli(binary, server, exec));
}
