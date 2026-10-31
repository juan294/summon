/**
 * Pure backend detection table (plan §3 "Detection table", P5).
 * No filesystem or process access: every input is injected so each row is a unit test.
 */

export type Placement = "inside-rex" | "outside";

export interface EnvSnapshot {
  termProgram?: string;
  rexServer?: string;
  rexSession?: string;
  rexBlock?: string;
}

export interface RexDiscovery {
  /** Resolved binary, or null when none of the searched locations has one. */
  path: string | null;
  /** Every location consulted, in order ("PATH" first). */
  searched: string[];
}

/** Probes are thunks: the table calls each one only on the rows that need its answer. */
export interface DetectionInputs {
  env: EnvSnapshot;
  ghosttyInstalled: () => boolean;
  /** Locates the `rex` binary (PATH, then bundles). */
  rex: () => RexDiscovery;
  /** Whether `rex -S <server> whoami` answers; consulted only when TERM_PROGRAM is absent and REX_SERVER is set. */
  whoamiAnswers: (server: string) => boolean;
  /** Default server socket used when no validated REX_SERVER applies. */
  defaultServer: string;
}

export type Detection =
  | { ok: true; backend: "ghostty"; placement: Placement; notices: string[] }
  | { ok: true; backend: "rex"; placement: Placement; server: string; rexBinary: string; notices: string[] }
  | { ok: false; reason: string; notices: string[] };

export const NEITHER_TERMINAL_MSG = "Neither Ghostty.app nor the Rex CLI was found. Install Ghostty (https://ghostty.org) or Rex and retry.";

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

/** Read the detection-relevant variables from a process environment. */
export function snapshotEnv(env: NodeJS.ProcessEnv): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  const termProgram = nonEmpty(env["TERM_PROGRAM"]);
  const rexServer = nonEmpty(env["REX_SERVER"]);
  const rexSession = nonEmpty(env["REX_SESSION"]);
  const rexBlock = nonEmpty(env["REX_BLOCK"]);
  if (termProgram !== undefined) snapshot.termProgram = termProgram;
  if (rexServer !== undefined) snapshot.rexServer = rexServer;
  if (rexSession !== undefined) snapshot.rexSession = rexSession;
  if (rexBlock !== undefined) snapshot.rexBlock = rexBlock;
  return snapshot;
}

/** Fallback used by every row where the terminal running Summon does not decide: Ghostty, then Rex, then fail. */
function installedRules(inputs: DetectionInputs, placement: Placement, notices: string[]): Detection {
  if (inputs.ghosttyInstalled()) return { ok: true, backend: "ghostty", placement, notices };
  const rexBinary = inputs.rex().path;
  if (rexBinary) return { ok: true, backend: "rex", placement, server: inputs.defaultServer, rexBinary, notices };
  return { ok: false, reason: NEITHER_TERMINAL_MSG, notices };
}

export function detectBackend(inputs: DetectionInputs): Detection {
  const { env } = inputs;
  const notices: string[] = [];

  if (env.termProgram === "rex") {
    const rex = inputs.rex();
    if (rex.path) {
      return { ok: true, backend: "rex", placement: "inside-rex", server: env.rexServer ?? inputs.defaultServer, rexBinary: rex.path, notices };
    }
    notices.push(`Rex detected but its CLI was not found at ${rex.searched.join(", ")}`);
    if (inputs.ghosttyInstalled()) return { ok: true, backend: "ghostty", placement: "inside-rex", notices };
    return { ok: false, reason: NEITHER_TERMINAL_MSG, notices };
  }

  if (env.termProgram === "ghostty") {
    // Inherited REX_* variables are ignored: the terminal running Summon decides.
    return { ok: true, backend: "ghostty", placement: "outside", notices };
  }

  if (env.termProgram !== undefined) {
    // Another terminal (iTerm, Apple Terminal, VS Code, ...): REX_SERVER is ignored.
    return installedRules(inputs, "outside", notices);
  }

  // TERM_PROGRAM absent: a validated REX_SERVER is the only inherited value that counts.
  if (env.rexServer !== undefined) {
    const rexBinary = inputs.rex().path;
    if (rexBinary && inputs.whoamiAnswers(env.rexServer)) {
      return { ok: true, backend: "rex", placement: "outside", server: env.rexServer, rexBinary, notices };
    }
  }
  return installedRules(inputs, "outside", notices);
}
