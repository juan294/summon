// PE-H1 (#569): True lazy-entry import-graph bypass. The pre-import fast path for
// --version/-v now genuinely loads zero heavy modules — no static imports exist at
// the top level. All of cli/parse, config, trust, utils, launcher, and help are
// loaded via dynamic import() inside async main(), so they are skipped entirely on
// single-token --version/-v invocations. The --help path skips config/trust/utils
// entirely. Only subcommand/launch paths load the full graph.
import type { CommandHandler } from "./commands/types.js";

const __argv = process.argv.slice(2);
if (__argv.length === 1 && (__argv[0] === "--version" || __argv[0] === "-v")) {
  console.log(__VERSION__);
  process.exit(0);
}

// UX-H3 (#372): Subcommands that legitimately consume --once — skip the false-positive warning.
const ONCE_ALLOWED_SUBCOMMANDS = new Set(["status"]);

// FE-L1 (#621): Subcommands that legitimately consume --vim / --fix.
const VIM_ALLOWED_SUBCOMMANDS = new Set(["keybindings"]);
const FIX_ALLOWED_SUBCOMMANDS = new Set(["doctor"]);

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

async function main(): Promise<void> {
  // Load the CLI parser dynamically — skipped entirely on the --version fast path above.
  const { parseCli, buildOverrides } = await import("./cli/parse.js");

  const parsed = parseCli(__argv);

  if (parsed.values.version) {
    console.log(__VERSION__);
    process.exit(0);
  }

  if (parsed.values.help) {
    // Dynamically import help module — only loaded on the --help path.
    const { showHelp, hasSubcommandHelp, showSubcommandHelp } = await import("./cli/help.js");
    if (parsed.subcommand && hasSubcommandHelp(parsed.subcommand)) {
      showSubcommandHelp(parsed.subcommand);
      process.exit(0);
    }
    // FE-H2 (#255): unknown subcommand with --help
    if (parsed.subcommand && !hasSubcommandHelp(parsed.subcommand) && !(parsed.subcommand in registry)) {
      console.error(`Error: Unknown command: ${parsed.subcommand}. Run 'summon --help' to see available commands.`);
      process.exit(1);
    }
    await showHelp();
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

  // FE-L1 (#621): Warn if --vim is used with a command that doesn't consume it.
  if (parsed.values.vim) {
    const sub = parsed.subcommand;
    const isLaunchTarget = sub !== undefined && !(sub in registry);
    if ((sub && sub in registry && !VIM_ALLOWED_SUBCOMMANDS.has(sub)) || isLaunchTarget) {
      console.error(
        `Warning: --vim has no effect with the '${sub ?? ""}' command. --vim is only valid with 'summon keybindings'.`,
      );
    }
  }

  // FE-L1 (#621): Warn if --fix is used with a command that doesn't consume it.
  if (parsed.values.fix) {
    const sub = parsed.subcommand;
    const isLaunchTarget = sub !== undefined && !(sub in registry);
    if ((sub && sub in registry && !FIX_ALLOWED_SUBCOMMANDS.has(sub)) || isLaunchTarget) {
      console.error(
        `Warning: --fix has no effect with the '${sub ?? ""}' command. --fix is only valid with 'summon doctor'.`,
      );
    }
  }

  // Load utils and trust now — needed for catch-block guards and SummonError checks below.
  // These are still skipped on the --version and --help fast paths above.
  const { PromptCancelled } = await import("./utils.js");
  const { SummonError } = await import("./trust.js");

  try {
    // DO-L1 (#547): Test hook — throw a synthetic unhandled error to verify the debug hint is printed.
    if (process.env["SUMMON_TEST_THROW"] === "1") {
      throw new Error("Synthetic test error (SUMMON_TEST_THROW)");
    }

    // Load config dynamically — only needed for launch/subcommand paths (not --version/--help).
    const { isFirstRun } = await import("./config.js");

    // UX-H3 (#372): First-run wizard fires when no subcommand was supplied OR when targeting a directory.
    if (isFirstRun() && process.stdin.isTTY) {
      const isDirectoryTarget = parsed.subcommand !== undefined && !(parsed.subcommand in registry);
      if (parsed.subcommand === undefined || isDirectoryTarget) {
        console.log("Press Ctrl+C at any time to skip setup. Re-run later with: summon setup");
        const { runSetup } = await import("./setup.js");
        await runSetup();
        // UX-M3 (#476): After wizard completes (returns normally), continue with the original
        // launch intent when the user was targeting a directory. Cancellation (Ctrl+C) exits
        // inside runSetup itself, so this code only runs on successful completion.
        if (isDirectoryTarget && parsed.subcommand !== undefined) {
          const overrides = buildOverrides(parsed.values);
          const { resolveTargetDirectory } = await import("./cli/resolve-target.js");
          const targetDir = resolveTargetDirectory(parsed.subcommand);
          const { launch } = await import("./launcher.js");
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
      // Lazy help module — fallback full help for no subcommand on a non-TTY stdout.
      const { showHelp } = await import("./cli/help.js");
      await showHelp();
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
      const { resolveTargetDirectory } = await import("./cli/resolve-target.js");
      const targetDir = resolveTargetDirectory(parsed.subcommand);
      // PE-M1 (#474): Dynamically import launch only when needed, not at startup.
      const { launch } = await import("./launcher.js");
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
    // DO-L1 (#547): Surface the debug flag hint so users know how to get full diagnostics.
    console.error("Re-run with SUMMON_DEBUG=1 for full details.");
    throw err;
  }
}

main();
