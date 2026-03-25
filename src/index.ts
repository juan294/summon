import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
  setConfig,
  removeConfig,
  listConfig,
  isFirstRun,
  VALID_KEYS,
  BOOLEAN_KEYS,
  LAYOUTS_DIR,
  listCustomLayouts,
  readCustomLayout,
  saveCustomLayout,
  deleteCustomLayout,
  isValidLayoutName,
  isCustomLayout,
} from "./config.js";
import { launch, resolveConfig, optsToConfigMap, traditionalPaneNames } from "./launcher.js";
import type { CLIOverrides } from "./launcher.js";
import { PANES_MIN, PANES_DEFAULT, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX, EDITOR_SIZE_DEFAULT, isPresetName, getPresetNames } from "./layout.js";
import { validateIntFlag, validateFloatFlag, ENV_KEY_RE } from "./validation.js";
import { SAFE_COMMAND_RE, getErrorMessage, exitWithUsageHint, resolveCommand, checkAccessibility, ACCESSIBILITY_SETTINGS_PATH, ACCESSIBILITY_ENABLE_HINT, ACCESSIBILITY_REQUIRED_MSG } from "./utils.js";
import { parseTreeDSL } from "./tree.js";
import type { LayoutNode } from "./tree.js";
import { renderLayoutPreview } from "./setup.js";

/**
 * Convert a LayoutNode tree into a string[][] grid for renderLayoutPreview.
 * "right" splits → columns, "down" splits → rows within a column.
 * Each cell contains the pane command resolved from the pane map.
 */
function treeToGrid(node: LayoutNode, panes: Map<string, string>): string[][] {
  // Collect columns: flatten "right" splits at the top level into columns,
  // then flatten "down" splits within each column into rows.
  function collectColumns(n: LayoutNode): LayoutNode[] {
    if (n.type === "split" && n.direction === "right") {
      return [...collectColumns(n.first), ...collectColumns(n.second)];
    }
    return [n];
  }

  function collectRows(n: LayoutNode): string[] {
    if (n.type === "split" && n.direction === "down") {
      return [...collectRows(n.first), ...collectRows(n.second)];
    }
    if (n.type === "pane") {
      return [panes.get(n.name) ?? n.name];
    }
    // Nested right-split inside a column — flatten to a single label
    const leaves: string[] = [];
    function gather(nd: LayoutNode): void {
      if (nd.type === "pane") leaves.push(panes.get(nd.name) ?? nd.name);
      else { gather(nd.first); gather(nd.second); }
    }
    gather(n);
    return [leaves.join(" | ")];
  }

  return collectColumns(node).map((col) => collectRows(col));
}

function validateLayoutNameOrExit(name: string): void {
  if (isPresetName(name)) {
    console.error(`Error: "${name}" is a reserved preset name. Choose a different name.`);
    process.exit(1);
  }
  if (!isValidLayoutName(name)) {
    console.error(`Error: Invalid layout name "${name}".`);
    console.error("Names must start with a letter and contain only letters, digits, hyphens, and underscores.");
    process.exit(1);
  }
}

function validateLayoutOrExit(value: string, label: string): void {
  if (!isPresetName(value) && !isCustomLayout(value)) {
    console.error(`Error: ${label} must be a valid preset or custom layout name, got "${value}".`);
    console.error(`Valid presets: ${getPresetNames().join(", ")}`);
    const custom = listCustomLayouts();
    if (custom.length > 0) {
      console.error(`Custom layouts: ${custom.join(", ")}`);
    }
    exitWithUsageHint();
  }
}

function layoutNotFoundOrExit(name: string): never {
  console.error(`Error: Layout not found: ${name}`);
  console.error("Run 'summon layout list' to see available layouts.");
  process.exit(1);
}

const HELP = `
summon v${__VERSION__} -- Launch multi-pane Ghostty workspaces

Usage:
  summon <target>             Launch workspace (project name, path, or '.')
  summon setup                Configure workspace defaults interactively
  summon add <name> <path>    Register a project name -> path mapping
  summon remove <name>        Remove a registered project
  summon list                 List all registered projects
  summon set <key> [value]    Set a machine-level config value
  summon config               Show current machine configuration
  summon doctor               Check Ghostty config for recommended settings
  summon doctor --fix         Auto-add missing recommended settings (backs up first)
  summon freeze <name>        Save current resolved config as a reusable layout
  summon keybindings          Generate Ghostty key table for workspace navigation
  summon keybindings --vim    Use vim-style keys (hjkl) instead of arrows
  summon open                 Select and launch a registered project
  summon switch               Switch to an active workspace (alias for open)
  summon status               Interactive workspace status dashboard
  summon status --once        Print status table once and exit
  summon snapshot <action>    Manage context snapshots (save, show, clear)
  summon briefing             Morning briefing across all projects
  summon ports                Show port assignments and detect conflicts
  summon layout <action>      Manage custom layouts (create, save, list, show, delete, edit)
  summon export [path]        Export config as a .summon project file
  summon completions <shell>  Generate shell completion script (zsh, bash)

Options:
  -h, --help                  Show this help message
  -v, --version               Show version number
  -l, --layout <name>         Use a layout preset or custom layout
  -e, --editor <cmd>          Override editor command
  -p, --panes <n>             Override number of editor panes
  --editor-size <n>           Override editor width %
  -s, --sidebar <cmd>         Override sidebar command
  --shell <value>             Shell pane: true, false, or a command
  --auto-resize               Resize sidebar to match editor-size (default: on)
  --no-auto-resize            Disable auto-resize
  --starship-preset <preset>  Starship prompt preset name (per-workspace)
  --env <KEY=VALUE>           Set environment variable (repeatable)
  --font-size <n>             Override font size for workspace panes
  --on-start <cmd>            Run command before workspace creation
  --new-window                Open workspace in a new Ghostty window
  --fullscreen                Start workspace in fullscreen mode
  --maximize                  Start workspace maximized
  --float                     Float workspace window on top
  -n, --dry-run               Print generated AppleScript without executing

Config keys:
  editor          Command for coding panes (set during setup)
  sidebar         Command for sidebar pane (default: lazygit)
  panes           Number of editor panes (default: 2)
  editor-size     Width % for editor grid (default: 75)
  shell           Shell pane: true, false, or command (default: true)
  layout          Default layout preset or custom layout name
  auto-resize     Resize sidebar to match editor-size (default: on)
  starship-preset Starship prompt theme preset (per-workspace)
  new-window      Open workspace in a new window (default: false)
  fullscreen      Start workspace in fullscreen (default: false)
  maximize        Start workspace maximized (default: false)
  float           Float workspace window on top (default: false)
  font-size       Font size in points for workspace panes
  on-start        Command to run before workspace launches
  on-stop         Command to run when workspace exits
  env.<KEY>       Environment variable passed to all panes

Layout presets:
  minimal       1 editor pane, no shell
  full          3 editor panes + shell
  pair          2 editor panes + shell
  cli           1 editor pane + shell
  btop          editor + btop + shell + sidebar

Per-project config:
  Place a .summon file in your project root with key=value pairs.
  Project config overrides machine config; CLI flags override both.
  Custom layouts support tree DSL syntax for advanced pane arrangements.
  Note: .summon files can specify commands that will be executed.
  Review .summon files before running summon in untrusted directories.

Requires: macOS, Ghostty 1.3.1+

Examples:
  summon .                        Launch workspace in current directory
  summon myapp                    Launch workspace for registered project
  summon add myapp ~/code/app     Register a project
  summon set editor vim           Set the editor command
  summon . --layout minimal       Launch with minimal preset
  summon . --shell "npm run dev"  Launch with custom shell command
  summon doctor                   Check config and fix issues
  summon freeze mysetup           Save current config as reusable layout
`.trim();

const DISPLAY_COMMAND_KEYS = ["editor", "sidebar"];

const SUBCOMMAND_HELP: Record<string, string> = {
  add: `Usage: summon add <name> <path>

Register a project directory with a short name for quick launching.`,

  remove: `Usage: summon remove <name>

Remove a previously registered project by name.`,

  set: `Usage: summon set <key> [value]

Set a machine-level config value. Omit value to remove the key (resets to default).

Valid keys: ${VALID_KEYS.join(", ")}`,

  list: `Usage: summon list

List all registered projects and their paths.`,

  config: `Usage: summon config

Show all current machine-level configuration values.`,

  setup: `Usage: summon setup

Interactively configure your workspace defaults (editor, sidebar, layout, shell).
Settings are saved to ~/.config/summon/config.
You can also set individual values with: summon set <key> <value>`,

  completions: `Usage: summon completions <shell>

Generate shell completion script. Supported shells: zsh, bash.

Setup (add to your shell config):
  zsh:   eval "$(summon completions zsh)"
  bash:  eval "$(summon completions bash)"`,

  status: `Usage: summon status [--once]

Show workspace status across all registered projects.
Launches an interactive TUI dashboard with live refresh.

Options:
  --once  Print status table once and exit (non-interactive)

In TUI mode: ↑↓/jk navigate, Enter opens project, r refreshes, q quits.
Automatically uses --once when stdout is not a TTY (e.g., piped output).`,

  open: `Usage: summon open

Interactively select a registered project to launch with status indicators.
Active projects are focused (switched to); stopped projects launch a new workspace.`,

  switch: `Usage: summon switch

Alias for 'summon open'. Switch to an active workspace or launch a stopped one.`,

  snapshot: `Usage: summon snapshot <save|show|clear> [project]

Manage workspace context snapshots.

Actions:
  save [--dir <path>] [--project <name>] [--layout <name>]
        Save a snapshot of the current project state
  show <project>    Display a saved snapshot
  clear <project>   Remove a saved snapshot`,

  ports: `Usage: summon ports

Show port assignments across all registered projects.
Detects ports from .summon env vars, package.json scripts, and framework defaults.
Highlights port conflicts when multiple projects use the same port.`,

  briefing: `Usage: summon briefing

Generate a structured morning report across all registered projects.
Shows overnight commits, dirty files, workspace status, and a prioritized
recommendation for where to start.`,

  doctor: `Usage: summon doctor [--fix]

Check your Ghostty configuration for recommended settings.
Exits with code 2 if issues are found.

Options:
  --fix  Auto-add missing recommended settings (backs up config first)`,

  export: `Usage: summon export [path]

Export current config as a .summon project file.
Writes to stdout by default. Optionally specify a path argument.

Examples:
  summon export > .summon          Write to .summon in current directory
  summon export .summon            Same, using path argument`,

  keybindings: `Usage: summon keybindings [--vim]

Generate Ghostty key table configuration for workspace pane navigation.
Output can be appended to ~/.config/ghostty/config.

Options:
  --vim  Use vim-style keys (hjkl) instead of arrow keys`,

  freeze: `Usage: summon freeze <name>

Save current resolved config (CLI + project + machine) as a reusable custom layout.

Examples:
  summon freeze mysetup         Save current config as "mysetup"
  summon . --layout mysetup     Launch with frozen layout`,

  layout: `Usage: summon layout <action> [name]

Manage custom layouts.

Actions:
  create <name>   Interactively build a custom layout
  save <name>     Save current machine config as a custom layout
  list            List all custom layouts
  show <name>     Show a custom layout's contents
  delete <name>   Delete a custom layout
  edit <name>     Open a custom layout file in your editor

Layout names must start with a letter and contain only letters, digits,
hyphens, and underscores. Built-in preset names cannot be used.`,
};

function showHelp(): void {
  console.log(HELP);
}

function expandHome(p: string): string {
  return resolve(p.replace(/^~/, homedir()));
}

const parseOpts = {
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    layout: { type: "string", short: "l" },
    editor: { type: "string", short: "e" },
    panes: { type: "string", short: "p" },
    "editor-size": { type: "string" },
    sidebar: { type: "string", short: "s" },
    shell: { type: "string" },
    "auto-resize": { type: "boolean" },
    "no-auto-resize": { type: "boolean" },
    "starship-preset": { type: "string" },
    "env": { type: "string", multiple: true },
    "font-size": { type: "string" },
    "on-start": { type: "string" },
    "new-window": { type: "boolean" },
    "fullscreen": { type: "boolean" },
    "maximize": { type: "boolean" },
    "float": { type: "boolean" },
    "fix": { type: "boolean" },
    "vim": { type: "boolean" },
    "once": { type: "boolean" },
    "dry-run": { type: "boolean", short: "n" },
  },
} as const;

function safeParse() {
  try {
    return parseArgs(parseOpts);
  } catch (err) {
    const msg = getErrorMessage(err);
    console.error(`Error: ${msg}`);
    if (msg.includes("ambiguous")) {
      console.error(`Tip: To pass a value starting with '-', use '--flag=-value' syntax.`);
    }
    exitWithUsageHint();
  }
}

const { values, positionals } = safeParse();

// Validate numeric flags at parse time
if (values.panes !== undefined) {
  validateIntFlag("panes", values.panes, PANES_MIN);
}

if (values["editor-size"] !== undefined) {
  validateIntFlag("editor-size", values["editor-size"], EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
}

if (values.env) {
  for (const entry of values.env) {
    if (!entry.includes("=")) {
      exitWithUsageHint(`Error: --env must be in KEY=VALUE format, got "${entry}".`);
    }
  }
}

if (values["font-size"] !== undefined) {
  validateFloatFlag("font-size", values["font-size"]);
}

if (values.layout !== undefined) {
  validateLayoutOrExit(values.layout, "--layout");
}

if (values["auto-resize"] && values["no-auto-resize"]) {
  console.warn("Warning: both --auto-resize and --no-auto-resize specified; using --no-auto-resize.");
}

if (values.version) {
  console.log(__VERSION__);
  process.exit(0);
}

const [subcommand, ...args] = positionals;

if (values.help) {
  if (subcommand && subcommand in SUBCOMMAND_HELP) {
    console.log(SUBCOMMAND_HELP[subcommand]);
    process.exit(0);
  }
  showHelp();
  process.exit(0);
}

// Auto-trigger setup wizard on first run (config file doesn't exist)
if (isFirstRun() && process.stdin.isTTY) {
  if (!subcommand || !(subcommand in SUBCOMMAND_HELP)) {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    if (!subcommand) {
      process.exit(0);
    }
  }
}

if (!subcommand) {
  showHelp();
  process.exit(0);
}

function buildOverrides(): CLIOverrides {
  const overrides: CLIOverrides = {};
  if (values.layout) overrides.layout = values.layout;
  if (values.editor) overrides.editor = values.editor;
  if (values.panes) overrides.panes = values.panes;
  if (values["editor-size"]) overrides["editor-size"] = values["editor-size"];
  if (values.sidebar) overrides.sidebar = values.sidebar;
  if (values.shell) overrides.shell = values.shell;
  if (values["auto-resize"]) overrides["auto-resize"] = "true";
  if (values["no-auto-resize"]) overrides["auto-resize"] = "false";
  if (values["starship-preset"]) overrides["starship-preset"] = values["starship-preset"];
  if (values.env) overrides.env = values.env;
  if (values["font-size"]) overrides["font-size"] = values["font-size"];
  if (values["on-start"]) overrides["on-start"] = values["on-start"];
  if (values["new-window"]) overrides["new-window"] = "true";
  if (values["fullscreen"]) overrides["fullscreen"] = "true";
  if (values["maximize"]) overrides["maximize"] = "true";
  if (values["float"]) overrides["float"] = "true";
  if (values["dry-run"]) overrides.dryRun = true;
  return overrides;
}

switch (subcommand) {
  case "add": {
    const [name, path] = args;
    if (!name || !path) {
      exitWithUsageHint("Usage: summon add <name> <path>");
    }
    const resolved = expandHome(path);
    if (!existsSync(resolved)) {
      console.warn(`Warning: path does not exist: ${resolved}`);
    }
    addProject(name, resolved);
    console.log(`Registered: ${name} → ${resolved}`);
    break;
  }

  case "remove": {
    const [name] = args;
    if (!name) {
      exitWithUsageHint("Usage: summon remove <name>");
    }
    const existed = removeProject(name);
    if (existed) {
      console.log(`Removed: ${name}`);
    } else {
      console.error(`Error: Project not found: ${name}`);
      console.error("Run 'summon list' to see registered projects.");
      process.exit(1);
    }
    break;
  }

  case "list": {
    const projects = listProjects();
    if (projects.size === 0) {
      console.log("No projects registered. Use: summon add <name> <path>");
    } else {
      console.log("Registered projects:");
      for (const [name, path] of projects) {
        console.log(`  ${name} → ${path}`);
      }
    }
    break;
  }

  case "set": {
    const [key, value] = args;
    if (!key) {
      exitWithUsageHint("Usage: summon set <key> [value]");
    }
    if (!VALID_KEYS.includes(key) && !key.startsWith("env.")) {
      exitWithUsageHint(`Error: Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(", ")}, env.<KEY>`);
    }
    if (key.startsWith("env.")) {
      const envName = key.slice(4);
      if (!ENV_KEY_RE.test(envName)) {
        console.error(`Error: invalid environment variable name "${envName}".`);
        console.error("Environment variable names must start with a letter or underscore and contain only letters, digits, and underscores.");
        process.exit(1);
      }
    }
    if (key === "panes" && value !== undefined) {
      validateIntFlag("panes", value, PANES_MIN);
    }
    if (key === "editor-size" && value !== undefined) {
      validateIntFlag("editor-size", value, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
    }
    if (key === "layout" && value !== undefined) {
      validateLayoutOrExit(value, "layout");
    }
    if (BOOLEAN_KEYS.has(key) && value !== undefined) {
      if (value !== "true" && value !== "false") {
        console.error(`Error: ${key} must be "true" or "false", got "${value}".`);
        process.exit(1);
      }
    }
    if (key === "font-size" && value !== undefined) {
      validateFloatFlag("font-size", value);
    }
    if (key === "starship-preset" && value !== undefined) {
      if (!SAFE_COMMAND_RE.test(value)) {
        console.error(`Error: invalid starship preset name "${value}".`);
        process.exit(1);
      }
    }
    if (value !== undefined) {
      if (value === "" && (key === "editor" || key === "sidebar" || key === "shell" || key === "on-start" || key === "on-stop")) {
        console.error(`Error: ${key} cannot be set to an empty string.`);
        console.error(`To reset to default, run: summon set ${key} (without a value)`);
        process.exit(1);
      }
      setConfig(key, value);
      console.log(`Set ${key} → ${value}`);
    } else {
      removeConfig(key);
      console.log(`Removed ${key} (will use default)`);
    }
    break;
  }

  case "config": {
    const config = listConfig();
    if (config.size === 0) {
      console.log("No machine config set. Effective defaults:");
      console.log(`  panes → ${PANES_DEFAULT}`);
      console.log(`  editor-size → ${EDITOR_SIZE_DEFAULT}`);
      console.log(`  sidebar → lazygit`);
      console.log(`  shell → true`);
      console.log(`  auto-resize → true`);
      console.log(`  new-window → false`);
      console.log(`  fullscreen → false`);
      console.log(`  maximize → false`);
      console.log(`  float → false`);
      console.log("\nCustomize with: summon set <key> <value>");
    } else {
      console.log("Machine config:");
      for (const [key, value] of config) {
        const isUnknown = !VALID_KEYS.includes(key) && !key.startsWith("env.");
        const unknownSuffix = isUnknown ? "  (unknown key — will be ignored)" : "";
        if (value !== "") {
          console.log(`  ${key} → ${value}${unknownSuffix}`);
        } else if (DISPLAY_COMMAND_KEYS.includes(key)) {
          console.log(`  ${key} → (plain shell)${unknownSuffix}`);
        } else {
          console.log(`  ${key} → (empty)${unknownSuffix}`);
        }
        if (isUnknown) {
          console.log(`    Remove with: summon set ${key}`);
        }
      }
    }
    break;
  }

  case "setup": {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    break;
  }

  case "completions": {
    const [shell] = args;
    if (!shell) {
      exitWithUsageHint("Usage: summon completions <shell>\nSupported shells: zsh, bash");
    }
    if (shell === "zsh" || shell === "bash") {
      const { generateZshCompletion, generateBashCompletion } = await import("./completions.js");
      console.log(shell === "zsh" ? generateZshCompletion() : generateBashCompletion());
    } else {
      exitWithUsageHint(`Error: Unsupported shell: ${shell}\nSupported shells: zsh, bash`);
    }
    break;
  }

  case "doctor": {
    const { existsSync: ghosttyExists, readFileSync: readGhostty, copyFileSync, appendFileSync, mkdirSync: mkdirGhostty } = await import("node:fs");

    const fixFlag = values.fix;

    console.log("Checking Ghostty configuration...\n");

    const ghosttyConfigPath = join(homedir(), ".config", "ghostty", "config");

    if (!ghosttyExists(ghosttyConfigPath)) {
      console.log("  - No Ghostty config file found at ~/.config/ghostty/config");
      console.log("    Create one to customize your terminal experience.");
      console.log();
    }

    const configContent = ghosttyExists(ghosttyConfigPath)
      ? readGhostty(ghosttyConfigPath, "utf-8")
      : "";

    const checks = [
      {
        name: "Command Notifications",
        key: "notify-on-command-finish",
        recommended: "unfocused",
        reason: "Get notified when long-running commands finish",
        regex: /^\s*notify-on-command-finish\s*=/m,
      },
      {
        name: "Shell Integration",
        key: "shell-integration",
        recommended: "detect",
        reason: "Enable prompt navigation, click-to-move cursor, and smart close",
        regex: /^\s*shell-integration\s*=/m,
      },
    ];

    let allGood = true;
    const missingSettings: Array<{ key: string; recommended: string }> = [];

    for (const check of checks) {
      const isSet = check.regex.test(configContent);

      if (isSet) {
        console.log(`  + ${check.name} (${check.key}) is configured`);
      } else {
        allGood = false;
        missingSettings.push({ key: check.key, recommended: check.recommended });
        console.log(`  - ${check.name}`);
        if (!fixFlag) {
          console.log(`    Add to ~/.config/ghostty/config:`);
          console.log(`    ${check.key} = ${check.recommended}`);
          console.log(`    ${check.reason}`);
        }
        console.log();
      }
    }

    // --fix: auto-add missing settings to Ghostty config
    if (fixFlag && missingSettings.length > 0) {
      const ghosttyDir = join(homedir(), ".config", "ghostty");
      mkdirGhostty(ghosttyDir, { recursive: true });

      if (ghosttyExists(ghosttyConfigPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = `${ghosttyConfigPath}.bak.${timestamp}`;
        copyFileSync(ghosttyConfigPath, backup);
        console.log(`  Backed up ${ghosttyConfigPath} → ${backup}`);
      }

      const additions = missingSettings.map(s => `${s.key} = ${s.recommended}`).join("\n");
      appendFileSync(ghosttyConfigPath, "\n# Added by summon doctor --fix\n" + additions + "\n");
      console.log(`  Added ${missingSettings.length} setting(s) to ${ghosttyConfigPath}`);
    }

    console.log();
    console.log("Checking permissions...\n");

    const accessOk = checkAccessibility();
    if (accessOk) {
      console.log("  + Accessibility permission is granted");
    } else {
      allGood = false;
      console.log("  - Accessibility permission is required");
      console.log(`    ${ACCESSIBILITY_REQUIRED_MSG}`);
      console.log(`    ${ACCESSIBILITY_SETTINGS_PATH}`);
      console.log(`    ${ACCESSIBILITY_ENABLE_HINT}`);
      console.log();
    }

    // Check configured editor and sidebar commands
    const userConfig = listConfig();
    const commandChecks: Array<{ key: string; cmd: string }> = [];
    const editorCmd = userConfig.get("editor");
    const sidebarCmd = userConfig.get("sidebar");
    if (editorCmd) commandChecks.push({ key: "editor", cmd: editorCmd });
    if (sidebarCmd) commandChecks.push({ key: "sidebar", cmd: sidebarCmd });

    if (commandChecks.length > 0) {
      console.log();
      console.log("Checking configured commands...\n");

      for (const { key, cmd } of commandChecks) {
        const binary = cmd.split(" ")[0]!;
        const found = resolveCommand(binary);
        if (found) {
          console.log(`  + ${key} command "${binary}" found at ${found}`);
        } else {
          allGood = false;
          console.log(`  - ${key} command "${binary}" not found in PATH`);
          console.log(`    Install "${binary}" or change with: summon set ${key} <command>`);
          console.log();
        }
      }
    }

    // Port conflict check
    console.log();
    console.log("Checking port conflicts...\n");
    const { detectAllPorts: detectPorts } = await import("./ports.js");
    const { conflicts: portConflicts } = detectPorts();
    if (portConflicts.size === 0) {
      const projectCount = listProjects().size;
      console.log(`  + No port conflicts (${projectCount} projects checked)`);
    } else {
      allGood = false;
      for (const [port, projs] of portConflicts) {
        console.log(`  - Port conflict: port ${port} used by ${projs.join(", ")}`);
      }
    }

    if (allGood && missingSettings.length === 0) {
      console.log("\n  All recommended settings are configured!");
    }

    // Exit 2 (diagnostic) if issues remain after potential --fix
    // --fix can resolve missing config settings but cannot fix accessibility
    const configFixed = fixFlag && missingSettings.length > 0;
    const issuesRemain = configFixed ? !accessOk : !allGood;
    if (issuesRemain) {
      console.error("Exit code 2: issues were found. See above for details.");
      process.exit(2);
    }

    break;
  }

  case "keybindings": {
    const { generateKeyTableConfig } = await import("./keybindings.js");
    const { collectLeaves, resolveTreeCommands: resolveTreeCmdsLocal } = await import("./tree.js");
    const style = values.vim ? "vim" as const : "arrows" as const;
    const config = resolveConfig(process.cwd(), buildOverrides());

    let paneNames: string[];
    let layoutName: string;

    if (config.treeLayout) {
      const resolved = resolveTreeCmdsLocal(config.treeLayout.tree, config.treeLayout.panes);
      paneNames = collectLeaves(resolved);
      layoutName = "tree";
    } else {
      const { planLayout } = await import("./layout.js");
      const plan = planLayout(config.opts);
      paneNames = traditionalPaneNames(plan);
      layoutName = "default";
    }

    console.log(generateKeyTableConfig(paneNames, layoutName, style));
    break;
  }

  case "freeze": {
    const [freezeName] = args;
    if (!freezeName) {
      console.error("Usage: summon freeze <name>");
      exitWithUsageHint();
    }
    validateLayoutNameOrExit(freezeName);
    if (isCustomLayout(freezeName)) {
      console.error(`Error: Layout "${freezeName}" already exists. Delete it first: summon layout delete ${freezeName}`);
      process.exit(1);
    }

    const { opts } = resolveConfig(process.cwd(), {});
    const entries = optsToConfigMap(opts);

    saveCustomLayout(freezeName, entries);
    console.log(`Frozen current config as layout "${freezeName}". Launch with: summon . --layout ${freezeName}`);
    break;
  }

  case "status": {
    const { runMonitor, printStatusOnce } = await import("./monitor.js");
    if (values.once || !process.stdout.isTTY) {
      printStatusOnce();
    } else {
      await runMonitor();
    }
    break;
  }

  case "snapshot": {
    const [snapshotAction, ...snapshotArgs] = args;
    const { saveSnapshot, readSnapshot: readSnap, clearSnapshot, formatRestorationBanner: formatBanner } = await import("./snapshot.js");
    switch (snapshotAction) {
      case "save": {
        let dir = process.cwd();
        let project = "";
        let layout = "unknown";
        for (let i = 0; i < snapshotArgs.length; i++) {
          if (snapshotArgs[i] === "--dir" && snapshotArgs[i + 1]) { dir = snapshotArgs[++i]!; }
          else if (snapshotArgs[i] === "--project" && snapshotArgs[i + 1]) { project = snapshotArgs[++i]!; }
          else if (snapshotArgs[i] === "--layout" && snapshotArgs[i + 1]) { layout = snapshotArgs[++i]!; }
          else if (!project) { project = snapshotArgs[i]!; }
        }
        if (!project) project = resolve(dir).split("/").pop() || "unknown";
        const result = saveSnapshot(project, dir, layout);
        if (result) console.log(`Snapshot saved for ${project}`);
        else console.log(`No git repo found in ${dir}`);
        break;
      }
      case "show": {
        const [proj] = snapshotArgs;
        if (!proj) { exitWithUsageHint("Usage: summon snapshot show <project>"); }
        const snap = readSnap(proj);
        if (snap) console.log(formatBanner(snap));
        else console.log(`No snapshot found for ${proj}`);
        break;
      }
      case "clear": {
        const [proj] = snapshotArgs;
        if (!proj) { exitWithUsageHint("Usage: summon snapshot clear <project>"); }
        if (clearSnapshot(proj)) console.log(`Snapshot cleared for ${proj}`);
        else console.log(`No snapshot found for ${proj}`);
        break;
      }
      default:
        exitWithUsageHint("Usage: summon snapshot <save|show|clear> [project]");
    }
    break;
  }

  case "briefing": {
    const { runBriefing } = await import("./briefing.js");
    runBriefing();
    break;
  }

  case "ports": {
    const { detectAllPorts } = await import("./ports.js");
    const { green: greenPort, dim: dimPort, yellow: yellowPort } = await import("./setup.js");
    const { assignments, conflicts } = detectAllPorts();
    if (assignments.length === 0) {
      console.log("No port assignments detected across registered projects.");
    } else {
      console.log("  PORT   PROJECT          SOURCE             STATE");
      console.log("  " + dimPort("\u2500".repeat(60)));
      for (const a of assignments) {
        const portStr = String(a.port).padEnd(6);
        const projStr = a.project.padEnd(16);
        const srcStr = a.source.padEnd(18);
        const dot = a.state === "active" ? greenPort("\u25CF") : dimPort("\u25CB");
        const stateStr = a.state === "active" ? greenPort("active") : dimPort(a.state);
        const conflict = conflicts.has(a.port) ? yellowPort(" \u2190 conflict") : "";
        console.log(`  ${portStr} ${projStr} ${srcStr} ${dot} ${stateStr}${conflict}`);
      }
      if (conflicts.size > 0) {
        console.log();
        for (const [port, projs] of conflicts) {
          console.log(yellowPort(`  \u26A0 Port ${port} used by: ${projs.join(", ")}`));
        }
      }
    }
    break;
  }

  case "switch":
  case "open": {
    const { loadProjectRows } = await import("./monitor.js");
    const { renderRow } = await import("./monitor.js");
    const { focusWorkspace: focusWs } = await import("./launcher.js");

    const rows = loadProjectRows();
    if (rows.length === 0) {
      console.error("Error: No projects registered. Use: summon add <name> <path>");
      process.exit(1);
    }

    const activeCount = rows.filter(r => r.state === "active" || r.state === "active-long").length;
    console.log(`  summon \u2014 select a project${" ".repeat(20)}${activeCount} active / ${rows.length} total\n`);
    const width = process.stdout.columns || 80;
    for (const [i, row] of rows.entries()) {
      console.log(`  ${i + 1}  ${renderRow(row, width - 5, false).trimStart()}`);
    }
    console.log();

    const { promptUser } = await import("./utils.js");
    let selectedRow: (typeof rows)[number] | undefined;
    while (selectedRow === undefined) {
      const answer = await promptUser(`Select [1-${rows.length}]: `);
      const idx = parseInt(answer, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= rows.length) {
        console.error(`Invalid selection. Enter a number between 1 and ${rows.length}.`);
        continue;
      }
      selectedRow = rows[idx];
    }

    if (selectedRow.state === "active" || selectedRow.state === "active-long") {
      focusWs(selectedRow.name);
      console.log(`Switched to [${selectedRow.name}]`);
    } else {
      await launch(selectedRow.directory, buildOverrides());
    }
    break;
  }

  case "export": {
    const config = listConfig();
    const lines: string[] = [];

    lines.push("# Summon workspace configuration");
    lines.push("# Generated by: summon export");
    lines.push(`# Generated on: ${new Date().toISOString()}`);
    lines.push("");

    if (config.size === 0) {
      lines.push("# No machine config set. All values use defaults.");
      lines.push("# Uncomment and modify as needed:");
      lines.push("");
      lines.push("# editor=vim");
      lines.push("# sidebar=lazygit");
      lines.push("# panes=2");
      lines.push("# editor-size=75");
      lines.push("# shell=true");
      lines.push("# layout=pair");
    } else {
      for (const key of VALID_KEYS) {
        const value = config.get(key);
        if (value !== undefined) {
          lines.push(`${key}=${value}`);
        }
      }
      // Include env.* keys
      for (const [key, value] of config) {
        if (key.startsWith("env.")) {
          lines.push(`${key}=${value}`);
        }
      }
    }

    const output = lines.join("\n") + "\n";

    const [outputPath] = args;
    if (outputPath) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(resolve(outputPath), output, { mode: 0o644 });
      console.log(`Exported to: ${resolve(outputPath)}`);
    } else {
      process.stdout.write(output);
    }
    break;
  }

  case "layout": {
    const [action, layoutName] = args;
    if (!action) {
      exitWithUsageHint("Usage: summon layout <create|save|list|show|delete|edit> [name]");
    }

    switch (action) {
      case "create": {
        if (!layoutName) {
          exitWithUsageHint("Usage: summon layout create <name>");
        }
        validateLayoutNameOrExit(layoutName);
        const { runLayoutBuilder } = await import("./setup.js");
        await runLayoutBuilder(layoutName);
        break;
      }

      case "save": {
        if (!layoutName) {
          exitWithUsageHint("Usage: summon layout save <name>");
        }
        validateLayoutNameOrExit(layoutName);
        const config = listConfig();
        if (config.size === 0) {
          console.warn("Warning: saving layout with empty config. Set values first with: summon set <key> <value>");
        }
        saveCustomLayout(layoutName, config);
        console.log(`Saved custom layout: ${layoutName}`);
        break;
      }

      case "list": {
        const layouts = listCustomLayouts();
        if (layouts.length === 0) {
          console.log("No custom layouts saved. Use: summon layout save <name>");
        } else {
          console.log(`Custom layouts (${layouts.length}):\n`);
          for (let i = 0; i < layouts.length; i++) {
            const name = layouts[i]!;
            const data = readCustomLayout(name);
            if (!data) {
              console.log(`  \x1b[1m${name}\x1b[0m`);
            } else {
              const paneMap = new Map<string, string>();
              let tree = "";
              const other: string[] = [];
              for (const [k, v] of data) {
                if (k === "tree") {
                  tree = v;
                } else if (k.startsWith("pane.") && !k.endsWith(".cwd")) {
                  paneMap.set(k.slice(5), v);
                } else {
                  other.push(`${k}=${v}`);
                }
              }
              console.log(`  \x1b[1m${name}\x1b[0m`);
              if (tree && paneMap.size > 0) {
                try {
                  const node = parseTreeDSL(tree);
                  const grid = treeToGrid(node, paneMap);
                  const preview = renderLayoutPreview(grid);
                  for (const line of preview.split("\n")) {
                    console.log(`    ${line}`);
                  }
                } catch {
                  // Fallback: show panes + tree as text
                  const paneList = [...paneMap.entries()].map(([k, v]) => `${k}=\x1b[36m${v}\x1b[0m`);
                  console.log(`    Panes:  ${paneList.join("  ")}`);
                  console.log(`    Tree:   ${tree}`);
                }
              } else if (paneMap.size > 0) {
                const paneList = [...paneMap.entries()].map(([k, v]) => `${k}=\x1b[36m${v}\x1b[0m`);
                console.log(`    Panes:  ${paneList.join("  ")}`);
              }
              if (other.length > 0) {
                console.log(`    Config: ${other.join(", ")}`);
              }
            }
            if (i < layouts.length - 1) console.log();
          }
        }
        break;
      }

      case "show": {
        if (!layoutName) {
          exitWithUsageHint("Usage: summon layout show <name>");
        }
        if (isPresetName(layoutName)) {
          console.error(`Error: "${layoutName}" is a built-in preset, not a custom layout. Run 'summon --help' to see preset descriptions.`);
          process.exit(1);
        }
        if (!isValidLayoutName(layoutName)) {
          console.error(`Error: Invalid layout name "${layoutName}".`);
          console.error("Names must start with a letter and contain only letters, digits, hyphens, and underscores.");
          process.exit(1);
        }
        const data = readCustomLayout(layoutName);
        if (!data) {
          layoutNotFoundOrExit(layoutName);
        }
        console.log(`Layout: ${layoutName}`);
        for (const [key, value] of data) {
          console.log(`  ${key}=${value}`);
        }
        break;
      }

      case "delete": {
        if (!layoutName) {
          exitWithUsageHint("Usage: summon layout delete <name>");
        }
        validateLayoutNameOrExit(layoutName);
        const deleted = deleteCustomLayout(layoutName);
        if (deleted) {
          console.log(`Deleted custom layout: ${layoutName}`);
        } else {
          layoutNotFoundOrExit(layoutName);
        }
        break;
      }

      case "edit": {
        if (!layoutName) {
          exitWithUsageHint("Usage: summon layout edit <name>");
        }
        validateLayoutNameOrExit(layoutName);
        if (!isCustomLayout(layoutName)) {
          layoutNotFoundOrExit(layoutName);
        }
        const editorCmd = process.env.EDITOR || "vi";
        if (!SAFE_COMMAND_RE.test(editorCmd)) {
          console.error(`Error: unsafe EDITOR value "${editorCmd}".`);
          console.error("EDITOR must be a simple command name (e.g. vim, nano, code).");
          console.error("Set a valid editor: export EDITOR=vim");
          process.exit(1);
        }
        const { execFileSync: execEditFile } = await import("node:child_process");
        const filePath = join(LAYOUTS_DIR, layoutName);
        try {
          execEditFile(editorCmd, [filePath], { stdio: "inherit" });
        } catch {
          console.error(`Failed to open editor: ${editorCmd}`);
          console.error("Check your EDITOR environment variable or ensure the editor is installed.");
          process.exit(1);
        }
        break;
      }

      default: {
        exitWithUsageHint(`Error: Unknown layout action: ${action}\nUsage: summon layout <create|save|list|show|delete|edit> [name]`);
      }
    }
    break;
  }

  default: {
    // Treat as launch target (project name, path, or '.')
    const target = subcommand;
    let targetDir: string;

    if (target === "." || target === "..") {
      targetDir = resolve(target);
    } else if (target.startsWith("/") || target.startsWith("~")) {
      targetDir = expandHome(target);
    } else if (
      target.startsWith("./") ||
      target.startsWith("../") ||
      target.includes("/")
    ) {
      targetDir = resolve(target);
    } else {
      const path = getProject(target);
      if (!path) {
        console.error(`Error: Unknown project: ${target}`);
        console.error(
          `Register it with: summon add ${target} /path/to/project`,
        );
        console.error(`Or see available:  summon list`);
        process.exit(1);
      }
      targetDir = path;
    }

    await launch(targetDir, buildOverrides());
  }
}
