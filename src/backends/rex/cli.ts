import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCommand } from "../../utils.js";
import type { RexDiscovery } from "../../backend-detect.js";

const BUNDLE_RELATIVE_CLI = join("Contents", "Helpers", "Rex Server.rex", "Contents", "MacOS", "rex");
const BUNDLE_NAMES = ["Rex Beta.app", "Rex.app"] as const;

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
