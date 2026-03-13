import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
  setConfig,
  removeConfig,
  listConfig,
} from "./config.js";
import { launch } from "./launcher.js";
import type { CLIOverrides } from "./launcher.js";
import { PANES_MIN, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX, isPresetName } from "./layout.js";
import { parseIntInRange } from "./validation.js";

const HELP = `
summon -- Launch multi-pane Ghostty workspaces

Usage:
  summon <target>             Launch workspace (project name, path, or '.')
  summon add <name> <path>    Register a project name -> path mapping
  summon remove <name>        Remove a registered project
  summon list                 List all registered projects
  summon set <key> [value]    Set a machine-level config value
  summon config               Show current machine configuration

Options:
  -h, --help                  Show this help message
  -v, --version               Show version number
  -l, --layout <preset>       Use a layout preset (minimal, full, pair, cli, mtop)
  -e, --editor <cmd>          Override editor command
  --panes <n>                 Override number of editor panes
  --editor-size <n>           Override editor width %
  --sidebar <cmd>             Override sidebar command
  --server <value>            Server pane: true, false, or a command
  --auto-resize               Resize sidebar to match editor-size (default: on)
  --no-auto-resize            Disable auto-resize
  -n, --dry-run               Print generated AppleScript without executing

Config keys:
  editor        Command for coding panes (default: claude)
  sidebar       Command for sidebar pane (default: lazygit)
  panes         Number of editor panes (default: 2)
  editor-size   Width % for editor grid (default: 75)
  server        Server pane toggle (default: true)
  layout        Default layout preset
  auto-resize   Resize sidebar to match editor-size (default: true)

Layout presets:
  minimal       1 editor pane, no server
  full          3 editor panes + server
  pair          2 editor panes + server
  cli           1 editor pane + server
  mtop          editor + mtop + server + lazygit sidebar

Per-project config:
  Place a .summon file in your project root with key=value pairs.
  Project config overrides machine config; CLI flags override both.
  Note: .summon files can specify commands that will be executed.
  Review .summon files before running summon in untrusted directories.

Requires: macOS, Ghostty 1.3.0+

Examples:
  summon .                        Launch workspace in current directory
  summon myapp                    Launch workspace for registered project
  summon add myapp ~/code/app     Register a project
  summon set editor claude        Set the editor command
  summon . --layout minimal       Launch with minimal preset
  summon . --server "npm run dev" Launch with custom server command
`.trim();

const VALID_KEYS = ["editor", "sidebar", "panes", "editor-size", "server", "layout", "auto-resize"];
const COMMAND_KEYS = ["editor", "sidebar"];

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
    panes: { type: "string" },
    "editor-size": { type: "string" },
    sidebar: { type: "string" },
    server: { type: "string" },
    "auto-resize": { type: "boolean" },
    "no-auto-resize": { type: "boolean" },
    "dry-run": { type: "boolean", short: "n" },
  },
} as const;

function safeParse() {
  try {
    return parseArgs(parseOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    console.error(`Run 'summon --help' for usage information.`);
    process.exit(1);
  }
}

const { values, positionals } = safeParse();

// Validate numeric flags at parse time
if (values.panes !== undefined) {
  if (!parseIntInRange(values.panes, PANES_MIN).ok) {
    console.error(`Error: --panes must be a positive integer, got "${values.panes}".`);
    console.error(`Run 'summon --help' for usage information.`);
    process.exit(1);
  }
}

if (values["editor-size"] !== undefined) {
  if (!parseIntInRange(values["editor-size"], EDITOR_SIZE_MIN, EDITOR_SIZE_MAX).ok) {
    console.error(`Error: --editor-size must be an integer between ${EDITOR_SIZE_MIN}-${EDITOR_SIZE_MAX}, got "${values["editor-size"]}".`);
    console.error(`Run 'summon --help' for usage information.`);
    process.exit(1);
  }
}

if (values.layout !== undefined && !isPresetName(values.layout)) {
  console.error(`Error: --layout must be a valid preset name, got "${values.layout}".`);
  console.error(`Valid presets: minimal, full, pair, cli, mtop`);
  console.error(`Run 'summon --help' for usage information.`);
  process.exit(1);
}

if (values["auto-resize"] && values["no-auto-resize"]) {
  console.error("Warning: both --auto-resize and --no-auto-resize specified; using --no-auto-resize.");
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

if (!subcommand) {
  console.error(HELP);
  process.exit(1);
}

switch (subcommand) {
  case "add": {
    const [name, path] = args;
    if (!name || !path) {
      console.error("Usage: summon add <name> <path>");
      process.exit(1);
    }
    const resolved = expandHome(path);
    addProject(name, resolved);
    console.log(`Registered: ${name} → ${resolved}`);
    break;
  }

  case "remove": {
    const [name] = args;
    if (!name) {
      console.error("Usage: summon remove <name>");
      process.exit(1);
    }
    const existed = removeProject(name);
    if (existed) {
      console.log(`Removed: ${name}`);
    } else {
      console.error(`Project not found: ${name}`);
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
      console.error("Usage: summon set <key> [value]");
      process.exit(1);
    }
    if (!VALID_KEYS.includes(key)) {
      console.error(`Unknown config key "${key}". Valid keys: ${VALID_KEYS.join(", ")}`);
      process.exit(1);
    }
    if (value !== undefined) {
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
      console.log("No machine config set. Use: summon set <key> <value>");
    } else {
      console.log("Machine config:");
      for (const [key, value] of config) {
        const unknownSuffix = VALID_KEYS.includes(key) ? "" : "  (unknown key — will be ignored)";
        if (value !== "") {
          console.log(`  ${key} → ${value}${unknownSuffix}`);
        } else if (COMMAND_KEYS.includes(key)) {
          console.log(`  ${key} → (plain shell)${unknownSuffix}`);
        } else {
          console.log(`  ${key} → (empty)${unknownSuffix}`);
        }
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
        console.error(`Unknown project: ${target}`);
        console.error(
          `Register it with: summon add ${target} /path/to/project`,
        );
        console.error(`Or see available:  summon list`);
        process.exit(1);
      }
      targetDir = path;
    }

    const overrides: CLIOverrides = {};
    if (values.layout) overrides.layout = values.layout;
    if (values.editor) overrides.editor = values.editor;
    if (values.panes) overrides.panes = values.panes;
    if (values["editor-size"]) overrides["editor-size"] = values["editor-size"];
    if (values.sidebar) overrides.sidebar = values.sidebar;
    if (values.server) overrides.server = values.server;
    if (values["auto-resize"]) overrides["auto-resize"] = "true";
    if (values["no-auto-resize"]) overrides["auto-resize"] = "false";
    if (values["dry-run"]) overrides.dryRun = true;

    await launch(targetDir, overrides);
  }
}
