import { parseArgs } from "node:util";
import type { CLIOverrides } from "../launcher.js";
import { PANES_MIN, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX } from "../layout.js";
import { validateIntFlag, validateFloatFlag } from "../validation.js";
import { getErrorMessage, exitWithUsageHint } from "../utils.js";
import { VALID_KEYS } from "../config.js";
import { validateLayoutOrExit } from "../commands/layout-support.js";

export type ParsedValues = {
  help?: boolean;
  version?: boolean;
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  shell?: string;
  "auto-resize"?: boolean;
  "no-auto-resize"?: boolean;
  "starship-preset"?: string;
  env?: string[];
  "font-size"?: string;
  "on-start"?: string;
  "new-window"?: boolean;
  fullscreen?: boolean;
  maximize?: boolean;
  float?: boolean;
  fix?: boolean;
  vim?: boolean;
  once?: boolean;
  "dry-run"?: boolean;
};

export type ParsedCli = {
  values: ParsedValues;
  positionals: string[];
  subcommand?: string;
  args: string[];
};

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
    env: { type: "string", multiple: true },
    "font-size": { type: "string" },
    "on-start": { type: "string" },
    "new-window": { type: "boolean" },
    fullscreen: { type: "boolean" },
    maximize: { type: "boolean" },
    float: { type: "boolean" },
    fix: { type: "boolean" },
    vim: { type: "boolean" },
    once: { type: "boolean" },
    "dry-run": { type: "boolean", short: "n" },
  },
} as const;

function safeParse(args: string[]): { values: ParsedValues; positionals: string[] } {
  try {
    const parsed = parseArgs({ ...parseOpts, args });
    return {
      values: parsed.values as ParsedValues,
      positionals: parsed.positionals,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    console.error(`Error: ${msg}`);
    if (msg.includes("ambiguous")) {
      console.error("Tip: To pass a value starting with '-', use '--flag=-value' syntax.");
    }
    exitWithUsageHint();
  }
}

export function parseCli(argv: string[]): ParsedCli {
  const { values, positionals } = safeParse(argv);

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

  const [subcommand, ...args] = positionals;
  return { values, positionals, subcommand, args };
}

export function buildOverrides(values: ParsedValues): CLIOverrides {
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
  if (values.fullscreen) overrides.fullscreen = "true";
  if (values.maximize) overrides.maximize = "true";
  if (values.float) overrides.float = "true";
  if (values["dry-run"]) overrides.dryRun = true;
  return overrides;
}

export function showHelp(): void {
  console.log(HELP);
}

export function hasSubcommandHelp(subcommand: string): boolean {
  return subcommand in SUBCOMMAND_HELP;
}

export function showSubcommandHelp(subcommand: string): void {
  console.log(SUBCOMMAND_HELP[subcommand]);
}
