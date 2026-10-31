import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { listAppClients } from "../backends/rex/app.js";
import { createRexCli, defaultRexServer, discoverRex, probeWhoami } from "../backends/rex/cli.js";
import type { RexCli } from "../backends/rex/cli.js";
import { listSessions } from "../backends/rex/status.js";
import { STATUS_DIR } from "../paths.js";

/**
 * Gating shared by the Rex end-to-end suites (plan §5):
 *   SUMMON_REX_E2E=1           run; skip with a printed reason when a prerequisite is missing
 *   SUMMON_REX_E2E_REQUIRED=1  run; a missing prerequisite is a failure (phase acceptance mode)
 * Excluded from coverage: it runs only against a real Rex.
 */

export type RexMode = "off" | "advisory" | "required";

export function resolveRexMode(env: NodeJS.ProcessEnv): RexMode {
  return env.SUMMON_REX_E2E_REQUIRED ? "required" : env.SUMMON_REX_E2E ? "advisory" : "off";
}

const REX_PROCESS_NAMES = ["Rex Beta", "Rex"];

function systemEvents(script: string): string {
  return execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10_000 }).trim();
}

/** Windows of the running Rex app, read through System Events (read-only; needs Accessibility for this terminal). */
export function rexWindowCount(): { process: string; count: number } {
  let lastError = "";
  for (const name of REX_PROCESS_NAMES) {
    try {
      const count = Number.parseInt(systemEvents(`tell application "System Events" to count windows of process "${name}"`), 10);
      if (Number.isInteger(count)) return { process: name, count };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`System Events could not read the Rex windows (Accessibility for this terminal?): ${lastError}`);
}

/** `<short sha>` of HEAD, with `+dirty` when tracked files differ: the identity of the tree a log belongs to. */
export function treeIdentity(): string {
  const root = new URL("../../", import.meta.url);
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10_000 }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", timeout: 10_000 }).trim() !== "";
    return dirty ? `${sha}+dirty` : sha;
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : String(error)})`;
  }
}

export interface RexPrerequisites {
  /** The app must have a window open: `focus`, `open` and a launch's selection act in a window (guide §4 F8). */
  window?: boolean;
}

/** The first missing prerequisite, or null when a Rex server and an app client answer (and a window is open when asked). */
export function rexPrerequisiteFailure(needs: RexPrerequisites = {}): string | null {
  const binary = discoverRex().path;
  if (!binary) return "rex CLI not found";
  const who = probeWhoami(binary, defaultRexServer());
  if (!who.answers) return `Rex server not reachable: ${who.reason}`;
  const clients = listAppClients(createRexCli(binary, defaultRexServer()));
  if (!clients.ok || clients.clients.length === 0) return "no Rex app client connected";
  if (needs.window) {
    let windows: { process: string; count: number };
    try {
      windows = rexWindowCount();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (windows.count === 0) return `${windows.process} has no window open (focus, open and a launch's selection act in a window; open one with Cmd-N)`;
  }
  return null;
}

export interface RexGate {
  mode: RexMode;
  prereq: string | null;
  /** Repo convention: skip inside the test; fail loudly in required mode. Returns true when the test may run. */
  gate(ctx: { skip: (reason?: string) => void }): boolean;
}

export function rexGate(env: NodeJS.ProcessEnv = process.env, suite = "rex e2e", needs: RexPrerequisites = {}): RexGate {
  const mode = resolveRexMode(env);
  const prereq = mode === "off" ? "SUMMON_REX_E2E not set" : rexPrerequisiteFailure(needs);
  if (prereq && mode !== "required") console.log(`${suite} skipped: ${prereq}`);
  // The log names the tree under test and the machine load (under heavy concurrent load the server's first
  // view of a session being created has been seen to stall past Summon's read timeout, which reads as
  // `unknown`, guide §1). Written to stdout directly: vitest shows buffered console output only for failures.
  if (mode !== "off") process.stdout.write(`${suite}: tree ${treeIdentity()}; load average ${loadavg().map((n) => n.toFixed(2)).join(" ")}\n`);
  return {
    mode,
    prereq,
    gate(ctx) {
      if (mode === "off") { ctx.skip("SUMMON_REX_E2E not set"); return false; }
      if (prereq && mode !== "required") { ctx.skip(prereq); return false; }
      if (prereq) throw new Error(`BLOCKED (SUMMON_REX_E2E_REQUIRED): ${prereq}`);
      return true;
    },
  };
}

/** Best-effort removal of a suite's status record and legacy liveness files. */
export function removeStatusFiles(project: string): void {
  for (const ext of ["json", "active", "pid"]) rmSync(join(STATUS_DIR, `${project}.${ext}`), { force: true });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `read` every 250 ms until it yields a value; throws naming `what` at the deadline. */
export async function until<T>(read: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** Run `fn` with the environment a launch inside a Rex terminal sees, then restore every variable. */
export async function withRexEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  try {
    process.env.TERM_PROGRAM = "rex";
    delete process.env.REX_SESSION;
    delete process.env.REX_BLOCK;
    delete process.env.REX_SERVER;
    delete process.env.SUMMON_WORKSPACE;
    process.env.SHELL = "/bin/zsh";
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

/**
 * Kill the sessions a suite created and prove they are gone. The proof is the absence: a session still
 * listed at the deadline, or a listing that did not answer, is a failure (one line each); a kill the
 * server rejected or did not answer in time counts only while its session is still listed (a kill that
 * timed out after doing its work is reported as a note on the console, not as a failure).
 */
export async function destroySessions(cli: RexCli, sessionIds: readonly string[], timeoutMs = 5000): Promise<string[]> {
  const ids = [...new Set(sessionIds)];
  const killFailures = new Map<string, string>();
  for (const sessionId of ids) {
    const killed = cli.call("kill", ["kill", sessionId]);
    if (!killed.ok && killed.kind !== "not-found") killFailures.set(sessionId, killed.reason);
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const listed = listSessions(cli);
    if (!listed.ok) return [`session list unavailable (${listed.reason}); the sessions may remain: ${ids.join(", ")}`];
    const remaining = ids.filter((id) => listed.sessions.some((s) => s.sessionId === id));
    if (remaining.length === 0) {
      for (const [id, reason] of killFailures) console.warn(`rex kill ${id} did not answer (${reason}), but the session is gone`);
      return [];
    }
    if (Date.now() > deadline) {
      return remaining.map((id) => `still listed after ${timeoutMs} ms: ${id}${killFailures.has(id) ? ` (rex kill: ${killFailures.get(id)})` : ""}`);
    }
    await sleep(250);
  }
}
