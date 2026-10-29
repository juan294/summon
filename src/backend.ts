import { isGhosttyInstalled } from "./utils.js";
import { detectBackend, snapshotEnv } from "./backend-detect.js";
import type { Detection, RexDiscovery } from "./backend-detect.js";
import { discoverRex, defaultRexServer } from "./backends/rex/cli.js";
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
  /** Validates an inherited REX_SERVER. Phase 3 replaces the default with `rex whoami`. */
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
  return detectBackend({
    env: snapshotEnv(env),
    ghosttyInstalled: probes.ghosttyInstalled ?? isGhosttyInstalled,
    rex: () => (probes.discoverRex ?? discoverRex)(env),
    whoamiAnswers: probes.whoami ?? (() => false),
    defaultServer: probes.defaultServer ?? defaultRexServer(),
  });
}

/** Resolve the backend of an existing workspace from its record (plan P6). */
export function resolveBackendForRecord(record: Pick<WorkspaceStatus, "backend" | "rex">): { backend: BackendId; server?: string } {
  const backend = record.backend ?? "ghostty";
  if (backend === "rex" && record.rex?.server) return { backend, server: record.rex.server };
  return { backend };
}
