import { isGhosttyInstalled } from "./utils.js";
import { detectBackend, snapshotEnv } from "./backend-detect.js";
import type { Detection, RexDiscovery } from "./backend-detect.js";
// The backend id moved to backend-detect.ts (PE-L2); re-exported for the modules that import it from here.
export { isBackendId } from "./backend-detect.js";
export type { BackendId } from "./backend-detect.js";
import { discoverRex, defaultRexServer, probeWhoami } from "./backends/rex/cli.js";

/**
 * Ghostty-only launch keys (plan P8, UX-H1): a Rex launch honors none of them. Given on the command line, each is
 * named once ("Rex cannot honor <flag>; ignored"); from config they are Ghostty preferences, silent under Rex.
 */
export const REX_UNHONORED_FLAGS = ["maximize", "float", "fullscreen", "font-size", "clean"] as const;

/**
 * Config keys a Rex launch ignores, which doctor names once: the flags above, plus `new-window`. As a flag Rex
 * honors `--new-window` (a fresh session, see the P2 switch); a config `new-window=true` has no meaning under Rex.
 */
export const GHOSTTY_ONLY_CONFIG_KEYS = [...REX_UNHONORED_FLAGS, "new-window"] as const;

/** Resolved backend for a new launch (plan P5): the successful detection rows. */
export type LaunchContext = Extract<Detection, { ok: true }>;

/** Probes a caller can inject; every default queries the real machine. */
export interface BackendProbes {
  env?: NodeJS.ProcessEnv;
  ghosttyInstalled?: () => boolean;
  discoverRex?: (env: NodeJS.ProcessEnv) => RexDiscovery;
  /** Validates an inherited REX_SERVER; the default runs `rex -S <server> --autostart=false whoami --json`. */
  whoami?: (server: string) => boolean;
  defaultServer?: string;
}

/**
 * Resolve the backend for a new launch from the calling context (plan P5, §3 table).
 * Probes run only on the rows that need them. A failed detection is returned, not thrown,
 * so the caller decides (a dry run may continue; a real launch fails naming both terminals).
 */
export function resolveBackendForLaunch(probes: BackendProbes = {}): Detection {
  const env = probes.env ?? process.env;
  const discover = probes.discoverRex ?? discoverRex;
  let discovery: RexDiscovery | undefined;
  const rex = (): RexDiscovery => (discovery ??= discover(env));
  return detectBackend({
    env: snapshotEnv(env),
    ghosttyInstalled: probes.ghosttyInstalled ?? isGhosttyInstalled,
    rex,
    whoamiAnswers: probes.whoami ?? ((server) => {
      const binary = rex().path;
      return binary !== null && probeWhoami(binary, server).answers;
    }),
    defaultServer: probes.defaultServer ?? defaultRexServer(),
  });
}

/** The caller's own Rex session (P7 app preference): `REX_SESSION` only when Summon runs inside Rex. */
export function callerRexSession(context: Pick<LaunchContext, "placement">): string | undefined {
  return context.placement === "inside-rex" ? process.env["REX_SESSION"] : undefined;
}
