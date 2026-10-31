import { resolve } from "node:path";
import type { LayoutPlan } from "../../layout.js";
import { traditionalPaneNames } from "../../layout.js";
import type { TreeLayoutPlan } from "../../tree.js";
import { transientLine } from "../../ui/progress.js";
import type { BackendLaunchContext, BackendLaunchResult, LaunchDecision, TerminalBackend } from "../port.js";
import { REX_UNHONORED_FLAGS } from "../../backend.js";
import type { LaunchContext } from "../../backend.js";
import type { CLIOverrides } from "../../config-resolve.js";
import type { LaunchManifest } from "../../launch-identity.js";
import { readStatusRecord } from "../../status-record.js";
import { note, out } from "../../ui/output.js";
import { sym } from "../../ui/symbols.js";
import { createRexCli, probeWhoami } from "./cli.js";
import type { RexCli } from "./cli.js";
import { discoverRexApp, openRexApp } from "./app.js";
import { buildSessionCreateRequest } from "./layout.js";
import type { SessionCreateInput } from "./layout.js";
import { adoptDeps, adoptOrphansForLaunch, createWorkspace, keptSession, maybeSwitchToExisting, showRecordedWorkspace } from "./launch.js";
import type { CreateContext, LaunchOutcome } from "./launch.js";
import { sessionListings } from "./status.js";
import type { SessionListings } from "./status.js";
import { closeLauncherTabAfterRexLaunch, startLauncherTabWatch } from "./launcher-tab.js";
import type { RexIdentity } from "./types.js";

/** Detection row the Rex backend is built from (plan P5: server and binary come from detection). */
export type RexLaunchContext = Extract<LaunchContext, { backend: "rex" }>;

export interface RexBackendDeps {
  cliFor?: (binary: string, server: string) => RexCli;
  probeWhoami?: typeof probeWhoami;
  createWorkspace?: typeof createWorkspace;
  keptSession?: typeof keptSession;
  app?: CreateContext["app"];
  /** `REX_SESSION` of the shell running Summon, when inside Rex (P7). */
  callerSession?: string | undefined;
  /**
   * `--new-window` given on the command line. A config `new-window=true` (the plan's `newWindow`) is a Ghostty
   * preference with no meaning under Rex (`GHOSTTY_ONLY_CONFIG_KEYS`), where the P2 switch already follows the flag only (UX-H1).
   */
  newWindow?: boolean;
  /** The launch's shared session listings (PE-L1), for the kept-session check; `createWorkspace` lists for itself (P13). */
  listings?: SessionListings | undefined;
}

/**
 * Plan P8: flags Rex cannot honor are deliberate limitations, one stderr line each. Only flags given on the
 * command line are named (UX-H1): the same keys in config are Ghostty preferences, silent under Rex like `clean=true`.
 */
export function rexLimitationNotices(overrides: CLIOverrides): string[] {
  return REX_UNHONORED_FLAGS
    .filter((flag) => (flag === "font-size" ? overrides[flag] !== undefined : overrides[flag] === "true"))
    .map((flag) => `Rex cannot honor ${flag}; ignored`);
}

export function unreachableMessage(server: string, reason: string): string {
  return `Rex server at ${server} is not reachable (${reason}). Open the Rex app and retry, or run summon doctor.`;
}

export function unknownOutcomeMessage(project: string, candidates: string[] | "unlisted", reason: string): string {
  const seen = candidates === "unlisted" ? "unknown (the session list could not be read)" : candidates.length === 0 ? "none" : candidates.join(", ");
  return `Rex did not confirm the workspace (${reason}). Sessions that appeared meanwhile: ${seen}. Check the Rex picker for [${project}]; nothing was recorded. If it is there, the next summon ${project} adopts it.`;
}

/**
 * Rex adapter (plan D4, P13, P15): one `session.create` per launch, identity from the server's
 * answer or from the panes' own files, app selection through P7. Throws on `failed` and
 * `unknown` outcomes (nothing recorded); returns the identity otherwise.
 */
export function createRexBackend(context: RexLaunchContext, deps: RexBackendDeps = {}): TerminalBackend {
  // Dependencies are read when a step runs, not here: building the backend for a dry run or a session loads nothing it does not use.
  const cliFor = (binary: string, server: string): RexCli => (deps.cliFor ?? createRexCli)(binary, server);
  const serverCli = (server: string): RexCli => cliFor(context.rexBinary, server);
  const newWindow = deps.newWindow === true;

  async function launchRex(layout: SessionCreateInput["layout"], panes: string[], ctx: BackendLaunchContext): Promise<BackendLaunchResult> {
    const cli = serverCli(context.server);
    const create = deps.createWorkspace ?? createWorkspace;
    const app = deps.app ?? { discover: discoverRexApp, open: openRexApp };
    const who = (deps.probeWhoami ?? probeWhoami)(context.rexBinary, context.server);
    if (!who.answers) throw new Error(unreachableMessage(context.server, who.reason));
    const build = buildSessionCreateRequest({
      layout,
      targetDir: ctx.targetDir,
      project: ctx.projectName,
      launchId: ctx.launchId,
      envVars: ctx.envVars,
      starshipConfigPath: ctx.resolveStarship(),
      onStop: ctx.onStop,
      layoutLabel: ctx.layoutLabel,
    });
    // Read before the new record replaces the earlier one (F12).
    const kept = newWindow ? (deps.keptSession ?? keptSession)(ctx.projectName, serverCli, deps.listings) : undefined;
    const manifest: LaunchManifest = {
      version: 1,
      launchId: ctx.launchId,
      project: ctx.projectName,
      directory: resolve(ctx.targetDir),
      layout: ctx.layoutLabel,
      panes,
      paneOrder: build.paneOrder,
      blockLabels: build.labels,
      backend: "rex",
      server: context.server,
      startedAt: new Date().toISOString(),
      ...(kept && kept.keeps.length > 0 ? { keeps: kept.keeps } : {}),
    };
    // UX-M1: creation, the pane-file wait and opening the app can take many seconds. The line is on stdout,
    // so it never counts as something to read for the launcher tab (D1), and it is cleared before any output.
    const progress = transientLine();
    progress.show(`Summoning ${ctx.projectName}…`);
    let outcome: LaunchOutcome;
    try {
      outcome = await create(manifest, build.request, {
        cli,
        hostId: who.hostId,
        ...(deps.callerSession ? { callerSession: deps.callerSession } : {}),
        newWindow,
        app,
        progress: progress.show,
      });
    } finally {
      progress.clear();
    }
    for (const line of outcome.notices) note(line);
    if (outcome.kind === "failed") throw new Error(outcome.failure.hint ? `${outcome.reason}. ${outcome.failure.hint}` : outcome.reason);
    if (outcome.kind === "unknown") throw new Error(unknownOutcomeMessage(ctx.projectName, outcome.candidates, outcome.reason));
    if (kept) note(kept.notice);
    out(`${sym.ok} Workspace [${ctx.projectName}] ready in Rex.`);
    // `ids.blocks` names only the panes Summon shows (createWorkspace applies the display-pane policy).
    const identity: RexIdentity = {
      server: context.server,
      hostId: outcome.ids.hostId,
      sessionId: outcome.ids.sessionId,
      windowId: outcome.ids.windowId,
      rootBlockId: outcome.ids.rootBlockId,
      blocks: outcome.ids.blocks,
    };
    return { rex: identity };
  }

  return {
    id: "rex",
    // A Rex launch creates its own session and never splits the caller's pane (F14); every project of a session is its own session (P11).
    splitsCallerWindow: false,
    opensSessionTabs: false,

    /**
     * P13 late adoption, then the P2 reuse decision: both before the wizard, the pane probe and on-start, so a switch
     * never reruns them. D1: anything printed from here that the user must read keeps the launcher tab open.
     * A session the record's --new-window launch announced is not repeated on every launch (F12); status still names it.
     * PE-L1: one `rex ls` per server serves both steps. The kept-session check in the launch runs after the wizard and
     * on-start, so it lists afresh rather than reuse a listing that may be minutes old.
     */
    beforeLaunch(project: string): LaunchDecision {
      startLauncherTabWatch(context);
      const listings = sessionListings();
      for (const notice of adoptOrphansForLaunch(project, adoptDeps(context.rexBinary, listings))) note(notice.text, { routine: notice.routine === true });
      return maybeSwitchToExisting(project, newWindow, { cliFor: serverCli, callerSession: deps.callerSession, listings });
    },

    applyLaunchOptions({ overrides, dryRun }) {
      if (dryRun) return;
      for (const line of rexLimitationNotices(overrides)) note(line);
    },

    launchTraditional(plan: LayoutPlan, ctx) {
      return launchRex({ kind: "traditional", plan }, traditionalPaneNames(plan), ctx);
    },
    launchTree(plan: TreeLayoutPlan, ctx) {
      return launchRex({ kind: "tree", plan }, [...plan.leaves], ctx);
    },

    /**
     * Plan P2, Phase 2: the `session.create` request a real run would send, with the pane order its `block_ids` arrive
     * in on the header. A recorded Rex workspace is noted, never switched to or probed: a dry run runs no Rex command.
     * Rex does not resolve commands before launch (plan D5), so there are no command notes.
     */
    dryRun(layout, ctx, starshipConfigPath, headerLines) {
      const project = ctx.projectName;
      const record = readStatusRecord(project);
      if (record?.backend === "rex") {
        const session = record.rex?.sessionId ?? "session id unknown";
        headerLines.push(`-- Note: ${project} is recorded as a Rex workspace (${session}); while it is running, a real run switches to it instead of creating this one`);
      }
      const { request, paneOrder } = buildSessionCreateRequest({
        layout,
        targetDir: ctx.targetDir,
        project,
        launchId: ctx.launchId,
        envVars: ctx.envVars,
        starshipConfigPath,
        onStop: ctx.onStop,
        layoutLabel: ctx.layoutLabel,
      });
      headerLines.push(`-- Server: ${context.server}`);
      headerLines.push(`-- Pane order (block_ids): ${paneOrder.join(", ")}`);
      return { body: JSON.stringify(request, null, 2), notes: [] };
    },

    watchOutput() {
      startLauncherTabWatch(context);
    },
    afterSuccess() {
      closeLauncherTabAfterRexLaunch(context);
    },
    showAgain(project: string) {
      const shown = showRecordedWorkspace(project, context.rexBinary, deps.callerSession);
      if (!shown.shown) note(`could not show [${project}] in Rex: ${shown.reason}`);
    },
  };
}
