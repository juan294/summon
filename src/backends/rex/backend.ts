import { resolve } from "node:path";
import type { LayoutPlan } from "../../layout.js";
import { traditionalPaneNames } from "../../layout.js";
import type { TreeLayoutPlan } from "../../tree.js";
import { transientLine } from "../ghostty.js";
import type { BackendLaunchContext, BackendLaunchResult, TerminalBackend } from "../ghostty.js";
import type { LaunchContext } from "../../backend.js";
import type { LaunchManifest } from "../../launch-identity.js";
import { note, out } from "../../ui/output.js";
import { sym } from "../../ui/symbols.js";
import { createRexCli, probeWhoami } from "./cli.js";
import type { RexCli } from "./cli.js";
import { discoverRexApp, openRexApp } from "./app.js";
import { buildSessionCreateRequest } from "./layout.js";
import type { SessionCreateInput } from "./layout.js";
import { createWorkspace, keptSession } from "./launch.js";
import type { CreateContext, LaunchOutcome } from "./launch.js";
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
   * preference with no meaning under Rex, where the P2 switch already follows the flag only (UX-H1).
   */
  newWindow?: boolean;
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
  const cliFor = deps.cliFor ?? createRexCli;
  const cli = cliFor(context.rexBinary, context.server);
  const whoami = deps.probeWhoami ?? probeWhoami;
  const create = deps.createWorkspace ?? createWorkspace;
  const app = deps.app ?? { discover: discoverRexApp, open: openRexApp };

  const newWindow = deps.newWindow === true;

  async function launchRex(layout: SessionCreateInput["layout"], panes: string[], ctx: BackendLaunchContext): Promise<BackendLaunchResult> {
    const who = whoami(context.rexBinary, context.server);
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
    const kept = newWindow ? (deps.keptSession ?? keptSession)(ctx.projectName, (server) => cliFor(context.rexBinary, server)) : undefined;
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
        progress: (label) => progress.show(label),
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
    launchTraditional(plan: LayoutPlan, ctx) {
      return launchRex({ kind: "traditional", plan }, traditionalPaneNames(plan), ctx);
    },
    launchTree(plan: TreeLayoutPlan, ctx) {
      return launchRex({ kind: "tree", plan }, [...plan.leaves], ctx);
    },
  };
}
