import { isGhosttyInstalled } from "./utils.js";
import { detectBackend, snapshotEnv } from "./backend-detect.js";
import type { Detection, RexDiscovery } from "./backend-detect.js";
import { discoverRex, defaultRexServer, probeWhoami } from "./backends/rex/cli.js";
import type { WorkspaceStatus } from "./status.js";

/** Terminal backend that owns a workspace. Records without the field are Ghostty. */
export type BackendId = "ghostty" | "rex";

export function isBackendId(value: unknown): value is BackendId {
  return value === "ghostty" || value === "rex";
}

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

/** Resolve the backend of an existing workspace from its record (plan P6). */
export function resolveBackendForRecord(record: Pick<WorkspaceStatus, "backend" | "rex">): { backend: BackendId; server?: string } {
  const backend = record.backend ?? "ghostty";
  if (backend === "rex" && record.rex?.server) return { backend, server: record.rex.server };
  return { backend };
}
