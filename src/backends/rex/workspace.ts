/**
 * Rex record port (AR-M1): what Summon does with a recorded Rex workspace. State comes from the server
 * (`backends/rex/read.ts`, reached through backends/read.ts); focus, inspect and title pass the shared pre-flight first (plan P10); `summon clean`
 * closes an empty session (P17) and reviews earlier launches (P13 in command form).
 */
import { existsSync } from "node:fs";
import { createRexCli } from "./cli.js";
import { SESSION_GONE, focusRex, inspectRex, sessionListings, sessionState, titleRex, viewBlockIds, viewSession } from "./status.js";
import type { SessionListings, SessionView } from "./status.js";
import type { RexIdentity } from "./types.js";
import { adoptDeps, adoptOrphans, readPaneFile, readPaneMapping, removeOrphanLaunch, strandedTokenNotice, withRecoveryCommand } from "./launch.js";
import { endRexLaunch } from "./reconcile.js";
import { requireRexBinary, rexBinaryPath, rexCommandGate } from "./read.js";
import type { RexCommandGate } from "./read.js";
import { isLiveState, unverifiedMessage } from "../../status-record.js";
import { launchArtifactFiles, launchArtifactPaths, launchFileList, listLaunchManifests } from "../../launch-identity.js";
import type { LaunchManifest } from "../../launch-identity.js";
import type { ResolvedStatus } from "../../status.js";
import { escapeControlChars } from "../../ui/sanitize.js";
import { shellQuote } from "../../shell-escape.js";
import { fail, note, out } from "../../ui/output.js";
import type { WorkspaceBackend } from "../port.js";

const LIMITATION = "Rex has no conditional destroy: anything added to it after the check was closed with it.";

/** The pre-flight for a Rex status (the record port is chosen from a Rex record, so a status is always present). */
function gateOf(project: string, status: ResolvedStatus | null): RexCommandGate {
  if (!status) return { ok: false, failure: { kind: "unavailable", code: "missing", reason: unverifiedMessage(project, "nothing is recorded") } };
  return rexCommandGate(project, status);
}

/** `summon inspect` for a Rex record: block ids instead of terminal ids; the tty is never available. */
function inspectRexWorkspace(project: string, status: ResolvedStatus | null, json: boolean): void {
  const gate = gateOf(project, status);
  const inspected = gate.ok
    ? inspectRex(gate.cli, gate.identity, status?.panes ?? [], project, gate.liveBlocks)
    : { availability: "unavailable" as const, reason: gate.failure.reason, panes: [] };
  const available = inspected.availability === "available";
  const reason = inspected.reason;
  const result = {
    project,
    state: status?.state ?? "unknown",
    backend: "rex",
    availability: available ? "available" : "unavailable",
    ...(reason ? { reason } : {}),
    panes: inspected.panes,
    ...(inspected.programStatus ? { programStatus: inspected.programStatus } : {}),
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${project}: ${result.state} (${result.availability}, Rex)`);
    for (const pane of inspected.panes)
      console.log(`  ${pane.name}  ${pane.blockId ?? "UNVERIFIED"}  PID ${pane.pid ?? "UNAVAILABLE"}  UNAVAILABLE  ${escapeControlChars(pane.title ?? "UNAVAILABLE")}`);
    const program = inspected.programStatus;
    // Every program-status text comes from the pane's programs (OSC 7501): all of it is escaped.
    if (program) {
      const fields = [program.kind && `(${program.kind})`, program.app, program.title, program.msg].filter((f): f is string => Boolean(f));
      console.log(`  program: ${[program.state, ...fields.map(escapeControlChars)].join(" ")}`);
    }
    if (reason) console.log(reason);
  }
  if (!available) process.exit(2);
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

/**
 * `summon clean <project>` (plan P17): destroy the recorded Rex session only when Summon's own check shows it empty,
 * then run the same ordered end-of-launch steps as reconciliation.
 */
function closeRex(project: string, record: Parameters<WorkspaceBackend["close"]>[1], sweptNote: string): void {
  if (!record.rex) {
    // The record's Rex identity was discarded by the parser: there is no session to check (unchanged wording).
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
function reviewOrphan(project: string, manifest: LaunchManifest, gen: string | null, binary: string, listings: SessionListings): string {
  const id = manifest.launchId;
  const paths = launchArtifactPaths(project, id);
  const rootName = manifest.paneOrder[0];
  const root = rootName === undefined ? "malformed" : readPaneFile(paths.pane(rootName).file);
  const where = `launch ${id} of [${project}] (started ${manifest.startedAt}, server ${manifest.server ?? "none"})`;
  if (root === "absent" || root === "malformed" || readPaneMapping(manifest, root.sessionId).malformed.length > 0) {
    const files = launchArtifactFiles(project, id, manifest.paneOrder);
    const present = launchFileList(files).filter((file) => existsSync(file));
    return withRecoveryCommand(`${where}: ${root === "absent" ? "never confirmed its session" : "has an unreadable pane file"}; left in place as evidence.`, `rm -f ${present.map(shellQuote).join(" ")}`);
  }
  if (!manifest.server) return `${where}: manifest names no server; left in place.`;
  const cli = createRexCli(binary, manifest.server);
  const listed = listings.of(cli);
  if (!listed.ok) return `${where}: server unreachable (${listed.reason}); left in place.`;
  /** The line for a removal; `tail` (the P17 limitation) comes before a recovery command, which is always last. */
  const removed = (done: string, tail = ""): string => {
    const removal = removeOrphanLaunch(project, gen, manifest);
    if (removal.outcome === "superseded") return `${where}: ${done}; the current record is not this launch's, files left in place.${tail}`;
    const stranded = strandedTokenNotice(removal);
    if (stranded) return withRecoveryCommand(`${where}: ${done}; ${stranded.sentence}.${tail}`, stranded.command);
    if (removal.failures.length > 0) return `${where}: ${done}; a file could not be removed (${removal.failures[0]}); the manifest is kept, run summon clean --orphans again.${tail}`;
    return `${where}: ${done}; files removed.${tail}`;
  };
  if (!listed.sessions.some((s) => s.sessionId === root.sessionId)) return removed("its Rex session is gone");
  const viewed = viewSession(cli, root.sessionId);
  if (!viewed.ok) return viewed.kind === "not-found" ? removed("its Rex session is gone") : `${where}: session could not be read (${viewed.reason}); left in place.`;
  const blocks = viewBlockIds(viewed.view).size;
  if (blocks > 0) return `${where}: Rex session ${root.sessionId} still has ${blocks} block${blocks === 1 ? "" : "s"}; close it yourself with: rex -S ${shellQuote(manifest.server)} kill ${root.sessionId}`;
  const killed = cli.call("kill", ["kill", root.sessionId], { timeoutMs: 10_000 });
  if (!killed.ok) return `${where}: could not close its empty Rex session ${root.sessionId} (${killed.reason}); left in place.`;
  return removed(`closed its empty Rex session ${root.sessionId}`, ` ${LIMITATION}`);
}

export const RexWorkspace: WorkspaceBackend = {
  id: "rex",
  /** Under Rex the shared gate refuses `unknown` and `stopped` (plan P10) and the app attached to the caller's session is preferred (P7). */
  focus(project, status, pane) {
    const gate = gateOf(project, status);
    if (!gate.ok) return gate.failure;
    // No detection row here (focus does not launch): REX_SESSION is set by Rex terminals only, so it is the caller's session when present.
    return focusRex(gate.cli, gate.identity, status?.panes ?? [], project, gate.liveBlocks, pane, process.env["REX_SESSION"]);
  },

  inspect: inspectRexWorkspace,

  title(project, status, scope, operation, pane) {
    const gate = gateOf(project, status);
    if (!gate.ok) return gate.failure;
    return titleRex(gate.cli, gate.identity, status?.panes ?? [], project, scope, operation, pane);
  },

  /** A Ghostty launch over a live Rex session of the same project replaces the record; the session stays (plan §6). */
  stillRunningNotice(project, record) {
    if (!record.rex) return undefined;
    const binary = rexBinaryPath();
    if (!binary) return undefined;
    const state = sessionState(createRexCli(binary, record.rex.server), record.rex, project);
    if (!isLiveState(state.state)) return undefined;
    return `Rex session [${project}] ${record.rex.sessionId} is still running; rex kill ${record.rex.sessionId} closes it`;
  },

  close: closeRex,

  prepareReview() {
    requireRexBinary();
  },

  adoptBeforeReview(project) {
    for (const line of adoptOrphans(project, adoptDeps(requireRexBinary()), { reportLeftovers: false })) note(line);
  },

  reviewLaunches(project, current) {
    const binary = requireRexBinary();
    const listings = sessionListings();
    let reviewed = 0;
    for (const manifest of listLaunchManifests(project)) {
      if (manifest.launchId === current) continue;
      reviewed += 1;
      out(reviewOrphan(project, manifest, current, binary, listings));
    }
    return reviewed;
  },
};

