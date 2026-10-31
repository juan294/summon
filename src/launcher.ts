import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execSync } from "node:child_process";
import { planLayout, traditionalPaneNames } from "./layout.js";
import type { LayoutOptions } from "./layout.js";
import { listProjects } from "./config.js";
import { readTrustedSummonFile, resolveConfig } from "./config-resolve.js";
import type { CLIOverrides, ResolvedConfig } from "./config-resolve.js";
import { publishStatus, readStatusRecord } from "./status-record.js";
import type { WorkspaceStatus } from "./status-record.js";
import { newLaunchId } from "./launch-identity.js";
import { resolveBackendForLaunch } from "./backend.js";
import type { BackendId, LaunchContext } from "./backend.js";
import type { BackendLaunchResult, LaunchDecision, TerminalBackend } from "./backends/port.js";
import { createTerminalBackend } from "./backends/select.js";
import { markAttention } from "./ui/attention.js";
import { resolveTreeCommands as resolveTreeCmds, buildTreePlan, collectLeaves, findPaneByName } from "./tree.js";
import type { TreePlanOptions } from "./tree.js";
import { getErrorMessage, SUMMON_WORKSPACE_ENV, promptUser, isDebug, PromptCancelled } from "./utils.js";
import { commandFixHint, ensureCommand } from "./command-install.js";
import { printTraditionalDryRun, printTreeDryRun } from "./dry-run.js";
import type { DryRunInputs } from "./dry-run.js";
import { fail, err, note, warn } from "./ui/output.js";
import { confirmDangerousCommands } from "./launch-guards.js";
import { PROJECT_NAME_RE, sanitizeProjectName } from "./validation.js";
import { isStarshipInstalled, ensurePresetConfig } from "./starship.js";
// command-spec is a pure utility module with no imports from this file.
// Dependency direction: launcher -> command-spec (one-way, no circular risk).
import { commandExecutable, replaceCommandExecutable } from "./command-spec.js";

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

/**
 * Warn the user if they're launching from inside an existing summon workspace.
 * Returns true if the user chose to abort.
 */
async function warnIfNested(
  opts: Partial<LayoutOptions>,
  dryRun: boolean | undefined,
  backend: TerminalBackend,
): Promise<boolean> {
  // Only a backend that splits the caller's window can nest (a Rex launch creates its own session, F14).
  if (!backend.splitsCallerWindow || !process.env[SUMMON_WORKSPACE_ENV] || opts.newWindow || dryRun || !process.stdin.isTTY) {
    return false;
  }
  warn("You're inside an existing summon workspace.");
  err("Launching here will nest splits inside this pane, which can get messy.");
  err("Tip: Use --new-window to open in a separate window instead.\n");
  const answer = (await promptUser("Continue anyway? [y/N] ")).toLowerCase();
  return answer !== "y";
}

// The Ghostty pane-count probe and restored-pane decision moved to backends/ghostty.ts (AR-M1); re-exported for callers.
export { decideCleanRestoredPanes, probePaneCount } from "./backends/ghostty.js";

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
interface LaunchInputs extends DryRunInputs {
  dryRun: boolean;
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
    printTreeDryRun(treePlan, inputs);
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
    printTraditionalDryRun(plan, inputs);
    return { paneNames };
  }

  return { paneNames, ...(await backend.launchTraditional(plan, ctx)) };
}

type LaunchedLayout = { paneNames: string[] } & BackendLaunchResult;

/**
 * A launch over a live workspace of another backend replaces the record; that workspace stays (plan §6), and its
 * backend says so. The record backend is loaded only when such a record exists.
 */
async function noteOtherBackendStillRunning(project: string, backend: BackendId): Promise<void> {
  const record = readStatusRecord(project);
  if (!record || (record.backend ?? "ghostty") === backend) return;
  const { workspaceBackendFor } = await import("./backends/workspace.js");
  const notice = workspaceBackendFor(record.backend).stillRunningNotice(project, record);
  if (notice) note(notice);
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
  const backend: TerminalBackend = createTerminalBackend(launchContext, { newWindow: cliOverrides?.["new-window"] === "true" });
  if (!dryRun) {
    // A dry run skips this (P2) and runs no backend command. Rex: late adoption and the P2 switch, before the wizard,
    // the pane probe and on-start, so a switch never reruns them.
    const decision: LaunchDecision = backend.beforeLaunch?.(projectName) ?? { kind: "proceed" };
    if (decision.kind === "switched") {
      backend.afterSuccess?.();
      return "switched";
    }
    if (decision.kind === "refused") {
      fail(decision.reason);
      process.exit(2);
    }
    await noteOtherBackendStillRunning(projectName, backend.id);
  }

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

  if (await warnIfNested(opts, cliOverrides?.dryRun, backend)) {
    // UX-L3: declining is a user cancel: exit 130, without an error line or the debug hint.
    throw new PromptCancelled("Launch aborted by user (nested workspace).");
  }
  // Ghostty: the restored-pane probe (decideCleanRestoredPanes); Rex: one P8 notice per flag it cannot honor.
  backend.applyLaunchOptions({ opts, overrides: cliOverrides ?? {}, projectConfig: config.projectOverrides, machineConfig, dryRun, projectName });

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
    dryRun: cliOverrides?.dryRun === true,
    starshipPreset,
  };
  // The backend launch and the status publication. A dry run prints instead and publishes nothing.
  const createAndPublish = async (): Promise<void> => {
    const launched = treeLayout
      ? await launchTreeLayout(treeLayout, opts, inputs)
      : await launchTraditionalLayout(opts, inputs);
    if (dryRun) return;

    // Write workspace status for monitoring features
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
  };

  if (dryRun) {
    await createAndPublish();
    return "dry-run";
  }
  // BE-L1: a backend may serialize creation and publication per project (Rex), after every prompt and on-start; under
  // its lock it can find that a concurrent launch won and switch to that workspace instead.
  const decision: LaunchDecision = backend.exclusiveLaunch
    ? await backend.exclusiveLaunch(projectName, createAndPublish)
    : (await createAndPublish(), { kind: "proceed" });
  if (decision.kind === "refused") {
    fail(decision.reason);
    process.exit(2);
  }
  backend.afterSuccess?.();
  return decision.kind === "switched" ? "switched" : "launched";
}
