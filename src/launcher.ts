import { existsSync } from "node:fs";
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
import { listConfig, listProjects, readKVFile, readCustomLayout, isCustomLayout, LAYOUT_NAME_RE } from "./config.js";
import { writeStatus } from "./status.js";
import type { WorkspaceStatus } from "./status.js";
import { generateAppleScript, generateTreeAppleScript, generateFocusScript } from "./script.js";
import { parseTreeDSL, extractPaneDefinitions, extractPaneCwds, resolveTreeCommands as resolveTreeCmds, buildTreePlan, findPaneByName } from "./tree.js";
import type { LayoutNode } from "./tree.js";
import { resolveCommand as resolveCommandPath, promptUser, getErrorMessage, SUMMON_WORKSPACE_ENV, isAccessibilityError, checkAccessibility, isGhosttyInstalled, ACCESSIBILITY_SETTINGS_PATH, ACCESSIBILITY_ENABLE_HINT, ACCESSIBILITY_REQUIRED_MSG, PromptCancelled } from "./utils.js";
import { assertTrusted, SummonError } from "./trust.js";
import { parseIntInRange, parsePositiveFloat, ENV_KEY_RE, PROJECT_NAME_RE, sanitizeProjectName } from "./validation.js";
import { isStarshipInstalled, ensurePresetConfig, getPresetConfigPath } from "./starship.js";
// command-spec is a pure utility module with no imports from this file.
// Dependency direction: launcher -> command-spec (one-way, no circular risk).
import { commandExecutable, commandHasShellMeta, replaceCommandExecutable } from "./command-spec.js";

/** Convert resolved layout options to a key-value config map suitable for saving as a custom layout. */
export function optsToConfigMap(opts: Partial<LayoutOptions>): Map<string, string> {
  const entries = new Map<string, string>();
  if (opts.editor) entries.set("editor", opts.editor);
  if (opts.sidebarCommand) entries.set("sidebar", opts.sidebarCommand);
  if (opts.editorPanes !== undefined) entries.set("panes", String(opts.editorPanes));
  if (opts.editorSize !== undefined) entries.set("editor-size", String(opts.editorSize));
  if (opts.shell !== undefined) entries.set("shell", opts.shell);
  if (opts.autoResize !== undefined) entries.set("auto-resize", String(opts.autoResize));
  if (opts.fontSize !== undefined && opts.fontSize !== null) entries.set("font-size", String(opts.fontSize));
  if (opts.newWindow) entries.set("new-window", "true");
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

function ensureGhostty(): void {
  if (!isGhosttyInstalled()) {
    const msg = "Ghostty.app not found. Please install Ghostty 1.3.1+ from https://ghostty.org";
    console.error(msg);
    throw new Error(msg);
  }
}

function printAccessibilityHint(): void {
  console.error(ACCESSIBILITY_REQUIRED_MSG);
  console.error(`Grant access in: ${ACCESSIBILITY_SETTINGS_PATH}`);
  console.error(ACCESSIBILITY_ENABLE_HINT);
  console.error();
  console.error("Tip: Run 'summon doctor' to check all permissions.");
}

function ensureAccessibility(): void {
  if (!checkAccessibility()) {
    console.error("Accessibility permission is required to launch workspaces.");
    console.error();
    printAccessibilityHint();
    throw new Error("Accessibility permission is required to launch workspaces.");
  }
}

function executeScript(script: string): void {
  console.log("Summoning workspace...");
  try {
    execFileSync("osascript", [], { input: script, encoding: "utf-8", timeout: 30_000 });
    console.log("✓ Workspace summoned.");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      console.error("Ghostty did not respond within 30 seconds. Is Ghostty running?");
      throw new Error("Ghostty did not respond within 30 seconds. Is Ghostty running?", { cause: err });
    }

    const message = getErrorMessage(err);
    console.error(`Failed to execute workspace script: ${message}`);

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

async function prompt(question: string): Promise<string> {
  try {
    const answer = await promptUser(question);
    return answer.toLowerCase();
  } catch (err) {
    if (err instanceof PromptCancelled) {
      process.exit(130);
    }
    throw err;
  }
}

/**
 * Check if any command values contain shell metacharacters.
 * Checks .summon project file command keys, the resolved on-start value
 * (which may come from CLI, machine config, or project config), and
 * tree pane.* commands from custom tree layouts.
 * If dangerous values are found, warn the user and prompt for confirmation (or refuse on non-TTY).
 */
async function confirmDangerousCommands(
  commands: Array<[string, string]>,
  sourcePath?: string,
): Promise<void> {
  const dangerous: Array<[string, string]> = [];
  for (const [key, value] of commands) {
    if (commandHasShellMeta(value)) {
      dangerous.push([key, value]);
    }
  }
  if (dangerous.length === 0) return;

  const keyValueLines = dangerous.map(([key, value]) => `  ${key} = ${value}`).join("\n");
  const commandLines = dangerous.map(([, value]) => `  ${value}`).join("\n");
  const source = sourcePath ? `The .summon file in \`${sourcePath}\`` : "Config";
  console.warn(`Warning: config contains commands with shell metacharacters:\n${keyValueLines}`);

  if (!process.stdin.isTTY) {
    console.warn("Non-interactive shell detected. Refusing to execute.");
    throw new Error("Non-interactive shell detected. Refusing to execute dangerous commands.");
  }

  const promptText = `${source} wants to run:\n${commandLines}\nAllow these commands? [y/N] `;
  const answer = await prompt(promptText);
  if (answer !== "y" && answer !== "yes") {
    console.error("Aborted.");
    throw new Error("Aborted by user.");
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
  const panes = pick(cliOverrides.panes, "panes");
  const editorSize = pick(cliOverrides["editor-size"], "editor-size");
  const shell = pick(cliOverrides.shell, "shell");
  const autoResize = pick(cliOverrides["auto-resize"], "auto-resize");

  const result: Partial<LayoutOptions> = { ...base };
  if (editor !== undefined) result.editor = editor;
  if (sidebar !== undefined) result.sidebarCommand = sidebar;
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
  const fullscreen = pick(cliOverrides.fullscreen, "fullscreen");
  const maximize = pick(cliOverrides.maximize, "maximize");
  const float = pick(cliOverrides.float, "float");
  if (newWindow !== undefined) result.newWindow = newWindow === "true";
  if (fullscreen !== undefined) result.fullscreen = fullscreen === "true";
  if (maximize !== undefined) result.maximize = maximize === "true";
  if (float !== undefined) result.float = float === "true";

  return result;
}

export function resolveConfig(targetDir: string, cliOverrides: CLIOverrides): ResolvedConfig {
  const projectConfigPath = join(targetDir, ".summon");
  const project = readKVFile(projectConfigPath);
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
 * Probe the title of the front Ghostty window's selected tab.
 * Returns null when Ghostty is not running or the script errors.
 */
export function probeFrontTabTitle(): string | null {
  try {
    const out = execFileSync(
      "osascript",
      ["-e", 'tell application "Ghostty" to get title of selected tab of front window'],
      { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
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
  projectName?: string,
): void {
  if (process.env[SUMMON_WORKSPACE_ENV]) return;
  if (opts.newWindow) return;

  const cleanRaw = pickConfigValue(cliOverrides.clean, "clean", project, machineConfig);
  const cleanEnabled = cleanRaw === undefined ? true : cleanRaw === "true";
  if (!cleanEnabled) return;

  // In dry-run mode, skip the probe but honor an explicit --clean flag so the
  // generated AppleScript (printed to stdout) includes the close prelude.
  if (dryRun) {
    if (cliOverrides.clean === "true") opts.cleanRestoredPanes = true;
    return;
  }

  const count = probePaneCount();
  if (count === null || count <= 1) return;

  // Only auto-clean when the front tab title contains a summon project marker.
  // This prevents closing non-summon panes that the user has open.
  if (projectName) {
    const tabTitle = probeFrontTabTitle();
    if (tabTitle === null || !tabTitle.includes(`[${projectName}]`)) return;
  }

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
  console.log(`Running on-start: ${onStart}`);
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
  const resolvedTree = resolveTreeCmds(treeLayout.tree, treeLayout.panes, treeLayout.paneCwds);
  const treePlanOpts = {
    autoResize: opts.autoResize,
    editorSize: opts.editorSize,
    fontSize: opts.fontSize,
    newWindow: opts.newWindow,
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
  executeScript(script);
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
  executeScript(script);
  return paneNames;
}

export async function launch(targetDir: string, cliOverrides?: CLIOverrides): Promise<void> {
  if (!existsSync(targetDir)) {
    const msg = `Directory not found: ${targetDir}`;
    console.error(msg);
    throw new Error(msg);
  }

  // Trust gate: verify the .summon file (if present) is explicitly trusted before
  // reading or acting on any of its values (BE-B1, BE-B2, SE-H1).
  try {
    assertTrusted(targetDir);
  } catch (err) {
    if (err instanceof SummonError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  let config: ReturnType<typeof resolveConfig>;
  config = resolveConfig(targetDir, cliOverrides ?? {});

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

    await confirmDangerousCommands(resolvedCommands);
  }

  if (onStart && !cliOverrides?.dryRun) {
    executeOnStart(onStart, targetDir);
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
