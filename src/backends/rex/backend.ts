import { resolve } from "node:path";
import type { LayoutPlan } from "../../layout.js";
import { traditionalPaneNames } from "../../layout.js";
import type { TreeLayoutPlan } from "../../tree.js";
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
import { createWorkspace } from "./launch.js";
import type { CreateContext, LaunchOutcome } from "./launch.js";
import type { RexIdentity } from "./types.js";

/** Detection row the Rex backend is built from (plan P5: server and binary come from detection). */
export type RexLaunchContext = Extract<LaunchContext, { backend: "rex" }>;

export interface RexBackendDeps {
  cliFor?: (binary: string, server: string) => RexCli;
  probeWhoami?: typeof probeWhoami;
  createWorkspace?: typeof createWorkspace;
  app?: CreateContext["app"];
  /** `REX_SESSION` of the shell running Summon, when inside Rex (P7). */
  callerSession?: string | undefined;
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
  const cli = (deps.cliFor ?? createRexCli)(context.rexBinary, context.server);
  const whoami = deps.probeWhoami ?? probeWhoami;
  const create = deps.createWorkspace ?? createWorkspace;
  const app = deps.app ?? { discover: discoverRexApp, open: openRexApp };

  async function launchRex(layout: SessionCreateInput["layout"], panes: string[], newWindow: boolean, ctx: BackendLaunchContext): Promise<BackendLaunchResult> {
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
    });
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
    };
    const outcome: LaunchOutcome = await create(manifest, build.request, {
      cli,
      hostId: who.hostId,
      ...(deps.callerSession ? { callerSession: deps.callerSession } : {}),
      newWindow,
      app,
    });
    for (const line of outcome.notices) note(line);
    if (outcome.kind === "failed") throw new Error(outcome.failure.hint ? `${outcome.reason}. ${outcome.failure.hint}` : outcome.reason);
    if (outcome.kind === "unknown") throw new Error(unknownOutcomeMessage(ctx.projectName, outcome.candidates, outcome.reason));
    out(`${sym.ok} Workspace [${ctx.projectName}] ready in Rex.`);
    const named = new Set(panes);
    const identity: RexIdentity = {
      server: context.server,
      hostId: outcome.ids.hostId,
      sessionId: outcome.ids.sessionId,
      windowId: outcome.ids.windowId,
      rootBlockId: outcome.ids.rootBlockId,
      // The record names only the panes Summon shows (a sidebar block without a command exists in Rex but has no pane name).
      blocks: outcome.ids.blocks.filter((b) => named.has(b.name)),
    };
    return { rex: identity };
  }

  return {
    id: "rex",
    launchTraditional(plan: LayoutPlan, ctx) {
      return launchRex({ kind: "traditional", plan }, traditionalPaneNames(plan), plan.newWindow, ctx);
    },
    launchTree(plan: TreeLayoutPlan, ctx) {
      return launchRex({ kind: "tree", plan }, [...plan.leaves], plan.newWindow, ctx);
    },
  };
}
