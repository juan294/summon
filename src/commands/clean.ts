import { existsSync, readdirSync } from "node:fs";
import type { CommandContext } from "./types.js";
import { fail, note, out } from "../ui/output.js";
import { projectArgOrExit } from "../validation.js";
import { launchLiveness, readStatusRecord, unlinkIgnoringMissing } from "../status-record.js";
import { SESSION_GONE, endRexLaunch, requireRexBinary, unverifiedMessage } from "../status.js";
import { createRexCli } from "../backends/rex/cli.js";
import { listSessions, sessionState, viewBlockIds, viewSession } from "../backends/rex/status.js";
import type { SessionListing, SessionView } from "../backends/rex/status.js";
import { adoptDeps, adoptOrphans, readPaneFile, readPaneMapping, removeOrphanLaunch } from "../backends/rex/launch.js";
import { isLaunchId, launchArtifactFiles, launchArtifactPaths, launchFileList, launchesDir, listLaunchManifests } from "../launch-identity.js";
import type { LaunchManifest } from "../launch-identity.js";
import type { RexIdentity } from "../backends/rex/types.js";

/**
 * `summon clean <project>` (plan P17): destroy the recorded Rex session only when Summon's own
 * check shows it empty, then run the same ordered end-of-launch steps as reconciliation.
 * `--orphans`: review every other launch of the project (P13 late adoption in command form).
 */

const LIMITATION = "Rex has no conditional destroy: anything added to it after the check was closed with it.";

/** Ghostty per-launch files of launches other than the current one whose shell is proven dead (its pid, not its marker). */
function sweepDeadGhosttyLaunches(project: string, currentLaunchId: string | undefined): number {
  let names: string[];
  try {
    names = readdirSync(launchesDir(project));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const match = /^(.+)\.pid$/.exec(name);
    if (!match || !isLaunchId(match[1]) || match[1] === currentLaunchId) continue;
    const launchId = match[1];
    const paths = launchArtifactPaths(project, launchId);
    if (existsSync(paths.manifest)) continue; // a Rex launch: handled by adoption
    if (launchLiveness(project, launchId) !== "dead") continue;
    if (unlinkIgnoringMissing(paths.pid) && unlinkIgnoringMissing(paths.active)) removed += 1;
  }
  return removed;
}

function liveNames(identity: RexIdentity, view: SessionView): { recorded: string[]; unrecorded: number } {
  const present = viewBlockIds(view);
  const recorded = identity.blocks.filter((b) => present.has(b.blockId)).map((b) => b.name);
  return { recorded, unrecorded: present.size - recorded.length };
}

function refuseLive(project: string, sessionId: string, names: { recorded: string[]; unrecorded: number }): never {
  const parts: string[] = [];
  if (names.recorded.length > 0) parts.push(names.recorded.join(", "));
  if (names.unrecorded > 0) parts.push(`${names.unrecorded} unrecorded block${names.unrecorded === 1 ? "" : "s"}`);
  fail(`[${project}] still has live panes (${parts.join("; ")}); not cleaned. Close them or run rex kill ${sessionId} yourself.`);
  process.exit(2);
}

async function cleanCurrent(project: string): Promise<void> {
  const record = readStatusRecord(project);
  if (!record) {
    fail(`[${project}] has no workspace record; nothing to clean.`);
    process.exit(2);
  }
  const swept = sweepDeadGhosttyLaunches(project, record.launchId);
  const sweptNote = swept > 0 ? ` ${swept} stale launch file pair${swept === 1 ? "" : "s"} removed.` : "";
  if (record.backend !== "rex" || !record.rex) {
    out(`[${project}] is a Ghostty workspace; nothing to close.${sweptNote}`);
    return;
  }
  const identity = record.rex;
  const cli = createRexCli(requireRexBinary(), identity.server);
  const state = sessionState(cli, identity, project);
  if (state.state === "unknown") {
    fail(unverifiedMessage(project, state.reason));
    process.exit(2);
  }
  if (state.reason === SESSION_GONE) {
    const notice = endRexLaunch(project, record, { confirmedGone: true });
    out(`Rex session for [${project}] is already gone; nothing to close.${sweptNote}`);
    if (notice) note(notice);
    return;
  }
  // The state probe is Summon's own check; one more `session.view` immediately before the destroy
  // names the live panes for a refusal or confirms the session is still empty (P17: small window, not zero).
  const recheck = viewSession(cli, identity.sessionId);
  if (!recheck.ok) {
    fail(unverifiedMessage(project, recheck.reason));
    process.exit(2);
  }
  const names = liveNames(identity, recheck.view);
  if (names.recorded.length > 0 || names.unrecorded > 0) refuseLive(project, identity.sessionId, names);
  if (!state.reason?.startsWith("empty Rex session")) {
    // The probe saw panes that closed before the recheck: not cleaned on this run; the next run sees an empty session.
    fail(`[${project}] was not empty when checked (${state.reason ?? state.state}); run summon clean ${project} again.`);
    process.exit(2);
  }
  const killed = cli.call("kill", ["kill", identity.sessionId], { timeoutMs: 10_000 });
  if (!killed.ok) {
    fail(`could not close Rex session ${identity.sessionId}: ${killed.reason}`);
    process.exit(2);
  }
  const notice = endRexLaunch(project, record, { confirmedGone: true, label: "session closed" });
  out(`Closed empty Rex session [${project}] (${identity.sessionId}). ${LIMITATION}${sweptNote}`);
  if (notice) note(notice);
}

/** `--orphans`: what to say and do about one launch that is not the current record's (one `ls` per server). */
function reviewOrphan(project: string, manifest: LaunchManifest, gen: string | null, binary: string, listings: Map<string, SessionListing>): string {
  const id = manifest.launchId;
  const paths = launchArtifactPaths(project, id);
  const rootName = manifest.paneOrder[0];
  const root = rootName === undefined ? "malformed" : readPaneFile(paths.pane(rootName).file);
  const where = `launch ${id} of [${project}] (started ${manifest.startedAt}, server ${manifest.server ?? "none"})`;
  if (root === "absent" || root === "malformed" || readPaneMapping(manifest, root.sessionId).malformed.length > 0) {
    const files = launchArtifactFiles(project, id, manifest.paneOrder);
    const present = launchFileList(files).filter((file) => existsSync(file));
    return `${where}: ${root === "absent" ? "never confirmed its session" : "has an unreadable pane file"}; left in place as evidence. Remove it with:\n  rm -f ${present.map((file) => JSON.stringify(file)).join(" ")}`;
  }
  if (!manifest.server) return `${where}: manifest names no server; left in place.`;
  const cli = createRexCli(binary, manifest.server);
  let listed = listings.get(manifest.server);
  if (!listed) {
    listed = listSessions(cli);
    listings.set(manifest.server, listed);
  }
  if (!listed.ok) return `${where}: server unreachable (${listed.reason}); left in place.`;
  const removed = (done: string): string => {
    const removal = removeOrphanLaunch(project, gen, manifest);
    if (removal.outcome === "superseded") return `${where}: ${done}; the current record is not this launch's, files left in place.`;
    if (removal.failures.length > 0) return `${where}: ${done}; a file could not be removed (${removal.failures[0]}); the manifest is kept, run summon clean --orphans again.`;
    return `${where}: ${done}; files removed.`;
  };
  if (!listed.sessions.some((s) => s.sessionId === root.sessionId)) return removed("its Rex session is gone");
  const viewed = viewSession(cli, root.sessionId);
  if (!viewed.ok) return viewed.kind === "not-found" ? removed("its Rex session is gone") : `${where}: session could not be read (${viewed.reason}); left in place.`;
  const blocks = viewBlockIds(viewed.view).size;
  if (blocks > 0) return `${where}: Rex session ${root.sessionId} still has ${blocks} block${blocks === 1 ? "" : "s"}; close it yourself with: rex -S ${manifest.server} kill ${root.sessionId}`;
  const killed = cli.call("kill", ["kill", root.sessionId], { timeoutMs: 10_000 });
  if (!killed.ok) return `${where}: could not close its empty Rex session ${root.sessionId} (${killed.reason}); left in place.`;
  return `${removed(`closed its empty Rex session ${root.sessionId}`)} ${LIMITATION}`;
}

async function cleanOrphans(project: string): Promise<void> {
  const binary = requireRexBinary();
  const current = readStatusRecord(project);
  if (current && !current.launchId) {
    note(`${project} has a record from an older Summon; run summon ${project} to replace it, then review its launches`);
    return;
  }
  for (const line of adoptOrphans(project, adoptDeps(binary))) note(line);
  const gen = readStatusRecord(project)?.launchId ?? null;
  const swept = sweepDeadGhosttyLaunches(project, gen ?? undefined);
  if (swept > 0) out(`${swept} stale Ghostty launch file pair${swept === 1 ? "" : "s"} of [${project}] removed.`);
  const listings = new Map<string, SessionListing>();
  let reviewed = 0;
  for (const manifest of listLaunchManifests(project)) {
    if (manifest.launchId === gen) continue;
    reviewed += 1;
    out(reviewOrphan(project, manifest, gen, binary, listings));
  }
  if (reviewed === 0 && swept === 0) out(`No earlier launches of [${project}] to review.`);
}

export async function handleCleanCommand({ args, values }: CommandContext): Promise<void> {
  const project = projectArgOrExit(args, 1, "Usage: summon clean <project> [--orphans]");
  if (values.orphans) await cleanOrphans(project);
  else await cleanCurrent(project);
}
