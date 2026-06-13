import { bold, cyan, dim } from "../ui/ansi.js";
import { VALID_KEYS } from "../config.js";

// eslint-disable-next-line no-control-regex
const ANSI_STRIP_RE = /\x1b\[[0-9;]*m/g;

function visibleLen(s: string): number {
  return s.replace(ANSI_STRIP_RE, "").length;
}

function wrapHelpLine(s: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (visibleLen(s) <= maxVisible) return s;

  // Find the indent of the description column by scanning the plain text:
  // lines look like "  --flag <arg>          Description text"
  // We find the position where the description starts (after the leading spaces +
  // flag + padding) so the continuation line aligns there.
  const plain = s.replace(ANSI_STRIP_RE, "");
  // Detect the description column: find the last run of 2+ spaces after non-space content
  const descColMatch = plain.match(/^(\s*\S.*?\s{2,})/);
  const descCol = descColMatch ? descColMatch[1]!.length : 0;
  const indent = " ".repeat(descCol);

  const lines: string[] = [];
  let remaining = s;

  while (visibleLen(remaining) > maxVisible) {
    // Find split point at maxVisible visible chars
    let visible = 0;
    let i = 0;
    let lastSpaceI = -1;

    while (i < remaining.length && visible < maxVisible) {
      if (remaining[i] === "\x1b") {
        // Skip ANSI escape sequence
        const end = remaining.indexOf("m", i);
        if (end !== -1) {
          i = end + 1;
          continue;
        }
      }
      if (remaining[i] === " ") {
        lastSpaceI = i;
      }
      visible++;
      i++;
    }

    // Split at last space if found, otherwise hard-break at i
    const splitAt = lastSpaceI !== -1 ? lastSpaceI : i;
    lines.push(remaining.slice(0, splitAt));
    remaining = indent + remaining.slice(splitAt).trimStart();
  }

  lines.push(remaining);
  return lines.join("\n");
}

async function buildHelp(): Promise<string> {
  // When stdout is not a TTY (e.g. piped), use a generous default so help text is not truncated
  const termWidth = Math.min(process.stdout.columns || 120, 120);
  const h = (s: string) => bold(cyan(s));
  const cmd = (s: string) => cyan(s);
  const note = (s: string) => dim(s);
  // Wrap a line to fit within terminal width, accounting for ANSI codes
  const wrap = (s: string): string => wrapHelpLine(s, termWidth);

  // PE-L1 (#553): lazy-import setup-gallery only when help is actually requested
  // FE-L2 (#552): build layout lines dynamically from LAYOUT_INFO (removes hardcoded duplicate block)
  const { LAYOUT_INFO } = await import("../setup-gallery.js");
  const layoutLines = Object.entries(LAYOUT_INFO).map(([name, info]) => {
    const nameCol = name.padEnd(14);
    return wrap(`  ${nameCol}${info.desc}`);
  });

  return [
    wrap(`${bold(`summon v${__VERSION__}`)} ${note("-- Launch multi-pane Ghostty workspaces")}`),
    "",
    wrap(`${bold("Usage:")} summon <command|target> [options]`),
    "",
    h("LAUNCH"),
    wrap(`  ${cmd("summon <target>")}             Launch workspace (project name, path, or '.')`),
    wrap(`  ${cmd("summon open")}                 Select and launch a registered project`),
    wrap(`  ${cmd("summon switch")}               Switch to an active workspace (focuses if running, launches if not)`),
    "",
    h("SESSIONS"),
    wrap(`  ${cmd("summon session <name>")}          Launch a saved multi-project session`),
    wrap(`  ${cmd("summon session --all")}           Launch every registered project`),
    wrap(`  ${cmd("summon session add <name> ...")}  Save a session`),
    wrap(`  ${cmd("summon session remove <name>")}   Delete a session`),
    wrap(`  ${cmd("summon session list")}            List saved sessions`),
    wrap(`  ${cmd("summon session show <name>")}     Print the project list for a session`),
    "",
    h("PROJECTS"),
    wrap(`  ${cmd("summon add <name> <path>")}    Register a project name -> path mapping`),
    wrap(`  ${cmd("summon remove <name>")}        Remove a registered project`),
    wrap(`  ${cmd("summon list")}                 List all registered projects`),
    "",
    h("CONFIG"),
    wrap(`  ${cmd("summon set <key> [value]")}    Set a machine-level config value`),
    wrap(`  ${cmd("summon config")}               Show current machine configuration`),
    wrap(`  ${cmd("summon setup")}                Configure workspace defaults interactively`),
    wrap(`  ${cmd("summon freeze <name>")}        Save current resolved config as a reusable layout`),
    wrap(`  ${cmd("summon export [path]")}        Export config as a .summon project file`),
    "",
    h("LAYOUT"),
    wrap(`  ${cmd("summon layout <action>")}      Manage custom layouts (create, save, list, show, delete, edit)`),
    wrap(`  ${cmd("summon keybindings")}          Generate Ghostty key table for workspace navigation`),
    wrap(`  ${cmd("summon keybindings --vim")}    Use vim-style keys (hjkl) instead of arrows`),
    "",
    h("MONITORING"),
    wrap(`  ${cmd("summon status")}               Interactive workspace status dashboard`),
    wrap(`  ${cmd("summon status --once")}        Print status table once and exit`),
    wrap(`  ${cmd("summon briefing")}             Morning briefing across all projects`),
    wrap(`  ${cmd("summon ports")}                Show port assignments and detect conflicts`),
    wrap(`  ${cmd("summon snapshot <action>")}    Manage context snapshots (save, show, clear)`),
    "",
    h("TOOLS"),
    wrap(`  ${cmd("summon doctor")}               Check Ghostty config for recommended settings`),
    wrap(`  ${cmd("summon doctor --fix")}         Auto-add missing recommended settings (backs up first)`),
    wrap(`  ${cmd("summon completions <shell>")}  Generate shell completion script (zsh, bash, fish)`),
    wrap(`  ${cmd("summon trust [path]")}         Trust the .summon file in the given directory (default: current)`),
    "",
    bold("Options:"),
    wrap(`  -h, --help                  Show this help message`),
    wrap(`  -v, --version               Show version number`),
    wrap(`  -l, --layout <name>         Use a layout preset or custom layout`),
    wrap(`                              ${note("Tree layout DSL: summon <path> --layout 'root(left right)'")}`),
    wrap(`  -e, --editor <cmd>          Override editor command`),
    wrap(`  -p, --panes <n>             Override number of editor panes`),
    wrap(`  --editor-size <n>           Override editor width %`),
    wrap(`  -s, --sidebar <cmd>         Override sidebar command`),
    wrap(`  --shell <value>             Shell pane: true, false, or a command`),
    wrap(`  --auto-resize               Resize sidebar to match editor-size (default: on)`),
    wrap(`  --no-auto-resize            Disable auto-resize`),
    wrap(`  --clean                     Auto-close stale panes from prior Ghostty session (default: on)`),
    wrap(`  --no-clean                  Skip auto-close of restored panes`),
    wrap(`  --starship-preset <preset>  Starship prompt preset name (per-workspace)`),
    wrap(`  --env <KEY=VALUE>           Set environment variable (repeatable; e.g. --env PORT=3000)`),
    wrap(`  --font-size <n>             Override font size for workspace panes`),
    wrap(`  --on-start <cmd>            Run command before workspace creation`),
    wrap(`  --new-window                Open workspace in a new Ghostty window`),
    wrap(`  --new-tab                   Open workspace in a new Ghostty tab`),
    wrap(`  --no-project-config         Skip the .summon file (do not require trust)`),
    wrap(`  --fullscreen                Start workspace in fullscreen mode`),
    wrap(`  --maximize                  Start workspace maximized`),
    wrap(`  --float                     Float workspace window on top`),
    wrap(`  -n, --dry-run               Print generated AppleScript without executing`),
    "",
    bold("Config keys:") + note(" (set via 'summon set <key> <value>' or in .summon file)"),
    wrap(`  editor          Command for coding panes (set during setup)`),
    wrap(`  secondary-editor  Alternate editor command for secondary panes`),
    wrap(`  sidebar         Command for sidebar pane (default: lazygit)`),
    wrap(`  panes           Number of editor panes (default: 2)`),
    wrap(`  editor-size     Width % for editor grid (default: 75)`),
    wrap(`  shell           Shell pane: true, false, or command (default: true)`),
    wrap(`  layout          Default layout preset or custom layout name`),
    wrap(`  auto-resize     Resize sidebar to match editor-size (default: on)`),
    wrap(`  clean           Auto-close restored panes on launch (default: on)`),
    wrap(`  starship-preset Starship prompt theme preset (per-workspace)`),
    wrap(`  new-window      Open workspace in a new window (default: false)`),
    wrap(`  fullscreen      Start workspace in fullscreen (default: false)`),
    wrap(`  maximize        Start workspace maximized (default: false)`),
    wrap(`  float           Float workspace window on top (default: false)`),
    wrap(`  font-size       Font size in points for workspace panes`),
    wrap(`  on-start        Command to run before workspace launches`),
    "",
    bold("Config-only keys") + note(" (no CLI flag):"),
    wrap(`  on-stop         Command to run when workspace exits (available as config key only)`),
    wrap(`  env.<KEY>       Environment variable passed to all panes (e.g. env.PORT=3000)`),
    "",
    bold("Layouts:"),
    ...layoutLines,
    "",
    bold("Per-project config:"),
    wrap(`  Place a .summon file in your project root with key=value pairs.`),
    wrap(`  Project config overrides machine config; CLI flags override both.`),
    wrap(`  Custom layouts support tree DSL syntax for advanced pane arrangements.`),
    wrap(`  Example: summon <path> --layout 'root(left right)'`),
    wrap(`  Note: .summon files can specify commands that will be executed.`),
    wrap(`  Review .summon files before running summon in untrusted directories.`),
    "",
    note("Requires: macOS, Ghostty 1.3.1+"),
    "",
    bold("Examples:"),
    wrap(`  summon .                        Launch workspace in current directory`),
    wrap(`  summon myapp                    Launch workspace for registered project`),
    wrap(`  summon add myapp ~/code/app     Register a project`),
    wrap(`  summon set editor vim           Set the editor command`),
    wrap(`  summon . --layout minimal       Launch with minimal preset`),
    wrap(`  summon . --shell "npm run dev"  Launch with custom shell command`),
    wrap(`  summon doctor                   Check config and fix issues`),
    wrap(`  summon freeze mysetup           Save current config as reusable layout`),
    "",
    note("Run 'summon <command> --help' for details on each command."),
  ].join("\n");
}

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

Generate shell completion script. Supported shells: zsh, bash, fish.

Setup (add to your shell config):
  zsh:   eval "$(summon completions zsh)"
  bash:  eval "$(summon completions bash)"
  fish:  eval (summon completions fish | psub)`,

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

  doctor: `Usage: summon doctor [--fix] [--verbose]

Check your Ghostty configuration for recommended settings.
Exits with code 2 if issues are found.

Options:
  --fix      Auto-add missing recommended settings (backs up config first)
  --verbose  Show resolved config paths, version info, and trust database details`,

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

  session: `Usage: summon session <name>
          summon session --all
          summon session add <name> <project> [<project> ...]
          summon session remove <name>
          summon session list
          summon session show <name>

Launch a saved multi-project session. Each project opens in its own Ghostty tab.

Actions:
  <name>              Launch the named session
  --all               Launch every registered project
  add <name> ...      Save a new session
  remove <name>       Delete a saved session
  list                List all saved sessions
  show <name>         Print the project list for a session

Session names must start with a letter and contain only letters, digits, hyphens, and underscores.
Reserved names: add, remove, list, show, all.`,

  trust: `Usage: summon trust [path]

Mark the .summon file in the given directory as trusted.
Defaults to the current directory if no path is given.

Summon refuses to execute .summon files from untrusted directories.
Running this command approves the file's current contents.

Example:
  summon trust         Trust .summon in current directory
  summon trust ~/app   Trust .summon in ~/app`,
};

export async function showHelp(): Promise<void> {
  console.log(await buildHelp());
}

export function hasSubcommandHelp(subcommand: string): boolean {
  return subcommand in SUBCOMMAND_HELP;
}

export function showSubcommandHelp(subcommand: string): void {
  console.log(SUBCOMMAND_HELP[subcommand]);
}
