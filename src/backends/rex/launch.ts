import { readFileSync } from "node:fs";
import { launchArtifactFiles, launchArtifactPaths, listLaunchManifests, readLaunchManifest, writeLaunchManifest } from "../../launch-identity.js";
import type { LaunchArtifactPaths, LaunchManifest } from "../../launch-identity.js";
import { ghosttyLiveness, isLiveState, readStatusRecord, removeLaunchArtifacts, withOwnedRecord } from "../../status-record.js";
import type { WorkspaceState, WorkspaceStatus } from "../../status-record.js";
import { err, note } from "../../ui/output.js";
import { createRexCli, whoamiOf } from "./cli.js";
import type { RexCli } from "./cli.js";
import { pickAppClient, pollUntil, realClock, selectInApp, waitForAppClient } from "./app.js";
import type { AppClientChoice, PollOptions } from "./app.js";
import { listSessions, sessionState, viewSession } from "./status.js";
import type { SessionView } from "./status.js";
import { isKindId } from "./types.js";
import type { RexBlockIdentity, RexFailure } from "./types.js";
import type { SessionCreateRequest } from "./layout.js";

/**
 * Rex workspace creation and recovery (plan D4, P7, P9, P13).
 *
 * `createWorkspace` is the state machine of phase-3.md: manifest first, one `session.create`,
 * then either the server's ids or, after an unknown outcome, the ids the panes published
 * themselves (token and pane files). `adoptOrphans` is the two-pass late adoption; it never
 * mutates when any lookup answered `unknown`.
 */

// --- Pane files (P13) ---

export interface PaneFile {
  sessionId: string;
  blockId: string;
}

export type PaneFileRead = PaneFile | "absent" | "malformed";

/** Two validated lines (`session:…`, `block:…`); a `.tmp` beside an absent file is still absent. */
export function readPaneFile(path: string): PaneFileRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "malformed";
  }
  const [sessionId, blockId] = raw.split("\n");
  if (!isKindId(sessionId, "session") || !isKindId(blockId, "block")) return "malformed";
  return { sessionId, blockId };
}

export interface PaneMapping {
  /** Pane name to block id, from the panes' own files, in `paneOrder`. */
  blocks: Map<string, string>;
  missing: string[];
  malformed: string[];
  /** Files whose session line differs from the confirmed session. */
  foreign: string[];
}

export function readPaneMapping(manifest: LaunchManifest, sessionId: string): PaneMapping {
  const paths = launchArtifactPaths(manifest.project, manifest.launchId);
  const mapping: PaneMapping = { blocks: new Map(), missing: [], malformed: [], foreign: [] };
  for (const name of manifest.paneOrder) {
    const read = readPaneFile(paths.pane(name).file);
    if (read === "absent") mapping.missing.push(name);
    else if (read === "malformed") mapping.malformed.push(name);
    else if (read.sessionId !== sessionId) mapping.foreign.push(name);
    else mapping.blocks.set(name, read.blockId);
  }
  return mapping;
}

/** Wait for the root pane's file (the ownership token). */
export async function waitForToken(paths: LaunchArtifactPaths, rootName: string, options: PollOptions): Promise<PaneFileRead> {
  const read = await pollUntil(() => {
    const value = readPaneFile(paths.pane(rootName).file);
    return value === "absent" ? undefined : value;
  }, options);
  return read ?? "absent";
}

// --- Client actions ---

function describeClient(choice: AppClientChoice): string {
  const { chosen } = choice;
  return chosen.label ? `${chosen.label} (${chosen.clientId})` : chosen.clientId;
}

// --- createWorkspace ---

export interface CreatedIds {
  sessionId: string;
  windowId: string;
  rootBlockId: string;
  hostId: string;
  blocks: RexBlockIdentity[];
  /** Panes whose file had not appeared when the session was adopted (filled in later by `refreshPaneMapping`). */
  unverified: string[];
}

export type LaunchOutcome =
  | { kind: "created"; ids: CreatedIds; clientId: string; notices: string[] }
  | { kind: "created-unselected"; ids: CreatedIds; notices: string[] }
  | { kind: "unknown"; reason: string; candidates: string[] | "unlisted"; notices: string[] }
  | { kind: "failed"; reason: string; failure: RexFailure; notices: string[] };

export interface CreateContext {
  /** Bound to the manifest's server. */
  cli: RexCli;
  /** The server's host id (from `whoami`, probed before the call). */
  hostId: string;
  /** `REX_SESSION` when Summon runs inside Rex: its app clients are preferred (P7). */
  callerSession?: string;
  /** `--new-window`: a fresh session (the P2 switch is skipped) shown in the current window, with a notice (P9 fallback). */
  newWindow: boolean;
  app: { discover: () => string | null; open: (bundlePath: string) => boolean };
  clock?: PollOptions["clock"];
  tokenTimeoutMs?: number;
  clientTimeoutMs?: number;
  intervalMs?: number;
}

interface CreateAnswer {
  sessionId: string;
  windowId: string;
  blockIds: string[];
}

function parseCreateAnswer(json: unknown): CreateAnswer | undefined {
  if (!json || typeof json !== "object") return;
  const raw = json as Record<string, unknown>;
  const windows = raw["initial_windows"];
  if (!isKindId(raw["session_id"], "session") || !Array.isArray(windows) || windows.length === 0) return;
  const first = windows[0] as Record<string, unknown>;
  if (!first || typeof first !== "object" || !isKindId(first["window_id"], "window") || !Array.isArray(first["block_ids"])) return;
  const blockIds = (first["block_ids"] as unknown[]).filter((id): id is string => isKindId(id, "block"));
  if (blockIds.length !== (first["block_ids"] as unknown[]).length) return;
  return { sessionId: raw["session_id"], windowId: first["window_id"], blockIds };
}

function blockIdentities(manifest: LaunchManifest, blocks: Map<string, string>): RexBlockIdentity[] {
  const result: RexBlockIdentity[] = [];
  for (const name of manifest.paneOrder) {
    const blockId = blocks.get(name);
    if (blockId !== undefined) result.push({ name, blockId, label: manifest.blockLabels[name] ?? "" });
  }
  return result;
}

/** The window that shows `rootBlockId`, else the one labelled `[project]`, else the first. */
function windowFor(view: SessionView, project: string, rootBlockId: string): SessionView["windows"][number] | undefined {
  return view.windows.find((w) => w.blockIds.includes(rootBlockId)) ?? view.windows.find((w) => w.label === `[${project}]`) ?? view.windows[0];
}

function unverifiedNotice(unverified: string[]): string {
  return unverified.length === 1
    ? `1 pane is unverified (${unverified[0]}); its file had not appeared yet`
    : `${unverified.length} panes are unverified (${unverified.join(", ")}); their files had not appeared yet`;
}

export async function createWorkspace(manifest: LaunchManifest, request: SessionCreateRequest, ctx: CreateContext): Promise<LaunchOutcome> {
  const clock = ctx.clock ?? realClock;
  const intervalMs = ctx.intervalMs ?? 250;
  const tokenTimeoutMs = ctx.tokenTimeoutMs ?? 8000;
  const clientTimeoutMs = ctx.clientTimeoutMs ?? 8000;
  const { cli } = ctx;
  const project = manifest.project;
  const notices: string[] = [];

  // 0. Manifest before any mutation (P13): only this launch knows its id.
  writeLaunchManifest(manifest);
  const paths = launchArtifactPaths(project, manifest.launchId);
  const rootName = manifest.paneOrder[0];
  if (rootName === undefined) throw new Error("Rex launch: the manifest has no panes");

  // 1. BEFORE: sessions that exist now; failure tolerated.
  const before = listSessions(cli);
  const ids0 = before.ok ? new Set(before.sessions.map((s) => s.sessionId)) : null;

  // 2. CREATE.
  const created = cli.call("session-create", ["api", "call", "session.create", "-"], { input: JSON.stringify(request), timeoutMs: 10_000, autostart: true });
  let ids: CreatedIds | undefined;
  let unknownReason: string;
  if (created.ok) {
    const answer = parseCreateAnswer(created.json);
    if (answer && answer.blockIds.length === manifest.paneOrder.length) {
      const blocks = new Map(manifest.paneOrder.map((name, i) => [name, answer.blockIds[i]!]));
      ids = { sessionId: answer.sessionId, windowId: answer.windowId, rootBlockId: answer.blockIds[0]!, hostId: ctx.hostId, blocks: blockIdentities(manifest, blocks), unverified: [] };
    }
    unknownReason = answer
      ? `session.create answered with ${answer.blockIds.length} blocks for ${manifest.paneOrder.length} panes`
      : "session.create answered with an unexpected shape";
  } else if (created.outcome !== "unknown") {
    return { kind: "failed", reason: created.reason, failure: created, notices };
  } else {
    unknownReason = created.reason;
  }

  // 5. TOKEN: the panes prove what was created.
  if (!ids) {
    const unknown = (detail: string): LaunchOutcome => {
      let candidates: string[] | "unlisted" = "unlisted";
      const after = ids0 ? listSessions(cli) : null;
      if (ids0 && after?.ok) candidates = after.sessions.filter((s) => !ids0.has(s.sessionId) && s.label === project).map((s) => s.sessionId);
      return { kind: "unknown", reason: `${unknownReason}; ${detail}`, candidates, notices };
    };
    const token = await waitForToken(paths, rootName, { timeoutMs: tokenTimeoutMs, intervalMs, clock });
    if (token === "absent") return unknown(`no pane file confirmed the session within ${Math.round(tokenTimeoutMs / 1000)} s`);
    if (token === "malformed") return unknown("the root pane file is unreadable");
    const viewed = viewSession(cli, token.sessionId);
    if (!viewed.ok) return unknown(`the token names ${token.sessionId} but session.view failed: ${viewed.reason}`);
    const view = viewed.view;
    const window = windowFor(view, project, token.blockId);
    if (view.label !== project || !window || !view.windows.some((w) => w.label === `[${project}]`)) {
      return unknown(`token named an unexpected session (${token.sessionId}, label ${JSON.stringify(view.label)})`);
    }
    const mapping = readPaneMapping(manifest, token.sessionId);
    if (mapping.foreign.length > 0 || mapping.malformed.length > 0) {
      return unknown(`pane files do not belong to the confirmed session or are unreadable (${[...mapping.foreign, ...mapping.malformed].join(", ")})`);
    }
    ids = { sessionId: token.sessionId, windowId: window.windowId, rootBlockId: token.blockId, hostId: ctx.hostId, blocks: blockIdentities(manifest, mapping.blocks), unverified: mapping.missing };
    // A command-less sidebar block has no display pane; it is not worth a notice.
    const shown = mapping.missing.filter((name) => manifest.panes.includes(name));
    if (shown.length > 0) notices.push(unverifiedNotice(shown));
  }

  // 6. CLIENT (P7): one listing; apps attached to the caller's session are preferred, else every app.
  let choice: AppClientChoice | undefined = pickAppClient(cli, ctx.callerSession);
  if (!choice) {
    const bundle = ctx.app.discover();
    if (bundle && ctx.app.open(bundle)) {
      await clock.sleep(intervalMs);
      choice = await waitForAppClient(cli, ctx.callerSession, { timeoutMs: clientTimeoutMs, intervalMs, clock });
    }
  }
  if (!choice) {
    notices.push(`Created in Rex but no Rex app is connected; open Rex and pick [${project}], or run summon open ${project}`);
    return { kind: "created-unselected", ids, notices };
  }
  if (choice.others.length > 0) {
    notices.push(`Several Rex apps are connected; using ${describeClient(choice)}, not ${choice.others.map((c) => c.clientId).join(", ")}`);
  }

  // 7. --new-window (P9 fallback, verified on the owner's machine on 2026-10-29): `client.window.new`
  // opens a window holding a fresh server-chosen session and `session.select` does not move the
  // new session into it, so the new session is shown in the current window with one notice.
  if (ctx.newWindow) notices.push(`Rex shows [${project}] in the current window; --new-window opens a new session, not a new window`);

  // 8. SELECT.
  const selected = selectInApp(cli, choice.chosen.clientId, ids.sessionId, ids.windowId);
  if (!selected.ok) {
    notices.push(`Created in Rex but could not show it (${selected.reason}); pick [${project}] in Rex or run summon open ${project}`);
    return { kind: "created-unselected", ids, notices };
  }
  return { kind: "created", ids, clientId: choice.chosen.clientId, notices };
}

// --- refreshPaneMapping (current generation) ---

/**
 * Fill in the blocks of panes whose file appeared after adoption, under the lock with the
 * record's own generation. Malformed or foreign files are reported, never deleted.
 */
export function refreshPaneMapping(record: WorkspaceStatus): string[] {
  const identity = record.rex;
  if (!identity || !record.launchId) return [];
  const known = new Set(identity.blocks.map((b) => b.name));
  const missing = record.panes.filter((name) => !known.has(name));
  if (missing.length === 0) return [];
  const paths = launchArtifactPaths(record.project, record.launchId);
  const manifest = readLaunchManifest(record.project, record.launchId);
  const notices: string[] = [];
  const found: RexBlockIdentity[] = [];
  for (const name of missing) {
    const read = readPaneFile(paths.pane(name).file);
    if (read === "absent") continue;
    if (read === "malformed") notices.push(`pane ${name} of ${record.project} has an unreadable pane file; summon clean --orphans names it`);
    else if (read.sessionId !== identity.sessionId) notices.push(`pane ${name} of ${record.project} has a pane file from another session; summon clean --orphans names it`);
    else found.push({ name, blockId: read.blockId, label: manifest?.blockLabels[name] ?? "" });
  }
  if (found.length > 0) {
    withOwnedRecord(record.project, { launchId: record.launchId }, (current) => {
      if (!current?.rex) return null;
      const present = new Set(current.rex.blocks.map((b) => b.name));
      const additions = found.filter((b) => !present.has(b.name));
      if (additions.length === 0) return null;
      return { ...current, rex: { ...current.rex, blocks: [...current.rex.blocks, ...additions] } };
    });
  }
  return notices;
}

// --- adoptOrphans (P13 late adoption, two passes) ---

export interface AdoptDeps {
  /** A CLI bound to a manifest's or record's server. */
  cliFor: (server: string) => RexCli;
  /** Liveness of a Ghostty record of the project. */
  ghosttyState: (project: string) => WorkspaceState;
}

export function adoptDeps(binary: string): AdoptDeps {
  return {
    cliFor: (server) => createRexCli(binary, server),
    ghosttyState: (project) => {
      const record = readStatusRecord(project);
      return record ? ghosttyLiveness(project, record) : "stopped";
    },
  };
}

type Decision =
  | { kind: "report"; notice: string }
  | { kind: "remove"; manifest: LaunchManifest }
  | { kind: "adopt"; manifest: LaunchManifest; record: WorkspaceStatus; sessionId: string };

/** Every file of a launch whose session is confirmed gone; returns the failures (`path: reason`). */
export function removeLaunchFiles(manifest: LaunchManifest): string[] {
  const files = launchArtifactFiles(manifest.project, manifest.launchId, manifest.paneOrder);
  return removeLaunchArtifacts([...files.session, ...files.liveness]);
}

function hostIdOf(view: SessionView, cli: RexCli): string | undefined {
  const fromView = view.windows.flatMap((w) => w.hostIds).find((id) => id !== "");
  if (fromView) return fromView;
  const who = whoamiOf(cli);
  return who.answers ? who.hostId : undefined;
}

function extraSessionNotice(project: string, sessionId: string, launchId: string): string {
  return `extra Rex session [${project}] ${sessionId} from earlier launch ${launchId}; rex kill ${sessionId} closes it`;
}

/** Verify every orphan (no mutation), then adopt at most one and remove confirmed-gone launches, under the lock. */
export function adoptOrphans(project: string, deps: AdoptDeps): string[] {
  const current = readStatusRecord(project);
  if (current && !current.launchId) return [`${project} has a record from an older Summon; run summon ${project} to replace it`];
  const gen = current?.launchId ?? null;
  const manifests = listLaunchManifests(project).filter((m): m is LaunchManifest & { server: string } => m.launchId !== gen && m.backend === "rex" && m.server !== undefined);
  if (manifests.length === 0) return [];

  // PASS 1: the current record.
  let live = false;
  if (current) {
    if (current.backend === "rex") {
      // A Rex record whose identity was discarded cannot be verified (and must never reach the Ghostty resolver, which reads Rex records through this function).
      if (!current.rex) return [`${project} record has no Rex identity; nothing adopted or removed`];
      const state = sessionState(deps.cliFor(current.rex.server), current.rex, project);
      if (state.state === "unknown") return [`${project} could not be verified on ${current.rex.server}: ${state.reason ?? "unknown"}; nothing adopted or removed`];
      live = isLiveState(state.state);
    } else {
      const state = deps.ghosttyState(project);
      if (state === "unknown") return [`${project} could not be verified; nothing adopted or removed`];
      live = isLiveState(state);
    }
  }

  // PASS 1: every other launch. One `ls` per server for the whole call.
  const decisions: Decision[] = [];
  const unknowns: string[] = [];
  const cleanHint = "summon clean --orphans names it";
  const report = (notice: string): void => { decisions.push({ kind: "report", notice }); };
  const sessionLists = new Map<string, ReturnType<typeof listSessions>>();
  const sessionsOn = (server: string, cli: RexCli) => {
    let listed = sessionLists.get(server);
    if (!listed) { listed = listSessions(cli); sessionLists.set(server, listed); }
    return listed;
  };
  for (const manifest of manifests) {
    const id = manifest.launchId;
    const rootName = manifest.paneOrder[0];
    const paths = launchArtifactPaths(project, id);
    const root = rootName === undefined ? "malformed" : readPaneFile(paths.pane(rootName).file);
    if (root === "absent") { report(`earlier launch ${id} of ${project} never confirmed its session; ${cleanHint}`); continue; }
    if (root === "malformed") { report(`earlier launch ${id} of ${project} left an unreadable pane file (${rootName ?? "root"}); ${cleanHint}`); continue; }
    const mapping = readPaneMapping(manifest, root.sessionId);
    if (mapping.malformed.length > 0) { report(`earlier launch ${id} of ${project} left an unreadable pane file (${mapping.malformed.join(", ")}); ${cleanHint}`); continue; }
    const cli = deps.cliFor(manifest.server);
    const listed = sessionsOn(manifest.server, cli);
    if (!listed.ok) { unknowns.push(`earlier launch ${id} could not be verified on ${manifest.server}: ${listed.reason}; nothing adopted or removed`); continue; }
    if (!listed.sessions.some((s) => s.sessionId === root.sessionId)) { decisions.push({ kind: "remove", manifest }); continue; }
    const viewed = viewSession(cli, root.sessionId);
    if (!viewed.ok) {
      if (viewed.kind === "not-found") decisions.push({ kind: "remove", manifest });
      else unknowns.push(`earlier launch ${id} could not be verified on ${manifest.server}: ${viewed.reason}; nothing adopted or removed`);
      continue;
    }
    if (mapping.foreign.length > 0) { report(`earlier launch ${id} of ${project} has pane files that do not belong to its session (${mapping.foreign.join(", ")}); ${cleanHint}`); continue; }
    if (live) { report(extraSessionNotice(project, root.sessionId, id)); continue; }
    const window = windowFor(viewed.view, project, root.blockId);
    if (!window) { report(`earlier launch ${id} of ${project} left an empty Rex session ${root.sessionId}; rex kill ${root.sessionId} closes it`); continue; }
    const hostId = hostIdOf(viewed.view, cli);
    if (!hostId) { unknowns.push(`earlier launch ${id} could not be verified on ${manifest.server}: no host id; nothing adopted or removed`); continue; }
    const record: WorkspaceStatus = {
      project,
      directory: manifest.directory,
      pid: process.pid,
      startedAt: manifest.startedAt,
      layout: manifest.layout,
      panes: [...manifest.panes],
      source: "summon",
      version: 1,
      launchId: id,
      backend: "rex",
      rex: { server: manifest.server, hostId, sessionId: root.sessionId, windowId: window.windowId, rootBlockId: root.blockId, blocks: blockIdentities(manifest, mapping.blocks) },
    };
    decisions.push({ kind: "adopt", manifest, record, sessionId: root.sessionId });
  }

  const reports = decisions.filter((d): d is Extract<Decision, { kind: "report" }> => d.kind === "report").map((d) => d.notice);
  if (unknowns.length > 0) return [...unknowns, ...reports];

  // PASS 2: mutations in startedAt order, each under the lock with the generation read above.
  const notices: string[] = [];
  const superseded = `another launch of ${project} published meanwhile; nothing adopted or removed`;
  let adopted = false;
  for (const decision of decisions) {
    if (decision.kind === "report") { notices.push(decision.notice); continue; }
    if (decision.kind === "remove") {
      const { outcome } = withOwnedRecord(project, { launchId: gen }, () => null, () => removeLaunchFiles(decision.manifest));
      if (outcome === "superseded") { notices.push(superseded); return notices; }
      notices.push(`removed the files of earlier launch ${decision.manifest.launchId} (its Rex session is gone)`);
      continue;
    }
    if (adopted) {
      notices.push(extraSessionNotice(project, decision.sessionId, decision.manifest.launchId));
      continue;
    }
    const { outcome } = withOwnedRecord(project, { launchId: gen }, () => decision.record);
    if (outcome === "superseded") { notices.push(superseded); return notices; }
    adopted = true;
    notices.push(`adopted earlier launch ${decision.manifest.launchId} of ${project} (Rex session ${decision.sessionId})`);
  }
  return notices;
}

// --- Showing a recorded workspace (P2 switch, `summon session`) ---

export type ShowResult = { shown: true; clientId: string } | { shown: false; reason: string };

/** Select the recorded session in the newest app client; for a partial workspace focus the first live pane first. */
export function showWorkspace(cli: RexCli, record: WorkspaceStatus, liveBlocks: string[] = []): ShowResult {
  const identity = record.rex;
  if (!identity) return { shown: false, reason: "the record has no Rex identity" };
  const choice = pickAppClient(cli);
  if (!choice) return { shown: false, reason: `no Rex app is connected; open Rex and pick [${record.project}]` };
  const firstLive = identity.blocks.find((b) => liveBlocks.includes(b.name));
  if (firstLive && !liveBlocks.includes(identity.blocks[0]?.name ?? "")) {
    const focused = cli.call("focus", ["focus", "-s", identity.sessionId, firstLive.blockId]);
    if (!focused.ok) note(`could not focus pane ${firstLive.name} (${focused.reason})`);
  }
  const selected = selectInApp(cli, choice.chosen.clientId, identity.sessionId, identity.windowId);
  if (!selected.ok) return { shown: false, reason: selected.reason };
  return { shown: true, clientId: choice.chosen.clientId };
}

export type SwitchDecision = { kind: "switched" } | { kind: "proceed" } | { kind: "refused"; reason: string };

export interface SwitchDeps {
  cliFor: (server: string) => RexCli;
}

/** Plan P2: a live recorded Rex workspace is shown instead of created, unless --new-window asks for a fresh one. */
export function maybeSwitchToExisting(project: string, newWindow: boolean, deps: SwitchDeps): SwitchDecision {
  const record = readStatusRecord(project);
  if (!record || record.backend !== "rex" || !record.rex) return { kind: "proceed" };
  if (newWindow) return { kind: "proceed" };
  for (const line of refreshPaneMapping(record)) note(line);
  const current = readStatusRecord(project) ?? record;
  const identity = current.rex ?? record.rex;
  const cli = deps.cliFor(identity.server);
  const state = sessionState(cli, identity, project);
  if (state.state === "unknown") return { kind: "refused", reason: `${project} is recorded in Rex but could not be verified on ${identity.server}: ${state.reason ?? "unknown"}. Open the Rex app and retry, or run summon doctor.` };
  if (state.state === "stopped") return { kind: "proceed" };
  const shown = showWorkspace(cli, { ...current, rex: identity }, state.liveBlocks);
  if (shown.shown) err(`Workspace [${project}] is already running in Rex; switched to it (use --new-window for a fresh one)`);
  else err(`Workspace [${project}] is already running in Rex but could not be shown (${shown.reason}); run summon open ${project}`);
  return { kind: "switched" };
}

/** Show a project's recorded Rex workspace (used by `summon session` to return to the first project). */
export function showRecordedWorkspace(project: string, binary: string): ShowResult {
  const record = readStatusRecord(project);
  if (!record?.rex) return { shown: false, reason: `${project} has no Rex record` };
  return showWorkspace(createRexCli(binary, record.rex.server), record);
}
