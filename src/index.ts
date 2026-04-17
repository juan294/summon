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
};

const parsed = parseCli(process.argv.slice(2));

if (parsed.values.version) {
  console.log(__VERSION__);
  process.exit(0);
}

if (parsed.values.help) {
  if (parsed.subcommand && hasSubcommandHelp(parsed.subcommand)) {
    showSubcommandHelp(parsed.subcommand);
  } else {
    showHelp();
  }
  process.exit(0);
}

if (isFirstRun() && process.stdin.isTTY) {
  if (!parsed.subcommand || !hasSubcommandHelp(parsed.subcommand)) {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    if (!parsed.subcommand) {
      process.exit(0);
    }
  }
}

if (!parsed.subcommand) {
  showHelp();
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
  const targetDir = resolveTargetDirectory(parsed.subcommand);
  await launch(targetDir, overrides);
}
