import { isFirstRun } from "./config.js";
import { launch } from "./launcher.js";
import { SummonError } from "./trust.js";
import { PromptCancelled } from "./utils.js";
import {
  buildOverrides,
  hasSubcommandHelp,
  parseCli,
  showHelp,
  showSubcommandHelp,
} from "./cli/parse.js";
import { resolveTargetDirectory } from "./commands/project.js";
import type { CommandHandler } from "./commands/types.js";

// PE-H2 (#369): Lazy-import registry — handlers are only loaded when the subcommand is used.
const registry: Record<string, () => Promise<CommandHandler>> = {
  add:         () => import("./commands/project.js").then(m => m.handleAddCommand),
  remove:      () => import("./commands/project.js").then(m => m.handleRemoveCommand),
  list:        () => import("./commands/project.js").then(m => m.handleListCommand),
  set:         () => import("./commands/config.js").then(m => m.handleSetCommand),
  config:      () => import("./commands/config.js").then(m => m.handleConfigCommand),
  setup:       () => import("./commands/setup.js").then(m => m.handleSetupCommand),
  completions: () => import("./commands/setup.js").then(m => m.handleCompletionsCommand),
  doctor:      () => import("./commands/doctor.js").then(m => m.handleDoctorCommand),
  keybindings: () => import("./commands/setup.js").then(m => m.handleKeybindingsCommand),
  freeze:      () => import("./commands/config.js").then(m => m.handleFreezeCommand),
  status:      () => import("./commands/runtime.js").then(m => m.handleStatusCommand),
  snapshot:    () => import("./commands/runtime.js").then(m => m.handleSnapshotCommand),
  briefing:    () => import("./commands/runtime.js").then(m => m.handleBriefingCommand),
  ports:       () => import("./commands/runtime.js").then(m => m.handlePortsCommand),
  switch:      () => import("./commands/project.js").then(m => m.handleOpenCommand),
  open:        () => import("./commands/project.js").then(m => m.handleOpenCommand),
  export:      () => import("./commands/config.js").then(m => m.handleExportCommand),
  layout:      () => import("./commands/layout.js").then(m => m.handleLayoutCommand),
  session:     () => import("./commands/session.js").then(m => m.handleSessionCommand),
  trust:       () => import("./commands/trust.js").then(m => m.handleTrustCommand),
};

// UX-H3 (#372): Subcommands that legitimately consume --once — skip the false-positive warning.
const ONCE_ALLOWED_SUBCOMMANDS = new Set(["status"]);

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
  if (parsed.subcommand && !hasSubcommandHelp(parsed.subcommand) && !(parsed.subcommand in registry)) {
    console.error(`Error: Unknown command: ${parsed.subcommand}. Run 'summon --help' to see available commands.`);
    process.exit(1);
  }
  showHelp();
  process.exit(0);
}

// UX-M8 (#314): Warn if --once is used with a non-launch subcommand that doesn't support it.
// UX-H3 (#372): Skip warning for subcommands that legitimately consume --once.
if (parsed.values.once && parsed.subcommand && parsed.subcommand in registry && !ONCE_ALLOWED_SUBCOMMANDS.has(parsed.subcommand)) {
  console.error(
    `Warning: --once has no effect with the '${parsed.subcommand}' command`,
  );
}

// FE-M2 (#386): Warn if --all is passed to a non-session command.
if (parsed.values.all && parsed.subcommand && parsed.subcommand !== "session") {
  console.error(
    `Warning: --all has no effect with the '${parsed.subcommand}' command. --all is only valid with 'summon session'.`,
  );
}

try {
  // UX-H3 (#372): First-run wizard fires when no subcommand was supplied OR when targeting a directory.
  if (isFirstRun() && process.stdin.isTTY) {
    const isDirectoryTarget = parsed.subcommand !== undefined && !(parsed.subcommand in registry);
    if (parsed.subcommand === undefined || isDirectoryTarget) {
      console.log("Press Ctrl+C at any time to skip setup. Re-run later with: summon setup");
      const { runSetup } = await import("./setup.js");
      await runSetup();
      process.exit(0);
    }
  }

  if (!parsed.subcommand) {
    // UX-S1 (#315): Show quick-start hint for returning users in TTY
    // UX-L1 (#425): Include setup and --help in the hint so users know where to start
    const isTTY = process.stdin.isTTY || process.env["SUMMON_FORCE_TTY"] === "1";
    if (isTTY) {
      console.log(
        "Usage: summon <path>           Launch a workspace\n" +
          "       summon setup            Configure summon for the first time\n" +
          "       summon --help           Full help",
      );
      process.exit(0);
    }
    showHelp();
    process.exit(0);
  }

  const overrides = buildOverrides(parsed.values);
  const handlerFactory = registry[parsed.subcommand];

  if (handlerFactory) {
    const handler = await handlerFactory();
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
    try {
      await launch(targetDir, overrides);
    } catch (err) {
      if (err instanceof SummonError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
  }
} catch (err) {
  if (err instanceof PromptCancelled) {
    process.exit(1);
  }
  throw err;
}
