import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { listConfig, readKVFile, readCustomLayout, isCustomLayout, LAYOUT_NAME_RE } from "./config.js";
import { generateAppleScript, generateTreeAppleScript } from "./script.js";
import { parseTreeDSL, extractPaneDefinitions, resolveTreeCommands as resolveTreeCmds, buildTreePlan, collectLeaves, findPaneByName } from "./tree.js";
import type { LayoutNode } from "./tree.js";
import { SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand as resolveCommandPath, promptUser, getErrorMessage, SUMMON_WORKSPACE_ENV } from "./utils.js";
import { parseIntInRange } from "./validation.js";
import { isStarshipInstalled, ensurePresetConfig, getPresetConfigPath } from "./starship.js";

const SAFE_SHELL_RE = /^\/[a-zA-Z0-9_/.-]+$/;

/** Shell metacharacters that indicate potentially dangerous commands. */
const SHELL_META_RE = /[;|&`]|\$[({]|[><]/;

/** Keys in .summon files that hold command values (as opposed to config like layout/panes). */
const COMMAND_KEYS = new Set(["editor", "sidebar", "shell", "on-start"]);

/**
 * Read and validate process.env.SHELL.
 * Falls back to /bin/bash with a warning if undefined or unsafe.
 */
function getLoginShell(): string {
  const shell = process.env.SHELL;
  if (shell === undefined || !SAFE_SHELL_RE.test(shell)) {
    if (shell !== undefined) {
      console.warn(`Unsafe SHELL value: "${shell}". Falling back to /bin/bash.`);
    }
    return "/bin/bash";
  }
  return shell;
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
}

function ensureGhostty(): void {
  if (!GHOSTTY_PATHS.some((p) => existsSync(p))) {
    console.error(
      "Ghostty.app not found. Please install Ghostty 1.3.1+ from https://ghostty.org",
    );
    process.exit(1);
  }
}

function executeScript(script: string): void {
  try {
    execFileSync("osascript", [], { input: script, encoding: "utf-8" });
  } catch (err) {
    console.error(`Failed to execute workspace script: ${getErrorMessage(err)}`);
    console.error("Is Ghostty running?");
    process.exit(1);
  }
}

/**
 * Resolve a command name to its full path.
 * Exits with an error if the command name is invalid (defense-in-depth).
 * Returns null if the command is not found on the system.
 */
function resolveCommand(cmd: string): string | null {
  if (!SAFE_COMMAND_RE.test(cmd)) {
    console.error(`Invalid command name: "${cmd}". Command names may only contain letters, digits, hyphens, dots, underscores, and plus signs.`);
    process.exit(1);
  }
  return resolveCommandPath(cmd);
}

async function prompt(question: string): Promise<string> {
  const answer = await promptUser(question);
  return answer.toLowerCase();
}

/**
 * Check if any command values from the .summon project file contain shell metacharacters.
 * If so, warn the user and prompt for confirmation (or refuse on non-TTY).
 * Skips if dryRun is set (dry-run doesn't execute anything).
 */
async function confirmDangerousCommands(projectOverrides: Map<string, string>): Promise<void> {
  const dangerous: Array<[string, string]> = [];
  for (const [key, value] of projectOverrides) {
    if (COMMAND_KEYS.has(key) && SHELL_META_RE.test(value)) {
      dangerous.push([key, value]);
    }
  }
  if (dangerous.length === 0) return;

  const lines = dangerous.map(([key, value]) => `  ${key} = ${value}`).join("\n");
  const message = `Warning: .summon file contains commands with shell metacharacters:\n${lines}`;
  console.warn(message);

  if (!process.stdin.isTTY) {
    console.warn("Non-interactive shell detected. Refusing to execute.");
    process.exit(1);
  }

  const answer = await prompt("Continue? [y/N] ");
  if (answer !== "y" && answer !== "yes") {
    console.error("Aborted.");
    process.exit(1);
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
  const resolved = resolveCommand(cmd);
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
    process.exit(1);
  }

  const [installBin, installArgs] = installCmd;
  const installDisplay = [installBin, ...installArgs].join(" ");

  console.log(`\`${cmd}\` is required but not installed on this machine.`);
  const answer = await prompt(`Install it now with \`${installDisplay}\`? [Y/n] `);

  if (answer && answer !== "y" && answer !== "yes") {
    console.log(`\`${cmd}\` is required for this workspace layout. Exiting.`);
    process.exit(1);
  }

  console.log(`Running: ${installDisplay}`);
  try {
    execFileSync(installBin, installArgs, { stdio: "inherit" });
  } catch {
    console.error(
      `Failed to install \`${cmd}\`. Please install it manually and try again.`,
    );
    process.exit(1);
  }

  const postInstallPath = resolveCommand(cmd);
  if (!postInstallPath) {
    console.error(`\`${cmd}\` still not found after install. Please check your PATH.`);
    process.exit(1);
  }

  console.log(`\`${cmd}\` installed successfully!\n`);
  return postInstallPath;
}

interface ResolvedConfig {
  opts: Partial<LayoutOptions>;
  projectOverrides: Map<string, string>;
  starshipPreset?: string;
  onStart?: string;
  envVars: Record<string, string>;
  treeLayout?: {
    tree: LayoutNode;
    panes: Map<string, string>;
  };
}

/** Valid environment variable key name: letters, digits, underscores, starting with letter or underscore. */
const ENV_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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
      if (ENV_KEY_RE.test(envKey)) {
        envVars[envKey] = value;
      }
    }
  }

  // Project config (overrides machine)
  for (const [key, value] of projectConfig) {
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      if (ENV_KEY_RE.test(envKey)) {
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
        if (ENV_KEY_RE.test(envKey)) {
          envVars[envKey] = entry.slice(eqIdx + 1);
        } else {
          console.warn(`Warning: ignoring invalid env var key "${envKey}" from --env flag.`);
        }
      }
    }
  }

  return envVars;
}

/** Pick a config value with priority: CLI > project > global. Empty strings treated as unset. */
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
      if (es.ok) base.editorSize = es.value;
    }
    if (customData.has("auto-resize")) base.autoResize = customData.get("auto-resize") === "true";
    if (customData.has("font-size")) {
      const fs = parseFloat(customData.get("font-size")!);
      if (!isNaN(fs) && fs > 0) base.fontSize = fs;
    }
    if (customData.has("new-window")) base.newWindow = customData.get("new-window") === "true";
    if (customData.has("fullscreen")) base.fullscreen = customData.get("fullscreen") === "true";
    if (customData.has("maximize")) base.maximize = customData.get("maximize") === "true";
    if (customData.has("float")) base.float = customData.get("float") === "true";

    const treeExpr = customData.get("tree");
    if (treeExpr) {
      const tree = parseTreeDSL(treeExpr);
      const panes = extractPaneDefinitions(customData);
      return { base, treeLayout: { tree, panes } };
    }

    // Traditional custom layout (no tree= key)
    if (customData.has("editor")) base.editor = customData.get("editor");
    if (customData.has("sidebar")) base.sidebarCommand = customData.get("sidebar");
    if (customData.has("panes")) {
      const p = parseIntInRange(customData.get("panes")!, PANES_MIN);
      if (p.ok) base.editorPanes = p.value;
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
    const parsed = parseFloat(fontSize);
    if (!isNaN(parsed) && parsed > 0) {
      result.fontSize = parsed;
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
  const project = readKVFile(join(targetDir, ".summon"));
  const machineConfig = listConfig();

  const layoutKey = cliOverrides.layout ?? project.get("layout") ?? machineConfig.get("layout");
  const { base, treeLayout } = resolveLayoutBase(layoutKey);
  const opts = layerConfigValues(base, cliOverrides, project, machineConfig);

  const starshipPreset = pickConfigValue(cliOverrides["starship-preset"], "starship-preset", project, machineConfig);
  const onStart = pickConfigValue(cliOverrides["on-start"], "on-start", project, machineConfig);
  const envVars = collectEnvVars(machineConfig, project, cliOverrides.env);

  return { opts, projectOverrides: project, starshipPreset, onStart, envVars, treeLayout };
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
  console.warn("Launching here will nest splits inside this pane, which can get too scary.");
  console.warn("Tip: Use --new-window to open in a separate window instead.\n");
  const answer = await prompt("Continue anyway? [y/N] ");
  return answer !== "y";
}

/** Execute the on-start hook command before workspace creation. */
function executeOnStart(onStart: string, targetDir: string): void {
  console.log(`Running on-start: ${onStart}`);
  try {
    execSync(onStart, { cwd: targetDir, encoding: "utf-8", stdio: "inherit" });
  } catch {
    console.error(`on-start command failed: ${onStart}`);
    process.exit(1);
  }
}

async function launchTreeLayout(
  treeLayout: NonNullable<ResolvedConfig["treeLayout"]>,
  opts: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  targetDir: string,
  loginShell: string,
  starshipPreset: string | undefined,
  envVars: Record<string, string>,
  ensureAndResolve: (cmd: string, key: string) => Promise<string>,
  resolveStarship: () => string | null,
): Promise<void> {
  const resolvedTree = resolveTreeCmds(treeLayout.tree, treeLayout.panes);
  const treePlanOpts = {
    autoResize: opts.autoResize,
    editorSize: opts.editorSize,
    fontSize: opts.fontSize,
    newWindow: opts.newWindow,
    fullscreen: opts.fullscreen,
    maximize: opts.maximize,
    float: opts.float,
  };
  const hasEnvVars = Object.keys(envVars).length > 0;

  if (cliOverrides.dryRun) {
    const dryRunStarshipPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
    const treePlan = buildTreePlan(resolvedTree, treePlanOpts);
    const script = generateTreeAppleScript(treePlan, targetDir, loginShell, dryRunStarshipPath, hasEnvVars ? envVars : undefined);
    const paneCount = collectLeaves(resolvedTree).length;
    const headerLines = [
      "-- summon dry-run",
      `-- Layout: tree layout, ${paneCount} ${paneCount === 1 ? "pane" : "panes"}`,
      `-- Target: ${targetDir}`,
    ];
    if (starshipPreset) {
      headerLines.push(`-- Starship preset: ${starshipPreset} (${dryRunStarshipPath})`);
    }
    console.log(`${headerLines.join("\n")}\n${script}`);
    return;
  }

  ensureGhostty();

  for (const leafName of collectLeaves(resolvedTree)) {
    const pane = findPaneByName(resolvedTree, leafName);
    if (pane?.command) {
      pane.command = await ensureAndResolve(pane.command, leafName);
    }
  }

  const starshipConfigPath = resolveStarship();
  const treePlan = buildTreePlan(resolvedTree, treePlanOpts);
  const script = generateTreeAppleScript(treePlan, targetDir, loginShell, starshipConfigPath, hasEnvVars ? envVars : undefined);
  executeScript(script);
}

async function launchTraditionalLayout(
  opts: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  targetDir: string,
  loginShell: string,
  starshipPreset: string | undefined,
  envVars: Record<string, string>,
  ensureAndResolve: (cmd: string, key: string) => Promise<string>,
  resolveStarship: () => string | null,
): Promise<void> {
  const plan = planLayout(opts);
  const hasEnvVars = Object.keys(envVars).length > 0;

  if (cliOverrides.dryRun) {
    const dryRunStarshipPath = starshipPreset ? getPresetConfigPath(starshipPreset) : null;
    const script = generateAppleScript(plan, targetDir, loginShell, dryRunStarshipPath, hasEnvVars ? envVars : undefined);
    const totalPanes = plan.leftColumnCount + plan.rightColumnEditorCount;
    const headerLines = [
      "-- summon dry-run",
      `-- Layout: ${totalPanes} editor ${totalPanes === 1 ? "pane" : "panes"}, editor=${plan.editor}, sidebar=${plan.sidebarCommand}, shell=${plan.hasShell}`,
      `-- Target: ${targetDir}`,
    ];
    if (starshipPreset) {
      headerLines.push(`-- Starship preset: ${starshipPreset} (${dryRunStarshipPath})`);
    }
    console.log(`${headerLines.join("\n")}\n${script}`);
    return;
  }

  ensureGhostty();

  if (plan.editor) plan.editor = await ensureAndResolve(plan.editor, "editor");
  if (plan.sidebarCommand) plan.sidebarCommand = await ensureAndResolve(plan.sidebarCommand, "sidebar");
  if (plan.secondaryEditor) plan.secondaryEditor = await ensureAndResolve(plan.secondaryEditor, "editor");
  if (plan.shellCommand) plan.shellCommand = await ensureAndResolve(plan.shellCommand, "shell");

  const starshipConfigPath = resolveStarship();
  const script = generateAppleScript(plan, targetDir, loginShell, starshipConfigPath, hasEnvVars ? envVars : undefined);
  executeScript(script);
}

export async function launch(targetDir: string, cliOverrides?: CLIOverrides): Promise<void> {
  if (!existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const { opts, projectOverrides, starshipPreset, onStart, envVars, treeLayout } = resolveConfig(targetDir, cliOverrides ?? {});

  if (await warnIfNested(opts, cliOverrides?.dryRun)) {
    process.exit(0);
  }

  if (!cliOverrides?.dryRun) {
    await confirmDangerousCommands(projectOverrides);
  }

  if (onStart && !cliOverrides?.dryRun) {
    executeOnStart(onStart, targetDir);
  }

  const loginShell = getLoginShell();

  // Cache resolved command paths so the same binary is only looked up once
  const resolvedCache = new Map<string, string>();
  const ensureAndResolve = async (cmdString: string, configKey: string): Promise<string> => {
    const parts = cmdString.split(" ");
    const binary = parts[0]!;
    const cached = resolvedCache.get(binary);
    if (cached) {
      parts[0] = cached;
    } else {
      parts[0] = await ensureCommand(binary, configKey);
      resolvedCache.set(binary, parts[0]);
    }
    return parts.join(" ");
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

  if (treeLayout) {
    await launchTreeLayout(treeLayout, opts, cliOverrides ?? {}, targetDir, loginShell, starshipPreset, envVars, ensureAndResolve, resolveStarship);
  } else {
    await launchTraditionalLayout(opts, cliOverrides ?? {}, targetDir, loginShell, starshipPreset, envVars, ensureAndResolve, resolveStarship);
  }
}
