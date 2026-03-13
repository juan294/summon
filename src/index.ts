import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
  addProject,
  removeProject,
  getProject,
  listProjects,
  setConfig,
  listConfig,
} from "./config.js";
import { launch } from "./launcher.js";
import type { CLIOverrides } from "./launcher.js";

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
  --editor <cmd>              Override editor command
  --panes <n>                 Override number of editor panes
  --editor-size <n>           Override editor width %
  --sidebar <cmd>             Override sidebar command
  --server <value>            Server pane: true, false, or a command
  --auto-resize               Experimental: resize sidebar to match editor-size
  -n, --dry-run               Print generated AppleScript without executing

Config keys:
  editor        Command for coding panes (default: claude)
  sidebar       Command for sidebar pane (default: lazygit)
  panes         Number of editor panes (default: 2)
  editor-size   Width % for editor grid (default: 75)
  server        Server pane toggle (default: true)
  layout        Default layout preset
  auto-resize   Experimental: auto-resize sidebar (default: false)

Layout presets:
  minimal       1 editor pane, no server
  full          3 editor panes + server
  pair          2 editor panes + server
  cli           1 editor pane + server
  mtop          editor + mtop + server + lazygit sidebar

Per-project config:
  Place a .summon file in your project root with key=value pairs.
  Project config overrides machine config; CLI flags override both.

Requires: macOS, Ghostty 1.3.0+

Examples:
  summon .                        Launch workspace in current directory
  summon myapp                    Launch workspace for registered project
  summon add myapp ~/code/app     Register a project
  summon set editor claude        Set the editor command
  summon . --layout minimal       Launch with minimal preset
  summon . --server "npm run dev" Launch with custom server command
`.trim();

function showHelp(): void {
  console.log(HELP);
}

function expandHome(p: string): string {
  return resolve(p.replace(/^~/, process.env.HOME ?? ""));
}

const parseOpts = {
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    layout: { type: "string", short: "l" },
    editor: { type: "string" },
    panes: { type: "string" },
    "editor-size": { type: "string" },
    sidebar: { type: "string" },
    server: { type: "string" },
    "auto-resize": { type: "boolean" },
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

if (values.version) {
  console.log(__VERSION__);
  process.exit(0);
}

if (values.help) {
  showHelp();
  process.exit(0);
}

const [subcommand, ...args] = positionals;

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
    const VALID_KEYS = ["editor", "sidebar", "panes", "editor-size", "server", "layout", "auto-resize"];
    if (!VALID_KEYS.includes(key)) {
      console.warn(`Warning: unknown config key "${key}". Valid keys: ${VALID_KEYS.join(", ")}`);
    }
    setConfig(key, value ?? "");
    if (value) {
      console.log(`Set ${key} → ${value}`);
    } else {
      console.log(`Set ${key} → (empty, will open plain shell)`);
    }
    break;
  }

  case "config": {
    const config = listConfig();
    console.log("Machine config:");
    for (const [key, value] of config) {
      console.log(`  ${key} → ${value || "(plain shell)"}`);
    }
    break;
  }

  default: {
    // Treat as launch target (project name, path, or '.')
    const target = subcommand;
    let targetDir: string;

    if (target === ".") {
      targetDir = process.cwd();
    } else if (target.startsWith("/") || target.startsWith("~")) {
      targetDir = expandHome(target);
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
    if (values["dry-run"]) overrides.dryRun = true;

    await launch(targetDir, overrides);
  }
}
