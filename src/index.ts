import { isFirstRun } from "./config.js";
import { launch } from "./launcher.js";
import {
  buildOverrides,
  hasSubcommandHelp,
  parseCli,
  showHelp,
  showSubcommandHelp,
} from "./cli/parse.js";
import { handleLayoutCommand } from "./commands/layout.js";
import { handleSessionCommand } from "./commands/session.js";
import { handleDoctorCommand } from "./commands/doctor.js";
import {
  handleConfigCommand,
  handleExportCommand,
  handleFreezeCommand,
  handleSetCommand,
} from "./commands/config.js";
import {
  handleAddCommand,
  handleListCommand,
  handleOpenCommand,
  handleRemoveCommand,
  resolveTargetDirectory,
} from "./commands/project.js";
import {
  handleBriefingCommand,
  handlePortsCommand,
  handleSnapshotCommand,
  handleStatusCommand,
} from "./commands/runtime.js";
import {
  handleCompletionsCommand,
  handleKeybindingsCommand,
  handleSetupCommand,
} from "./commands/setup.js";
import type { CommandHandler } from "./commands/types.js";

const registry: Record<string, CommandHandler> = {
  add: handleAddCommand,
  remove: handleRemoveCommand,
  list: handleListCommand,
  set: handleSetCommand,
  config: handleConfigCommand,
  setup: handleSetupCommand,
  completions: handleCompletionsCommand,
  doctor: handleDoctorCommand,
  keybindings: handleKeybindingsCommand,
  freeze: handleFreezeCommand,
  status: handleStatusCommand,
  snapshot: handleSnapshotCommand,
  briefing: handleBriefingCommand,
  ports: handlePortsCommand,
  switch: handleOpenCommand,
  open: handleOpenCommand,
  export: handleExportCommand,
  layout: handleLayoutCommand,
  session: handleSessionCommand,
};

const parsed = parseCli(process.argv.slice(2));

if (parsed.values.version) {
  console.log(__VERSION__);
  process.exit(0);
}

if (parsed.values.help) {
  if (parsed.subcommand && hasSubcommandHelp(parsed.subcommand)) {
    showSubcommandHelp(parsed.subcommand);
    process.exit(0);
  }
  // FE-H2 (#255): unknown subcommand with --help
  if (parsed.subcommand && !hasSubcommandHelp(parsed.subcommand) && !registry[parsed.subcommand]) {
    console.error(`Error: Unknown command: ${parsed.subcommand}. Run 'summon --help' to see available commands.`);
    process.exit(1);
  }
  showHelp();
  process.exit(0);
}

// UX-M8 (#314): Warn if --once is used with a non-launch subcommand
if (parsed.values.once && parsed.subcommand && parsed.subcommand in registry) {
  console.error(
    `Warning: --once has no effect with the '${parsed.subcommand}' command`,
  );
}

// FE-H1 (#254): first-run wizard ONLY fires when no subcommand was supplied
if (isFirstRun() && process.stdin.isTTY && parsed.subcommand === undefined) {
  console.log("Press Ctrl+C at any time to skip setup. Re-run later with: summon setup");
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (!parsed.subcommand) {
  // UX-S1 (#315): Show quick-start hint for returning users in TTY
  const isTTY = process.stdin.isTTY || process.env["SUMMON_FORCE_TTY"] === "1";
  if (isTTY) {
    console.log(
      "Usage: summon <path>           Launch a workspace\n" +
        "       summon --help           Show all commands",
    );
    process.exit(0);
  }
  showHelp();
  process.exit(0);
}

// trust subcommand wiring (WU-1)
if (parsed.subcommand === "trust") {
  const dir = parsed.args[0] ?? ".";
  const { trustProject } = await import("./trust.js");
  trustProject(typeof dir === "string" ? dir : ".");
  console.log(`✓ Trusted: ${dir}`);
  process.exit(0);
}

const overrides = buildOverrides(parsed.values);
const handler = registry[parsed.subcommand];

if (handler) {
  await handler({
    parsed,
    values: parsed.values,
    subcommand: parsed.subcommand,
    args: parsed.args,
    overrides,
  });
} else {
  // Not a known subcommand — treat as a workspace target (path or registered project name).
  // resolveTargetDirectory handles path resolution, project registry lookup, and error reporting.
  const targetDir = resolveTargetDirectory(parsed.subcommand);
  await launch(targetDir, overrides);
}
