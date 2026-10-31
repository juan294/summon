import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { planLayout, traditionalPaneNames } from "./layout.js";
import type { LayoutOptions } from "./layout.js";
// UX-M4: the monitor's Enter handoff takes the trust prompt from the launcher it already loads lazily.
export { withTrustPrompt } from "./trust.js";
import { listProjects } from "./config.js";
import { pickConfigValue, readTrustedSummonFile, resolveConfig } from "./config-resolve.js";
import type { CLIOverrides, ResolvedConfig } from "./config-resolve.js";
import { publishStatus, readStatus, readStatusRecord } from "./status.js";
import type { WorkspaceStatus } from "./status.js";
import { generateAppleScript, generateTreeAppleScript } from "./script.js";
import { newLaunchId } from "./launch-identity.js";
import { REX_UNHONORED_FLAGS, callerRexSession, resolveBackendForLaunch } from "./backend.js";
import type { BackendId, LaunchContext } from "./backend.js";
import { GhosttyBackend, ghosttyCommandEntries } from "./backends/ghostty.js";
import type { BackendLaunchContext, BackendLaunchResult, TerminalBackend } from "./backends/ghostty.js";
import { createRexBackend } from "./backends/rex/backend.js";
import { adoptOrphansForLaunch, adoptDeps, maybeSwitchToExisting } from "./backends/rex/launch.js";
import { createRexCli, discoverRex } from "./backends/rex/cli.js";
import { focusRex, sessionState, sessionListings } from "./backends/rex/status.js";
import { closeLauncherTabAfterRexLaunch, markAttention, startLauncherTabWatch } from "./backends/rex/launcher-tab.js";
import type { ResolvedStatus } from "./status.js";
import { isLiveState, rexCommandGate } from "./status.js";
import { buildSessionCreateRequest } from "./backends/rex/layout.js";
import type { SessionCreateInput } from "./backends/rex/layout.js";
import { resolveTreeCommands as resolveTreeCmds, buildTreePlan, collectLeaves, findPaneByName } from "./tree.js";
import type { PlannedLayout, TreePlanOptions } from "./tree.js";
import { getErrorMessage, SUMMON_WORKSPACE_ENV, promptUser, isDebug, PromptCancelled } from "./utils.js";
import { COMMAND_FAILURE_REASONS, checkCommand, commandFixHint, ensureCommand } from "./command-install.js";
import { fail, err, note, warn } from "./ui/output.js";
import { confirmDangerousCommands } from "./launch-guards.js";
import { PROJECT_NAME_RE, sanitizeProjectName } from "./validation.js";
import { isStarshipInstalled, ensurePresetConfig, getPresetConfigPath } from "./starship.js";
// command-spec is a pure utility module with no imports from this file.
// Dependency direction: launcher -> command-spec (one-way, no circular risk).
import { commandExecutable, replaceCommandExecutable } from "./command-spec.js";
import { focusTerminal } from "./ghostty-native.js";
import type { FocusResult, NativeFailure } from "./ghostty-native.js";

/** Resolve a human-readable project name from a target directory. */
export function resolveProjectName(targetDir: string): string {
  const resolved = resolve(targetDir);
  const projects = listProjects();
  for (const [name, projPath] of projects) {
    if (resolve(projPath) === resolved) return name;
  }
  const derived = basename(resolved);
  if (PROJECT_NAME_RE.test(derived)) return derived;
  const sanitized = sanitizeProjectName(derived);
  warn(
    `Project name "${derived}" contains unsupported characters; using "${sanitized}" for tab title and status tracking.`,
  );
  return sanitized;
}

/** Resolve a recorded exact UUID without activating or querying the application. */
export function resolveWorkspaceTerminal(projectName: string, paneName?: string, status?: ResolvedStatus | null): { kind: "target"; terminalId: string } | NativeFailure {
  if (!PROJECT_NAME_RE.test(projectName)) return { kind: "unavailable", code: "missing", reason: "Invalid project name. Run summon inspect <project>." };
  if (status === undefined) status = readStatus(projectName);
  if (status?.backend === "rex") return { kind: "unavailable", code: "missing", reason: `[${projectName}] runs in Rex; its panes are Rex blocks, not Ghostty terminals. Run summon inspect ${projectName}.` };
  if (!status?.native) return { kind: "unavailable", code: "missing", reason: "Exact native identity is unavailable. Select in Ghostty or explicitly relaunch when ready to capture identity; run summon inspect <project>." };
  const terminalId = paneName === undefined ? status.native.rootTerminalId : status.native.panes.find(p => p.name === paneName)?.terminalId;
  if (!terminalId) return { kind: "unavailable", code: "missing", reason: `Unknown pane. Valid panes: ${status.native.panes.map(p => p.name).join(", ")}. Run summon inspect ${projectName}.` };
  return { kind: "target", terminalId };
}

/**
 * Focus only a recorded exact identity. Legacy/stale records never launch implicitly. Under Rex
 * the shared gate refuses `unknown` and `stopped` (plan P10) and the app attached to the
 * caller's session is preferred (P7).
 */
export function focusWorkspace(projectName: string, paneName?: string): FocusResult {
  const status = PROJECT_NAME_RE.test(projectName) ? readStatus(projectName) : null;
  if (status?.backend === "rex") {
    const gate = rexCommandGate(projectName, status);
    if (!gate.ok) return gate.failure;
    // No detection row here (focus does not launch): REX_SESSION is set by Rex terminals only, so it is the caller's session when present.
    return focusRex(gate.cli, gate.identity, status.panes, projectName, gate.liveBlocks, paneName, process.env["REX_SESSION"]);
  }
  const target = resolveWorkspaceTerminal(projectName, paneName, status);
  return target.kind === "target" ? focusTerminal(target.terminalId) : target;
}

/**
 * Warn the user if they're launching from inside an existing summon workspace.
 * Returns true if the user chose to abort.
 */
async function warnIfNested(
  opts: Partial<LayoutOptions>,
  dryRun: boolean | undefined,
  backend: BackendId,
): Promise<boolean> {
  // A Rex launch creates its own session and never splits the caller's pane (F14).
  if (backend === "rex" || !process.env[SUMMON_WORKSPACE_ENV] || opts.newWindow || dryRun || !process.stdin.isTTY) {
    return false;
  }
  warn("You're inside an existing summon workspace.");
  err("Launching here will nest splits inside this pane, which can get messy.");
  err("Tip: Use --new-window to open in a separate window instead.\n");
  const answer = (await promptUser("Continue anyway? [y/N] ")).toLowerCase();
  return answer !== "y";
}

/**
 * Probe Ghostty for the number of terminals in the front window's selected tab.
 * Returns null when Ghostty is not running, the script errors, or output is non-numeric.
 *
 * PE-L2: This is a separate osascript call made BEFORE the main workspace script.
 * Two round-trips are intentional: this probe runs before the main AppleScript is
 * generated, and its result (pane count) influences the generated script's content
 * (the cleanRestoredPanes prelude). Inlining the count into the main script would
 * require AppleScript to conditionally close panes and then branch — adding significant
 * complexity to script.ts for minimal latency gain (probe takes ~2 s max, main script
 * executes regardless). The two-call design keeps script generation pure and testable.
 */
export function probePaneCount(): number | null {
  try {
    const out = execFileSync(
      "osascript",
      ["-e", 'tell application "Ghostty" to count of terminals of selected tab of front window'],
      { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether to auto-clean restored panes from the front window's selected tab.
 * Only cleans panes when the front tab title contains a summon project marker `[<projectName>]`.
 * This prevents destroying non-summon panes.
 * When all trigger conditions are met, sets opts.cleanRestoredPanes=true and prints a notice.
 */
export function decideCleanRestoredPanes(
  opts: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  project: Map<string, string>,
  machineConfig: Map<string, string>,
  dryRun: boolean | undefined,
  _projectName?: string,
): void {
  if (process.env[SUMMON_WORKSPACE_ENV]) return;
  if (opts.newWindow) return;

  const cleanRaw = pickConfigValue(cliOverrides.clean, "clean", project, machineConfig);
  // Default to false — clean must be explicitly enabled via --clean or clean=true (BE-H1 #362).
  const cleanEnabled = cleanRaw === "true";
  if (!cleanEnabled) return;

  // In dry-run mode, skip the probe but honor an explicit --clean flag so the
  // generated AppleScript (printed to stdout) includes the close prelude.
  if (dryRun) {
    if (cliOverrides.clean === "true") opts.cleanRestoredPanes = true;
    return;
  }

  const count = probePaneCount();
  if (count === null || count <= 1) return;

  // Clean every pane in the front tab regardless of how it got there.
  // Users who don't want this can pass --no-clean or --new-window.
  const stale = count - 1;
  const noun = stale === 1 ? "pane" : "panes";
  console.log(`Clearing ${stale} stale ${noun} from previous session...`);
  opts.cleanRestoredPanes = true;
}

/**
 * Execute the on-start hook command before workspace creation.
 *
 * Security note: This is the only production use of `execSync` (shell mode).
 * All other command execution uses `execFileSync` to avoid shell injection.
 * `execSync` is required here because on-start values are user-authored shell
 * commands that intentionally rely on shell features (pipes, redirects, etc.).
 *
 * The mitigation chain:
 * 1. `confirmDangerousCommands()` warns interactively when shell metacharacters
 *    are detected, giving the user a chance to abort.
 * 2. In non-TTY mode, commands containing metacharacters are refused outright.
 * 3. CLI-sourced `--on-start` values are explicitly user-provided and thus
 *    inherently trusted (same trust model as any shell command the user types).
 * 4. The feature is documented in `--help` so users understand the behavior.
 */
function executeOnStart(onStart: string, targetDir: string): void {
  // SE-L3: suppress the on-start command echo to prevent sensitive commands from
  // leaking to stdout in non-debug mode. Gate behind SUMMON_DEBUG for diagnostics.
  // Note: on-start/on-stop hooks inherit the full launcher environment by design
  // (intentional, matching shell exec behavior). This is a known difference from
  // pane env (which is scrubbed by ENV_DENYLIST_PREFIXES/ENV_DENYLIST_EXACT in config-resolve.ts).
  if (isDebug()) {
    process.stderr.write(`[debug] Running on-start: ${onStart}\n`);
  }
  // QA-M3: the hook keeps the terminal (an interactive hook needs its TTY), so the D1 watch cannot see what it prints:
  // the launcher tab stays for its output.
  markAttention();
  try {
    execSync(onStart, { cwd: targetDir, encoding: "utf-8", stdio: "inherit" });
  } catch (error) {
    // BE-M3 (#594): non-zero exit is non-fatal — warn and continue the launch.
    // A hard abort (e.g. for SIGINT/SIGKILL) is unlikely from a hook and would be
    // surfaced via the stderr inherited above; treating all failures as warnings
    // allows pre-flight checks to fail gracefully without killing the workspace.
    if (isDebug()) err(`[debug] on-start command failed: ${onStart} — ${getErrorMessage(error)}`);
    else warn("on-start command failed; continuing workspace launch");
  }
}

/** Append shared optional dry-run header lines (starship preset) plus the backend and launch identity. */
function appendDryRunExtras(
  headerLines: string[],
  starshipPreset: string | undefined,
  dryRunStarshipPath: string | null,
  backend: BackendId,
  launchId: string,
): void {
  if (starshipPreset) {
    headerLines.push(`-- Starship preset: ${starshipPreset} (${dryRunStarshipPath})`);
  }
  headerLines.push(`-- Backend: ${backend}`);
  headerLines.push(`-- Launch: ${launchId}`);
}

/**
 * Adapter: extract the LayoutOptions fields relevant to buildTreePlan into a
 * single authoritative place. Previously this was an inline object literal in
 * launchTreeLayout — any new plan-level option had to be manually added to that
 * literal. Extracting it here ensures a single edit point and makes the satisfies
 * guard visible to the compiler.
 *
 * #604 / #437 / #450 (closes AR-L1 #318): TreePlanOptions is now exported from
 * tree.ts — this adapter uses it directly instead of a hand-mirrored local type.
 * The `satisfies` guard provides compile-time exhaustiveness: if a new field is
 * added to TreePlanOptions without updating this adapter, tsc will fail here.
 *
 * The 4 "outer" script generator args (starshipConfigPath, envVars, projectName,
 * onStop) are assembled identically in both launchTreeLayout and launchTraditionalLayout
 * but kept per-pipeline — merging them would require changing generateAppleScript /
 * generateTreeAppleScript signatures and risks output changes.
 */
export function layoutOptsToTreePlanOpts(opts: Partial<LayoutOptions>): TreePlanOptions {
  return {
    autoResize: opts.autoResize,
    editorSize: opts.editorSize,
    fontSize: opts.fontSize,
    newWindow: opts.newWindow,
    newTab: opts.newTab,
    fullscreen: opts.fullscreen,
    maximize: opts.maximize,
    float: opts.float,
    cleanRestoredPanes: opts.cleanRestoredPanes,
  } satisfies TreePlanOptions;
}
/** Per-launch inputs shared by both layout paths. */
interface LaunchInputs {
  ctx: BackendLaunchContext;
  backend: TerminalBackend;
  launchContext: LaunchContext;
  dryRun: boolean;
  starshipPreset: string | undefined;
}

/**
 * Rex dry run (plan P2, Phase 2): the `session.create` request a real run would send, with
 * the pane order its `block_ids` arrive in on the header. A recorded Rex workspace is noted,
 * never switched to or probed: a dry run runs no Rex command.
 */
function rexDryRunBody(headerLines: string[], layout: SessionCreateInput["layout"], ctx: BackendLaunchContext, starshipConfigPath: string | null, server: string): string {
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
  headerLines.push(`-- Server: ${server}`);
  headerLines.push(`-- Pane order (block_ids): ${paneOrder.join(", ")}`);
  return JSON.stringify(request, null, 2);
}

/** Print the dry run: the layout headers, the shared extras, then what the detected backend would run. */
function printDryRun(
  headerLines: string[],
  layout: SessionCreateInput["layout"],
  { ctx, launchContext, starshipPreset }: LaunchInputs,
  ghosttyScript: (starshipConfigPath: string | null) => string,
): void {
  const starshipConfigPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
  appendDryRunExtras(headerLines, starshipPreset, starshipConfigPath, launchContext.backend, ctx.launchId);
  const body = launchContext.backend === "rex"
    ? rexDryRunBody(headerLines, layout, ctx, starshipConfigPath, launchContext.server)
    : ghosttyScript(starshipConfigPath);
  console.log(`${headerLines.join("\n")}\n${body}`);
  // Rex does not resolve commands before launch (plan D5), so only a Ghostty dry run checks them.
  if (launchContext.backend !== "rex") {
    for (const line of dryRunCommandNotes(layout)) note(line);
  }
}

/**
 * One line per executable a real Ghostty launch would not resolve, without prompting or
 * installing. A missing command with a known install method gets an install offer, not a stop.
 */
function dryRunCommandNotes(layout: PlannedLayout): string[] {
  const notes: string[] = [];
  const checked = new Set<string>();
  for (const { key, pane, command } of ghosttyCommandEntries(layout)) {
    const executable = commandExecutable(command);
    if (!executable || checked.has(executable)) continue;
    checked.add(executable);
    const check = checkCommand(executable);
    if ("resolved" in check) continue;
    const label = pane ? `pane \`${pane}\`` : `\`${key}\``;
    const outcome = check.install ? "a real launch offers to install it" : "a real launch stops here";
    notes.push(`${label}: \`${executable}\` ${COMMAND_FAILURE_REASONS[check.failure]}; ${outcome}.`);
  }
  return notes;
}

async function launchTreeLayout(
  treeLayout: NonNullable<ResolvedConfig["treeLayout"]>,
  opts: Partial<LayoutOptions>,
  inputs: LaunchInputs,
): Promise<LaunchedLayout> {
  const { ctx, backend, dryRun } = inputs;
  const resolvedTree = resolveTreeCmds(treeLayout.tree, treeLayout.panes, treeLayout.paneCwds, resolve(ctx.targetDir));
  const treePlan = buildTreePlan(resolvedTree, layoutOptsToTreePlanOpts(opts));

  if (dryRun) {
    const paneCount = treePlan.leaves.length;
    const headerLines = [
      "-- summon dry-run",
      `-- Layout: tree layout, ${paneCount} ${paneCount === 1 ? "pane" : "panes"}`,
      `-- Target: ${ctx.targetDir}`,
    ];
    printDryRun(headerLines, { kind: "tree", plan: treePlan }, inputs, (starshipConfigPath) =>
      generateTreeAppleScript(treePlan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId));
    return { paneNames: treePlan.leaves };
  }

  return { paneNames: treePlan.leaves, ...(await backend.launchTree(treePlan, ctx)) };
}

async function launchTraditionalLayout(
  opts: Partial<LayoutOptions>,
  inputs: LaunchInputs,
): Promise<LaunchedLayout> {
  const { ctx, backend, dryRun } = inputs;
  const plan = planLayout(opts);
  const paneNames = traditionalPaneNames(plan);

  if (dryRun) {
    const totalPanes = plan.leftColumnCount + plan.rightColumnEditorCount;
    const headerLines = [
      "-- summon dry-run",
      `-- Layout: ${totalPanes} editor ${totalPanes === 1 ? "pane" : "panes"}, editor=${plan.editor}, sidebar=${plan.sidebarCommand}, shell=${plan.hasShell}`,
      `-- Target: ${ctx.targetDir}`,
    ];
    printDryRun(headerLines, { kind: "traditional", plan }, inputs, (starshipConfigPath) =>
      generateAppleScript(plan, ctx.targetDir, starshipConfigPath, ctx.envVars, ctx.projectName, ctx.onStop, ctx.launchId));
    return { paneNames };
  }

  return { paneNames, ...(await backend.launchTraditional(plan, ctx)) };
}

type LaunchedLayout = { paneNames: string[] } & BackendLaunchResult;

/**
 * Plan P8: flags Rex cannot honor are deliberate limitations, one stderr line each. Only flags given on the
 * command line are named (UX-H1): the same keys in config are Ghostty preferences, silent under Rex like `clean=true`.
 */
export function rexLimitationNotices(overrides: CLIOverrides): string[] {
  return REX_UNHONORED_FLAGS
    .filter((flag) => (flag === "font-size" ? overrides[flag] !== undefined : overrides[flag] === "true"))
    .map((flag) => `Rex cannot honor ${flag}; ignored`);
}

/** A Ghostty launch over a live Rex session of the same project replaces the record; the session stays (plan §6). */
function warnRexStillRunning(project: string): void {
  const record = readStatusRecord(project);
  if (record?.backend !== "rex" || !record.rex) return;
  const binary = discoverRex().path;
  if (!binary) return;
  const state = sessionState(createRexCli(binary, record.rex.server), record.rex, project);
  if (isLiveState(state.state)) {
    note(`Rex session [${project}] ${record.rex.sessionId} is still running; rex kill ${record.rex.sessionId} closes it`);
  }
}

/**
 * Backend for this launch. A dry run executes nothing, so it keeps working on a machine
 * with neither terminal (CI, another terminal without Ghostty): it falls back to the Ghostty
 * generator with a notice instead of failing. A real launch fails naming both terminals.
 */
function resolveLaunchBackend(dryRun: boolean | undefined): LaunchContext {
  const detection = resolveBackendForLaunch();
  if (detection.ok) return detection;
  if (!dryRun) throw new Error(detection.reason);
  return { ok: true, backend: "ghostty", placement: "outside", notices: [...detection.notices, `${detection.reason} Dry run continues with the Ghostty script.`] };
}

/** What a launch did: created a workspace, switched to a live Rex one (P2), or printed a dry run. */
export type LaunchOutcome = "launched" | "switched" | "dry-run";

export async function launch(targetDir: string, cliOverrides?: CLIOverrides): Promise<LaunchOutcome> {
  // UX-L3: thrown errors are printed once, by the caller (reportError, `session --all`, the monitor).
  if (!existsSync(targetDir)) throw new Error(`Directory not found: ${targetDir}`);

  // Trust gate before any .summon value is used: one read, hashed and parsed from the same bytes.
  // SummonError is rethrown so callers (e.g. `session --all`) can choose to skip
  // an untrusted project and continue with the rest, instead of terminating the
  // whole process. The top-level direct-launch entry catches SummonError and
  // converts it to a clean exit 1 with the user-facing message.
  let config = resolveConfig(targetDir, cliOverrides ?? {}, readTrustedSummonFile(targetDir, cliOverrides ?? {}));

  // Backend seam (plan P15): resolve the backend right after config, before the wizard
  // redirect, the pane-count probe and on-start. The launch id is the generation every
  // per-launch artifact and the status record carry (P12).
  const launchId = newLaunchId();
  const launchContext = resolveLaunchBackend(cliOverrides?.dryRun);
  for (const notice of launchContext.notices) err(notice);
  const projectName = resolveProjectName(targetDir);
  const dryRun = cliOverrides?.dryRun === true;
  const callerSession = callerRexSession(launchContext);
  const newWindowFlag = cliOverrides?.["new-window"] === "true";
  const backend: TerminalBackend = launchContext.backend === "rex"
    ? createRexBackend(launchContext, { callerSession, newWindow: newWindowFlag })
    : GhosttyBackend;
  if (launchContext.backend === "rex" && !dryRun) {
    // D1: anything printed from here that the user must read keeps the launcher tab open.
    startLauncherTabWatch(launchContext);
    // P13 late adoption, then the P2 reuse decision: both before the wizard, the pane probe
    // and on-start, so a switch never reruns them. A dry run skips both (P2) and runs no Rex command.
    // A session the record's --new-window launch announced is not repeated on every launch (F12); status still names it.
    // PE-L1: one `rex ls` per server serves both steps. The backend's kept-session check runs after the wizard
    // and on-start, so it lists afresh rather than reuse a listing that may be minutes old.
    const listings = sessionListings();
    for (const notice of adoptOrphansForLaunch(projectName, adoptDeps(launchContext.rexBinary, listings))) note(notice.text, { routine: notice.routine === true });
    const decision = maybeSwitchToExisting(projectName, newWindowFlag, { cliFor: (server) => createRexCli(launchContext.rexBinary, server), callerSession, listings });
    if (decision.kind === "switched") {
      closeLauncherTabAfterRexLaunch(launchContext);
      return "switched";
    }
    if (decision.kind === "refused") {
      fail(decision.reason);
      process.exit(2);
    }
  }
  if (launchContext.backend === "ghostty" && !dryRun) warnRexStillRunning(projectName);

  // If no editor is configured from any source and this isn't a tree layout
  // (which defines its own pane commands), redirect to the setup wizard.
  if (!config.opts.editor && !config.treeLayout && !cliOverrides?.dryRun) {
    if (process.stdin.isTTY) {
      console.log("No editor configured. Let's set up your workspace.\n");
      const { runSetup } = await import("./setup.js");
      await runSetup({ backend: launchContext.backend });
      // Re-resolve config after setup saved new values. `.summon` is read and checked again (SE-M1):
      // the wizard can wait for minutes, and only bytes that pass the trust check are acted on.
      config = resolveConfig(targetDir, cliOverrides ?? {}, readTrustedSummonFile(targetDir, cliOverrides ?? {}));
    } else {
      throw new Error("No editor configured. Run `summon setup` interactively or use: summon set editor <command>");
    }
  }

  const { opts, machineConfig, starshipPreset, onStart, onStop, envVars, treeLayout } = config;

  if (await warnIfNested(opts, cliOverrides?.dryRun, launchContext.backend)) {
    // UX-L3: declining is a user cancel: exit 130, without an error line or the debug hint.
    throw new PromptCancelled("Launch aborted by user (nested workspace).");
  }
  if (launchContext.backend === "ghostty") {
    decideCleanRestoredPanes(opts, cliOverrides ?? {}, config.projectOverrides, machineConfig, cliOverrides?.dryRun, projectName);
  } else if (!dryRun) {
    for (const line of rexLimitationNotices(cliOverrides ?? {})) note(line);
  }

  let effectiveOnStart = onStart;
  let effectiveOnStop = onStop;

  if (!cliOverrides?.dryRun) {
    const resolvedCommands: Array<[string, string]> = [];
    const maybePush = (key: string, value: string | null | undefined) => {
      if (!value || value === "true" || value === "false") return;
      resolvedCommands.push([key, value]);
    };

    maybePush("editor", opts.editor);
    maybePush("sidebar", opts.sidebarCommand);
    maybePush("secondary-editor", opts.secondaryEditor);
    maybePush("shell", opts.shell);
    maybePush("on-start", onStart);
    maybePush("on-stop", onStop);
    if (treeLayout) {
      for (const paneName of collectLeaves(treeLayout.tree)) {
        const inlineCommand = findPaneByName(treeLayout.tree, paneName)?.command;
        maybePush(`pane.${paneName}`, inlineCommand || treeLayout.panes.get(paneName));
      }
    }

    const decision = await confirmDangerousCommands(resolvedCommands);
    const { skipped } = decision;

    // Apply skip decisions: remove skipped panes from layout (UX-S2 #340)
    if (skipped.size > 0) {
      if (skipped.has("editor")) opts.editor = undefined;
      if (skipped.has("sidebar")) opts.sidebarCommand = undefined;
      if (skipped.has("secondary-editor")) opts.secondaryEditor = undefined;
      if (skipped.has("shell")) opts.shell = undefined;
      if (skipped.has("on-start")) effectiveOnStart = undefined;
      if (skipped.has("on-stop")) effectiveOnStop = undefined;
      if (treeLayout) {
        for (const key of skipped) {
          if (key.startsWith("pane.")) {
            const paneName = key.slice(5);
            treeLayout.panes.set(paneName, "");
            const pane = findPaneByName(treeLayout.tree, paneName);
            if (pane) pane.command = "";
          }
        }
      }
    }
  }

  if (effectiveOnStart && !cliOverrides?.dryRun) {
    executeOnStart(effectiveOnStart, targetDir);
  }

  // SE-M1 (#595): surface on-stop command at launch time so users know it will run on exit.
  // on-stop is embedded in the AppleScript's EXIT trap and runs silently; a launch-time notice
  // makes the hook visible without requiring users to inspect the generated script.
  if (effectiveOnStop && !cliOverrides?.dryRun) {
    // UX-H1: repeated on every launch with a hook (from the user's own config or a `.summon` trusted by content hash; one
    // with shell metacharacters still gets the interactive warning), so it is routine for the D1 launcher-tab watch.
    note("on-stop will run on workspace exit.", { routine: true });
  }

  // Cache resolved command paths so the same binary is only looked up once
  const resolvedCache = new Map<string, string>();
  const ensureAndResolve = async (cmdString: string, configKey: string): Promise<string> => {
    const binary = commandExecutable(cmdString);
    if (!binary) {
      return cmdString;
    }

    const cached = resolvedCache.get(binary);
    if (cached) {
      return replaceCommandExecutable(cmdString, cached);
    }

    const resolvedBinary = await ensureCommand(binary, commandFixHint(configKey, treeLayout?.layoutName));
    resolvedCache.set(binary, resolvedBinary);
    return replaceCommandExecutable(cmdString, resolvedBinary);
  };

  const resolveStarship = (): string | null => {
    if (!starshipPreset) return null;
    if (isStarshipInstalled()) {
      try {
        return ensurePresetConfig(starshipPreset);
      } catch (error) {
        warn(`Failed to set up Starship preset "${starshipPreset}": ${getErrorMessage(error)}`);
      }
    } else {
      warn(`starship-preset is set to "${starshipPreset}" but Starship is not installed. Skipping.`);
      err("Install Starship: https://starship.rs");
    }
    return null;
  };

  const layoutLabel = treeLayout ? "custom" : (cliOverrides?.layout ?? "default");
  const inputs: LaunchInputs = {
    ctx: {
      targetDir,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      projectName,
      onStop: effectiveOnStop,
      launchId,
      layoutLabel,
      ensureAndResolve,
      resolveStarship,
    },
    backend,
    launchContext,
    dryRun: cliOverrides?.dryRun === true,
    starshipPreset,
  };
  const launched = treeLayout
    ? await launchTreeLayout(treeLayout, opts, inputs)
    : await launchTraditionalLayout(opts, inputs);

  // Write workspace status for monitoring features
  if (!cliOverrides?.dryRun) {
    const status: WorkspaceStatus = {
      project: projectName,
      directory: resolve(targetDir),
      pid: process.pid,
      startedAt: new Date().toISOString(),
      layout: layoutLabel,
      panes: launched.paneNames,
      ...(launched.native ? { native: launched.native } : {}),
      source: "summon",
      version: 1,
      launchId,
      backend: backend.id,
      ...(launched.rex ? { rex: launched.rex } : {}),
    };

    // A user-initiated launch always publishes (expectation "replace", plan P12); a failed write
    // discards only the record observed under the publication's own lock.
    const published = publishStatus(status);
    if (published === "discarded") {
      err("summon: warning: workspace launched, but status could not be saved; exact targeting is unavailable. Check config directory permissions and run summon doctor.");
    } else if (published === "unsaved") {
      err("summon: warning: workspace launched, but status could not be saved or invalidated. Previous metadata may remain and target an older workspace; select manually in Ghostty, repair config directory permissions and run summon doctor before using exact commands.");
    }
  }
  if (!dryRun) closeLauncherTabAfterRexLaunch(launchContext);
  return dryRun ? "dry-run" : "launched";
}
