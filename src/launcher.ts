import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import {
  planLayout,
  isPresetName,
  getPresetNames,
  getPreset,
  PANES_MIN,
  PANES_DEFAULT,
  EDITOR_SIZE_MIN,
  EDITOR_SIZE_MAX,
  EDITOR_SIZE_DEFAULT,
} from "./layout.js";
import type { LayoutOptions } from "./layout.js";
import { listConfig, listProjects, readKVFile, readKVFromString, readCustomLayout, isCustomLayout, LAYOUT_NAME_RE } from "./config.js";
import { writeStatus } from "./status.js";
import type { WorkspaceStatus } from "./status.js";
import { generateAppleScript, generateTreeAppleScript, generateFocusScript } from "./script.js";
import { parseTreeDSL, extractPaneDefinitions, extractPaneCwds, resolveTreeCommands as resolveTreeCmds, buildTreePlan, findPaneByName } from "./tree.js";
import type { LayoutNode } from "./tree.js";
import { resolveCommand as resolveCommandPath, getErrorMessage, SUMMON_WORKSPACE_ENV, promptUser, ACCESSIBILITY_SETTINGS_PATH, isDebug } from "./utils.js";
import { ensureGhostty, ensureAccessibility, printAccessibilityHint, confirmDangerousCommands, isAccessibilityError } from "./launch-guards.js";
import { assertTrusted, assertTrustedContent } from "./trust.js";
import { parseIntInRange, parsePositiveFloat, ENV_KEY_RE, PROJECT_NAME_RE, sanitizeProjectName } from "./validation.js";
import { isStarshipInstalled, ensurePresetConfig, getPresetConfigPath } from "./starship.js";
// command-spec is a pure utility module with no imports from this file.
// Dependency direction: launcher -> command-spec (one-way, no circular risk).
import { commandExecutable, replaceCommandExecutable } from "./command-spec.js";
import { TabOpenError } from "./errors.js";

/** Convert resolved layout options to a key-value config map suitable for saving as a custom layout. */
export function optsToConfigMap(opts: Partial<LayoutOptions>): Map<string, string> {
  const entries = new Map<string, string>();
  if (opts.editor) entries.set("editor", opts.editor);
  if (opts.sidebarCommand) entries.set("sidebar", opts.sidebarCommand);
  if (opts.secondaryEditor) entries.set("secondary-editor", opts.secondaryEditor);
  if (opts.editorPanes !== undefined) entries.set("panes", String(opts.editorPanes));
  if (opts.editorSize !== undefined) entries.set("editor-size", String(opts.editorSize));
  if (opts.shell !== undefined) entries.set("shell", opts.shell);
  if (opts.autoResize !== undefined) entries.set("auto-resize", String(opts.autoResize));
  if (opts.fontSize !== undefined && opts.fontSize !== null) entries.set("font-size", String(opts.fontSize));
  if (opts.newWindow) entries.set("new-window", "true");
  if (opts.newTab) entries.set("new-tab", "true");
  if (opts.fullscreen) entries.set("fullscreen", "true");
  if (opts.maximize) entries.set("maximize", "true");
  if (opts.float) entries.set("float", "true");
  return entries;
}

export interface CLIOverrides {
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  shell?: string;
  "auto-resize"?: string;
  "starship-preset"?: string;
  env?: string[];
  "font-size"?: string;
  "on-start"?: string;
  "new-window"?: string;
  "new-tab"?: string;
  "no-project-config"?: string;
  fullscreen?: string;
  maximize?: string;
  float?: string;
  dryRun?: boolean;
  clean?: string;
}

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
  console.warn(
    `Project name "${derived}" contains unsupported characters; using "${sanitized}" for tab title and status tracking.`,
  );
  return sanitized;
}

/** Attempt to focus an existing Ghostty workspace by activating Ghostty. */
export function focusWorkspace(projectName: string): boolean {
  const script = generateFocusScript(`[${projectName}]`);
  try {
    execFileSync("osascript", [], { input: script, encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}


async function prompt(question: string): Promise<string> {
  const answer = await promptUser(question);
  return answer.toLowerCase();
}

/**
 * Best-effort rollback: close the Ghostty front window that was opened by a
 * failed script execution (BE-S26 #322).
 * Silently ignored if Ghostty is not running or the window is already gone.
 */
export function closeWorkspaceWindow(): void {
  const closeScript = `tell application "Ghostty"
  if (count of windows) > 0 then
    close front window
  end if
end tell`;
  try {
    execFileSync("osascript", [], { input: closeScript, encoding: "utf-8" });
  } catch {
    // Silently ignore — rollback is best-effort
  }
}

function executeScript(script: string, targetLabel?: string): void {
  // FE-M5/UX-M6: progress messages go to stderr so pipelines (e.g. summon export > .summon) are not polluted.
  // UX-M1 (#600): subtle summoning voice on the main launch progress line.
  process.stderr.write(`Summoning ${targetLabel ?? "workspace"}…\n`);
  try {
    execFileSync("osascript", [], { input: script, encoding: "utf-8", timeout: 30_000 });
    process.stderr.write("✓ Workspace ready.\n");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      console.error("Ghostty did not respond within 30 seconds. Is Ghostty running?");
      throw new Error("Ghostty did not respond within 30 seconds. Is Ghostty running?", { cause: err });
    }

    const message = getErrorMessage(err);
    console.error(`summon: error: failed to execute workspace script: ${message}`);

    // A verified keystroke failure means NO new tab/window was created — the existing
    // front window is intact, so DO NOT run the rollback that would close it.
    if (message.includes("summon-newtab-failed")) {
      console.error("Ghostty did not open a new tab after multiple attempts.");
      throw new TabOpenError("Ghostty did not open a new tab.", { cause: err });
    }
    if (message.includes("summon-newwindow-failed")) {
      const m = "Ghostty did not open a new window after multiple attempts.";
      console.error(m);
      throw new Error(m, { cause: err });
    }

    // Best-effort rollback: the AppleScript may have opened a window before failing.
    // Attempt to close it so the user is not left with a stale empty window (BE-S26 #322).
    // Skip rollback for accessibility errors — osascript couldn't run at all,
    // so no window was created (BE-M3 #377).
    if (!isAccessibilityError(message)) {
      closeWorkspaceWindow();
    }

    if (isAccessibilityError(message)) {
      console.error();
      printAccessibilityHint();
    } else {
      console.error();
      console.error("Is Ghostty running? Also check:");
      console.error(`  - ${ACCESSIBILITY_SETTINGS_PATH}`);
      console.error("  - System Settings > Privacy & Security > Automation");
      console.error();
      console.error("Tip: Run 'summon doctor' to diagnose issues.");
    }
    throw new Error(`Failed to execute workspace script: ${message}`, { cause: err });
  }
}



const KNOWN_INSTALL_COMMANDS: Record<string, () => [string, string[]] | null> = {
  claude: () => ["npm", ["install", "-g", "@anthropic-ai/claude-code"]],
  lazygit: () => {
    try {
      execFileSync("/bin/sh", ["-c", "command -v brew"], { stdio: "ignore" });
      return ["brew", ["install", "lazygit"]];
    } catch {
      return null;
    }
  },
};

async function ensureCommand(cmd: string, configKey: string): Promise<string> {
  const resolved = resolveCommandPath(cmd);
  if (resolved) return resolved;

  const getInstall = KNOWN_INSTALL_COMMANDS[cmd];
  const installCmd = getInstall ? getInstall() : null;

  if (!installCmd) {
    console.error(
      `\`${cmd}\` is required but not installed, and no known install method was found.`,
    );
    console.error(
      `Please install \`${cmd}\` manually or change your config with: summon set ${configKey} <command>`,
    );
    throw new Error(`\`${cmd}\` is required but not installed.`);
  }

  const [installBin, installArgs] = installCmd;
  const installDisplay = [installBin, ...installArgs].join(" ");

  console.log(`\`${cmd}\` is not installed on this machine.`);
  const answer = await prompt(`Install it now with \`${installDisplay}\`? [y/N] `);

  if (answer !== "y" && answer !== "yes") {
    console.log(`Exiting — \`${cmd}\` is needed for this workspace layout. Change it with: summon set ${configKey} <command>`);
    throw new Error(`\`${cmd}\` is needed for this workspace layout.`);
  }

  console.log(`Running: ${installDisplay}`);
  try {
    execFileSync(installBin, installArgs, { stdio: "inherit" });
  } catch {
    console.error(
      `Failed to install \`${cmd}\`. Please install it manually and try again.`,
    );
    throw new Error(`Failed to install \`${cmd}\`.`);
  }

  const postInstallPath = resolveCommandPath(cmd);
  if (!postInstallPath) {
    console.error(`\`${cmd}\` still not found after install. Please check your PATH.`);
    throw new Error(`\`${cmd}\` still not found after install.`);
  }

  console.log(`\`${cmd}\` installed successfully!\n`);
  return postInstallPath;
}

interface ResolvedConfig {
  opts: Partial<LayoutOptions>;
  projectOverrides: Map<string, string>;
  machineConfig: Map<string, string>;
  starshipPreset?: string;
  onStart?: string;
  onStop?: string;
  envVars: Record<string, string>;
  treeLayout?: {
    tree: LayoutNode;
    panes: Map<string, string>;
    paneCwds?: Map<string, string>;
  };
}

/**
 * Denylisted env var key prefixes and exact names that could be used for
 * code injection via dynamic linkers, shell hooks, or interpreter startup files.
 */
const ENV_DENYLIST_PREFIXES = ["DYLD_", "LD_"];
const ENV_DENYLIST_EXACT = new Set([
  "NODE_OPTIONS",
  "BASH_ENV",
  "PYTHONSTARTUP",
  "PROMPT_COMMAND",
  "CDPATH",
  "IFS",
]);

function isDenylisted(envKey: string): boolean {
  if (ENV_DENYLIST_EXACT.has(envKey)) return true;
  return ENV_DENYLIST_PREFIXES.some((prefix) => envKey.startsWith(prefix));
}

function collectEnvVars(
  machineConfig: Map<string, string>,
  projectConfig: Map<string, string>,
  cliEnvFlags: string[] | undefined,
): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Machine config (lowest priority)
  for (const [key, value] of machineConfig) {
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      if (isDenylisted(envKey)) {
        console.warn(`Warning: ignoring denylisted env var key "${envKey}" from machine config.`);
      } else if (ENV_KEY_RE.test(envKey)) {
        envVars[envKey] = value;
      }
    }
  }

  // Project config (overrides machine)
  for (const [key, value] of projectConfig) {
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      if (isDenylisted(envKey)) {
        console.warn(`Warning: ignoring denylisted env var key "${envKey}" from .summon file.`);
      } else if (ENV_KEY_RE.test(envKey)) {
        envVars[envKey] = value;
      } else {
        console.warn(`Warning: ignoring invalid env var key "${envKey}" from .summon file.`);
      }
    }
  }

  // CLI flags (highest priority)
  if (cliEnvFlags) {
    for (const entry of cliEnvFlags) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx > 0) {
        const envKey = entry.slice(0, eqIdx);
        if (isDenylisted(envKey)) {
          console.warn(`Warning: ignoring denylisted env var key "${envKey}" from --env flag.`);
        } else if (ENV_KEY_RE.test(envKey)) {
          envVars[envKey] = entry.slice(eqIdx + 1);
        } else {
          console.warn(`Warning: ignoring invalid env var key "${envKey}" from --env flag.`);
        }
      }
    }
  }

  return envVars;
}

/**
 * Pick a config value with priority: CLI > project > global.
 * Empty strings in project or machine config are treated as "not set" — they
 * do not override preset or default values. This preserves the intent that an
 * empty config key means "use the default".
 *
 * Note: To distinguish "explicitly set to empty" from "not present" in project
 * config, callers that need that distinction should use `project.has(key)` directly.
 */
function pickConfigValue(
  cli: string | undefined,
  projKey: string,
  project: Map<string, string>,
  machineConfig: Map<string, string>,
): string | undefined {
  if (cli !== undefined) return cli;
  return project.get(projKey) || machineConfig.get(projKey) || undefined;
}

/**
 * Resolve the layout key to a base LayoutOptions partial and optional tree layout.
 * Handles: preset lookup, custom layout loading, tree expression parsing.
 */
function resolveLayoutBase(
  layoutKey: string | undefined,
): { base: Partial<LayoutOptions>; treeLayout?: ResolvedConfig["treeLayout"] } {
  if (!layoutKey) return { base: {} };

  if (isPresetName(layoutKey)) {
    return { base: getPreset(layoutKey) };
  }

  if (LAYOUT_NAME_RE.test(layoutKey) && isCustomLayout(layoutKey)) {
    const customData = readCustomLayout(layoutKey);
    if (!customData) return { base: {} };

    const base: Partial<LayoutOptions> = {};
    if (customData.has("editor-size")) {
      const es = parseIntInRange(customData.get("editor-size")!, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
      if (es.ok) {
        base.editorSize = es.value;
      } else {
        console.warn(
          `Invalid editor-size value in custom layout "${layoutKey}": "${customData.get("editor-size")}". Must be ${EDITOR_SIZE_MIN}-${EDITOR_SIZE_MAX}. Using default (${EDITOR_SIZE_DEFAULT}).`,
        );
      }
    }
    if (customData.has("auto-resize")) base.autoResize = customData.get("auto-resize") === "true";
    if (customData.has("font-size")) {
      const fs = parsePositiveFloat(customData.get("font-size")!);
      if (fs.ok) {
        base.fontSize = fs.value;
      } else {
        console.warn(
          `Invalid font-size value in custom layout "${layoutKey}": "${customData.get("font-size")}". Must be a positive number. Ignoring.`,
        );
      }
    }
    if (customData.has("new-window")) base.newWindow = customData.get("new-window") === "true";
    if (customData.has("new-tab")) base.newTab = customData.get("new-tab") === "true";
    if (customData.has("fullscreen")) base.fullscreen = customData.get("fullscreen") === "true";
    if (customData.has("maximize")) base.maximize = customData.get("maximize") === "true";
    if (customData.has("float")) base.float = customData.get("float") === "true";

    const treeExpr = customData.get("tree");
    if (treeExpr) {
      const tree = parseTreeDSL(treeExpr);
      const panes = extractPaneDefinitions(customData);
      const paneCwds = extractPaneCwds(customData);
      return { base, treeLayout: { tree, panes, paneCwds: paneCwds.size > 0 ? paneCwds : undefined } };
    }

    // Traditional custom layout (no tree= key)
    if (customData.has("editor")) base.editor = customData.get("editor");
    if (customData.has("sidebar")) base.sidebarCommand = customData.get("sidebar");
    if (customData.has("secondary-editor")) base.secondaryEditor = customData.get("secondary-editor");
    if (customData.has("panes")) {
      const p = parseIntInRange(customData.get("panes")!, PANES_MIN);
      if (p.ok) {
        base.editorPanes = p.value;
      } else {
        console.warn(
          `Invalid panes value in custom layout "${layoutKey}": "${customData.get("panes")}". Must be a positive integer. Ignoring.`,
        );
      }
    }
    if (customData.has("shell")) base.shell = customData.get("shell");
    return { base };
  }

  console.warn(
    `Unknown layout preset: "${layoutKey}". Valid presets: ${getPresetNames().join(", ")}. Using defaults.`,
  );
  return { base: {} };
}

/**
 * Layer config values: CLI overrides > project > global config > base preset.
 * Returns merged Partial<LayoutOptions>.
 */
function layerConfigValues(
  base: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  project: Map<string, string>,
  machineConfig: Map<string, string>,
): Partial<LayoutOptions> {
  const pick = (cli: string | undefined, projKey: string) =>
    pickConfigValue(cli, projKey, project, machineConfig);

  const editor = pick(cliOverrides.editor, "editor");
  const sidebar = pick(cliOverrides.sidebar, "sidebar");
  const secondaryEditor = pick(undefined, "secondary-editor");
  const panes = pick(cliOverrides.panes, "panes");
  const editorSize = pick(cliOverrides["editor-size"], "editor-size");
  const shell = pick(cliOverrides.shell, "shell");
  const autoResize = pick(cliOverrides["auto-resize"], "auto-resize");

  const result: Partial<LayoutOptions> = { ...base };
  if (editor !== undefined) result.editor = editor;
  if (sidebar !== undefined) result.sidebarCommand = sidebar;
  if (secondaryEditor !== undefined) result.secondaryEditor = secondaryEditor;
  if (panes !== undefined) {
    const parsed = parseIntInRange(panes, PANES_MIN);
    if (parsed.ok) {
      result.editorPanes = parsed.value;
    } else {
      console.warn(
        `Invalid panes value: "${panes}". Must be a positive integer. Using default (${PANES_DEFAULT}).`,
      );
      result.editorPanes = PANES_DEFAULT;
    }
  }
  if (editorSize !== undefined) {
    const parsed = parseIntInRange(editorSize, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
    if (parsed.ok) {
      result.editorSize = parsed.value;
    } else {
      console.warn(
        `Invalid editor-size value: "${editorSize}". Must be ${EDITOR_SIZE_MIN}-${EDITOR_SIZE_MAX}. Using default (${EDITOR_SIZE_DEFAULT}).`,
      );
      result.editorSize = EDITOR_SIZE_DEFAULT;
    }
  }
  if (shell !== undefined) result.shell = shell;
  if (autoResize !== undefined) result.autoResize = autoResize === "true";

  const fontSize = pick(cliOverrides["font-size"], "font-size");
  if (fontSize !== undefined) {
    const parsed = parsePositiveFloat(fontSize);
    if (parsed.ok) {
      result.fontSize = parsed.value;
    }
  }

  const newWindow = pick(cliOverrides["new-window"], "new-window");
  const newTab = pick(cliOverrides["new-tab"], "new-tab");
  const fullscreen = pick(cliOverrides.fullscreen, "fullscreen");
  const maximize = pick(cliOverrides.maximize, "maximize");
  const float = pick(cliOverrides.float, "float");
  if (newWindow !== undefined) result.newWindow = newWindow === "true";
  if (newTab !== undefined) result.newTab = newTab === "true";
  if (fullscreen !== undefined) result.fullscreen = fullscreen === "true";
  if (maximize !== undefined) result.maximize = maximize === "true";
  if (float !== undefined) result.float = float === "true";

  return result;
}

export function resolveConfig(targetDir: string, cliOverrides: CLIOverrides, summonFileContent?: string): ResolvedConfig {
  const projectConfigPath = join(targetDir, ".summon");
  const skipProjectConfig = cliOverrides["no-project-config"] === "true";
  // Use pre-read content if provided (TOCTOU prevention, BE-B2 #357);
  // fall back to reading from disk (e.g. when called without pre-read content).
  const project = skipProjectConfig
    ? new Map<string, string>()
    : summonFileContent !== undefined
      ? readKVFromString(summonFileContent)
      : readKVFile(projectConfigPath);
  if (project.size > 0) {
    console.log(`Using project config: ${projectConfigPath}`);
  }
  const machineConfig = listConfig();

  const layoutKey = cliOverrides.layout ?? project.get("layout") ?? machineConfig.get("layout");
  const { base, treeLayout } = resolveLayoutBase(layoutKey);
  const opts = layerConfigValues(base, cliOverrides, project, machineConfig);

  const starshipPreset = pickConfigValue(cliOverrides["starship-preset"], "starship-preset", project, machineConfig);
  const onStart = pickConfigValue(cliOverrides["on-start"], "on-start", project, machineConfig);
  const onStop = pickConfigValue(undefined, "on-stop", project, machineConfig);
  const envVars = collectEnvVars(machineConfig, project, cliOverrides.env);

  // Merge per-pane cwds from project config into treeLayout (project overrides layout defaults)
  let mergedTreeLayout = treeLayout;
  if (mergedTreeLayout) {
    const projectCwds = extractPaneCwds(project);
    if (projectCwds.size > 0) {
      const merged = new Map(mergedTreeLayout.paneCwds ?? []);
      for (const [k, v] of projectCwds) merged.set(k, v);
      mergedTreeLayout = { ...mergedTreeLayout, paneCwds: merged };
    }
  }

  return { opts, projectOverrides: project, machineConfig, starshipPreset, onStart, onStop, envVars, treeLayout: mergedTreeLayout };
}

/**
 * Warn the user if they're launching from inside an existing summon workspace.
 * Returns true if the user chose to abort.
 */
async function warnIfNested(
  opts: Partial<LayoutOptions>,
  dryRun: boolean | undefined,
): Promise<boolean> {
  if (!process.env[SUMMON_WORKSPACE_ENV] || opts.newWindow || dryRun || !process.stdin.isTTY) {
    return false;
  }
  console.warn("Warning: You're inside an existing summon workspace.");
  console.warn("Launching here will nest splits inside this pane, which can get messy.");
  console.warn("Tip: Use --new-window to open in a separate window instead.\n");
  const answer = await prompt("Continue anyway? [y/N] ");
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
  // pane env (which is scrubbed by ENV_DENYLIST_PREFIXES/ENV_DENYLIST_EXACT above).
  if (isDebug()) {
    process.stderr.write(`[debug] Running on-start: ${onStart}\n`);
  }
  try {
    execSync(onStart, { cwd: targetDir, encoding: "utf-8", stdio: "inherit" });
  } catch (err) {
    const message = `on-start command failed: ${onStart} — ${getErrorMessage(err)}`;
    console.error(message);
    throw new Error(message, { cause: err });
  }
}

/** Append shared optional dry-run header lines (starship preset). */
function appendDryRunExtras(
  headerLines: string[],
  starshipPreset: string | undefined,
  dryRunStarshipPath: string | null,
): void {
  if (starshipPreset) {
    headerLines.push(`-- Starship preset: ${starshipPreset} (${dryRunStarshipPath})`);
  }
}

// TODO(AR-L1 #318): launchTreeLayout and launchTraditionalLayout are parallel pipelines that
// both map LayoutOptions fields onto their respective plan/script generators. Any new layout
// option must be added to both functions independently, which is fragile. Consider unifying
// into a single options-to-plan adapter to eliminate this duplication.
async function launchTreeLayout(
  treeLayout: NonNullable<ResolvedConfig["treeLayout"]>,
  opts: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  targetDir: string,
  starshipPreset: string | undefined,
  envVars: Record<string, string>,
  ensureAndResolve: (cmd: string, key: string) => Promise<string>,
  resolveStarship: () => string | null,
  projectName?: string,
  onStop?: string,
): Promise<string[]> {
  const resolvedTree = resolveTreeCmds(treeLayout.tree, treeLayout.panes, treeLayout.paneCwds, resolve(targetDir));
  const treePlanOpts = {
    autoResize: opts.autoResize,
    editorSize: opts.editorSize,
    fontSize: opts.fontSize,
    newWindow: opts.newWindow,
    newTab: opts.newTab,
    fullscreen: opts.fullscreen,
    maximize: opts.maximize,
    float: opts.float,
    cleanRestoredPanes: opts.cleanRestoredPanes,
  };
  const treePlan = buildTreePlan(resolvedTree, treePlanOpts);
  const hasEnvVars = Object.keys(envVars).length > 0;

  if (cliOverrides.dryRun) {
    const dryRunStarshipPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
    const script = generateTreeAppleScript(treePlan, targetDir, dryRunStarshipPath, hasEnvVars ? envVars : undefined, projectName, onStop);
    const paneCount = treePlan.leaves.length;
    const headerLines = [
      "-- summon dry-run",
      `-- Layout: tree layout, ${paneCount} ${paneCount === 1 ? "pane" : "panes"}`,
      `-- Target: ${targetDir}`,
    ];
    appendDryRunExtras(headerLines, starshipPreset, dryRunStarshipPath);
    console.log(`${headerLines.join("\n")}\n${script}`);
    return treePlan.leaves;
  }

  ensureGhostty();
  ensureAccessibility();

  for (const leafName of treePlan.leaves) {
    const pane = findPaneByName(resolvedTree, leafName);
    if (pane?.command) {
      pane.command = await ensureAndResolve(pane.command, leafName);
    }
  }

  const starshipConfigPath = resolveStarship();
  const script = generateTreeAppleScript(treePlan, targetDir, starshipConfigPath, hasEnvVars ? envVars : undefined, projectName, onStop);
  executeScript(script, projectName);
  return treePlan.leaves;
}

/** Extract pane names from a traditional LayoutPlan. */
export function traditionalPaneNames(plan: { sidebarCommand: string; leftColumnCount: number; rightColumnEditorCount: number; hasShell: boolean }): string[] {
  const names = ["editor"];
  if (plan.sidebarCommand) names.push("sidebar");
  for (let i = 1; i < plan.leftColumnCount; i++) names.push(`editor-${i + 1}`);
  for (let i = 0; i < plan.rightColumnEditorCount; i++) names.push(`right-${i + 1}`);
  if (plan.hasShell) names.push("shell");
  return names;
}

async function launchTraditionalLayout(
  opts: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  targetDir: string,
  starshipPreset: string | undefined,
  envVars: Record<string, string>,
  ensureAndResolve: (cmd: string, key: string) => Promise<string>,
  resolveStarship: () => string | null,
  projectName?: string,
  onStop?: string,
): Promise<string[]> {
  const plan = planLayout(opts);
  const hasEnvVars = Object.keys(envVars).length > 0;
  const paneNames = traditionalPaneNames(plan);

  if (cliOverrides.dryRun) {
    const dryRunStarshipPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
    const script = generateAppleScript(plan, targetDir, dryRunStarshipPath, hasEnvVars ? envVars : undefined, projectName, onStop);
    const totalPanes = plan.leftColumnCount + plan.rightColumnEditorCount;
    const headerLines = [
      "-- summon dry-run",
      `-- Layout: ${totalPanes} editor ${totalPanes === 1 ? "pane" : "panes"}, editor=${plan.editor}, sidebar=${plan.sidebarCommand}, shell=${plan.hasShell}`,
      `-- Target: ${targetDir}`,
    ];
    appendDryRunExtras(headerLines, starshipPreset, dryRunStarshipPath);
    console.log(`${headerLines.join("\n")}\n${script}`);
    return paneNames;
  }

  ensureGhostty();
  ensureAccessibility();

  if (plan.editor) plan.editor = await ensureAndResolve(plan.editor, "editor");
  if (plan.sidebarCommand) plan.sidebarCommand = await ensureAndResolve(plan.sidebarCommand, "sidebar");
  if (plan.secondaryEditor) plan.secondaryEditor = await ensureAndResolve(plan.secondaryEditor, "editor");
  if (plan.shellCommand) plan.shellCommand = await ensureAndResolve(plan.shellCommand, "shell");

  const starshipConfigPath = resolveStarship();
  const script = generateAppleScript(plan, targetDir, starshipConfigPath, hasEnvVars ? envVars : undefined, projectName, onStop);
  executeScript(script, projectName);
  return paneNames;
}

export async function launch(targetDir: string, cliOverrides?: CLIOverrides): Promise<void> {
  if (!existsSync(targetDir)) {
    const msg = `summon: error: Directory not found: ${targetDir}`;
    console.error(msg);
    throw new Error(msg);
  }

  // Read .summon once for both trust verification and config parsing (BE-B2 #357).
  // This eliminates the TOCTOU window between hashing and re-reading.
  const summonFilePath = join(targetDir, ".summon");
  let summonFileContent: string | undefined;
  if (existsSync(summonFilePath)) {
    try {
      summonFileContent = readFileSync(summonFilePath, "utf-8");
    } catch {
      summonFileContent = undefined;
    }
  }

  // Trust gate: verify the .summon file (if present) is explicitly trusted before
  // reading or acting on any of its values (BE-B1, BE-B2, SE-H1).
  // SummonError is rethrown so callers (e.g. `session --all`) can choose to skip
  // an untrusted project and continue with the rest, instead of terminating the
  // whole process. The top-level direct-launch entry catches SummonError and
  // converts it to a clean exit 1 with the user-facing message.
  if (cliOverrides?.["no-project-config"] === "true") {
    // skip trust check
  } else if (summonFileContent !== undefined) {
    assertTrustedContent(targetDir, summonFileContent);
  } else {
    assertTrusted(targetDir);
  }

  let config: ReturnType<typeof resolveConfig>;
  config = resolveConfig(targetDir, cliOverrides ?? {}, summonFileContent);

  // If no editor is configured from any source and this isn't a tree layout
  // (which defines its own pane commands), redirect to the setup wizard.
  if (!config.opts.editor && !config.treeLayout && !cliOverrides?.dryRun) {
    if (process.stdin.isTTY) {
      console.log("No editor configured. Let's set up your workspace.\n");
      const { runSetup } = await import("./setup.js");
      await runSetup();
      // Re-resolve config after setup saved new values
      config = resolveConfig(targetDir, cliOverrides ?? {});
    } else {
      const msg = "No editor configured. Run `summon setup` interactively or use: summon set editor <command>";
      console.error(msg);
      throw new Error(msg);
    }
  }

  const { opts, machineConfig, starshipPreset, onStart, onStop, envVars, treeLayout } = config;
  const projectName = resolveProjectName(targetDir);

  if (await warnIfNested(opts, cliOverrides?.dryRun)) {
    throw new Error("Launch aborted by user (nested workspace).");
  }
  decideCleanRestoredPanes(opts, cliOverrides ?? {}, config.projectOverrides, machineConfig, cliOverrides?.dryRun, projectName);

  let effectiveOnStart = onStart;

  if (!cliOverrides?.dryRun) {
    const resolvedCommands: Array<[string, string]> = [];
    const maybePush = (key: string, value: string | null | undefined) => {
      if (!value || value === "true" || value === "false") return;
      resolvedCommands.push([key, value]);
    };

    maybePush("editor", opts.editor);
    maybePush("sidebar", opts.sidebarCommand);
    maybePush("shell", opts.shell);
    maybePush("on-start", onStart);
    maybePush("on-stop", onStop);
    if (treeLayout) {
      for (const [paneName, cmd] of treeLayout.panes) {
        maybePush(`pane.${paneName}`, cmd);
      }
    }

    const decision = await confirmDangerousCommands(resolvedCommands);
    const { skipped } = decision;

    // Apply skip decisions: remove skipped panes from layout (UX-S2 #340)
    if (skipped.size > 0) {
      if (skipped.has("editor")) opts.editor = undefined;
      if (skipped.has("sidebar")) opts.sidebarCommand = undefined;
      if (skipped.has("shell")) opts.shell = undefined;
      if (skipped.has("on-start")) effectiveOnStart = undefined;
      if (treeLayout) {
        for (const key of skipped) {
          if (key.startsWith("pane.")) {
            treeLayout.panes.delete(key.slice(5));
          }
        }
      }
    }
  }

  if (effectiveOnStart && !cliOverrides?.dryRun) {
    executeOnStart(effectiveOnStart, targetDir);
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

    const resolvedBinary = await ensureCommand(binary, configKey);
    resolvedCache.set(binary, resolvedBinary);
    return replaceCommandExecutable(cmdString, resolvedBinary);
  };

  const resolveStarship = (): string | null => {
    if (!starshipPreset) return null;
    if (isStarshipInstalled()) {
      try {
        return ensurePresetConfig(starshipPreset);
      } catch (err) {
        console.warn(
          `Warning: Failed to set up Starship preset "${starshipPreset}": ${getErrorMessage(err)}`,
        );
      }
    } else {
      console.warn(
        `Warning: starship-preset is set to "${starshipPreset}" but Starship is not installed. Skipping.`,
      );
      console.warn("Install Starship: https://starship.rs");
    }
    return null;
  };

  const paneNames = treeLayout
    ? await launchTreeLayout(treeLayout, opts, cliOverrides ?? {}, targetDir, starshipPreset, envVars, ensureAndResolve, resolveStarship, projectName, onStop)
    : await launchTraditionalLayout(opts, cliOverrides ?? {}, targetDir, starshipPreset, envVars, ensureAndResolve, resolveStarship, projectName, onStop);

  // Write workspace status for monitoring features
  if (!cliOverrides?.dryRun) {
    const layoutLabel = treeLayout ? "custom" : (cliOverrides?.layout ?? "default");
    const status: WorkspaceStatus = {
      project: projectName,
      directory: resolve(targetDir),
      pid: process.pid,
      startedAt: new Date().toISOString(),
      layout: layoutLabel,
      panes: paneNames,
      source: "summon",
      version: 1,
    };

    try {
      writeStatus(status);
    } catch {
      // Non-fatal: monitoring is optional, don't break launch
    }
  }
}
