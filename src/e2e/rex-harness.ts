import { listAppClients } from "../backends/rex/app.js";
import { createRexCli, defaultRexServer, discoverRex, probeWhoami } from "../backends/rex/cli.js";

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

/** The first missing prerequisite, or null when a Rex server and an app client answer. */
export function rexPrerequisiteFailure(): string | null {
  const binary = discoverRex().path;
  if (!binary) return "rex CLI not found";
  const who = probeWhoami(binary, defaultRexServer());
  if (!who.answers) return `Rex server not reachable: ${who.reason}`;
  const clients = listAppClients(createRexCli(binary, defaultRexServer()));
  if (!clients.ok || clients.clients.length === 0) return "no Rex app client connected";
  return null;
}

export interface RexGate {
  mode: RexMode;
  prereq: string | null;
  /** Repo convention: skip inside the test; fail loudly in required mode. Returns true when the test may run. */
  gate(ctx: { skip: (reason?: string) => void }): boolean;
}

export function rexGate(env: NodeJS.ProcessEnv = process.env, suite = "rex e2e"): RexGate {
  const mode = resolveRexMode(env);
  const prereq = mode === "off" ? "SUMMON_REX_E2E not set" : rexPrerequisiteFailure();
  if (prereq && mode !== "required") console.log(`${suite} skipped: ${prereq}`);
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
