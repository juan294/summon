// PE-H1 (#569): True lazy-entry import-graph bypass. The pre-import fast path for
// --version/-v now genuinely loads zero heavy modules — no static imports exist at
// the top level. All of cli/parse, config, trust, utils, launcher, and help are
// loaded via dynamic import() inside async main(), so they are skipped entirely on
// single-token --version/-v invocations. The --help path skips config/trust/utils
// entirely. Only subcommand/launch paths load the full graph.
import type { CommandHandler } from "./commands/types.js";
import type { CLIOverrides } from "./config-resolve.js";

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
// Flags consumed by exactly one subcommand; any other use (including a launch target) gets a warning.
const SINGLE_OWNER_FLAGS: Array<[flag: "orphans", owner: string]> = [["orphans", "clean"]];

// PE-H2 (#369): Lazy-import registry — handlers are only loaded when the subcommand is used.
const registry: Record<string, () => Promise<CommandHandler>> = {
  add:         () => import("./commands/project.js").then(m => m.handleAddCommand),
  remove:      () => import("./commands/project.js").then(m => m.handleRemoveCommand),
  list:        () => import("./commands/project.js").then(m => m.handleListCommand),
  set:         () => import("./commands/config.js").then(m => m.handleSetCommand),
  config:      () => import("./commands/config.js").then(m => m.handleConfigCommand),
  setup:       () => import("./commands/setup.js").then(m => m.handleSetupCommand),
  completions: () => import("./commands/setup.js").then(m => m.handleCompletionsCommand),
  title:       () => import("./commands/workspace.js").then(m => m.handleTitleCommand),
  inspect:     () => import("./commands/workspace.js").then(m => m.handleInspectCommand),
  focus:       () => import("./commands/workspace.js").then(m => m.handleFocusCommand),
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
  clean:       () => import("./commands/clean.js").then(m => m.handleCleanCommand),
};

async function main(): Promise<void> {
  // PE-H1: the interactive monitor reads statuses in a child of this CLI (MONITOR_READ_ARG, internal and undocumented).
  // The flag lives in monitor-read.ts, loaded only for an `--internal-` argument (the entry keeps no static imports).
  if (__argv.length === 1 && __argv[0]?.startsWith("--internal-")) {
    const { MONITOR_READ_ARG, writeMonitorRead } = await import("./monitor-read.js");
    if (__argv[0] === MONITOR_READ_ARG) {
      await writeMonitorRead();
      return;
    }
  }
  // Remember how this process was started: the cleanup trap typed into a workspace runs this
  // same binary for its snapshot, not whatever `summon` is on the pane's PATH when the shell exits.
  const { registerSelfInvocation } = await import("./self.js");
  const { realpathSync } = await import("node:fs");
  let script = process.argv[1];
  // Resolve the bin symlink of a global install: the trap must run this build, not whatever the
  // symlink points at when the shell exits (an upgrade or a rollback in between).
  try { if (script) script = realpathSync(script); } catch { /* keep the path as typed */ }
  registerSelfInvocation(process.execPath, script);
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
      const { fail } = await import("./ui/output.js");
      fail(`Unknown command: ${parsed.subcommand}. Run 'summon --help' to see available commands.`);
      process.exit(1);
    }
    await showHelp();
    process.exit(0);
  }

  // UX-M2: every flag warning below carries the "summon: warning:" prefix (stderr).
  const { warn } = await import("./ui/output.js");

  // UX-M8 (#314): Warn if --once is used with a non-launch subcommand that doesn't support it.
  // UX-H3 (#372): Skip warning for subcommands that legitimately consume --once.
  if (parsed.values.once && parsed.subcommand && parsed.subcommand in registry && !ONCE_ALLOWED_SUBCOMMANDS.has(parsed.subcommand)) {
    warn(`--once has no effect with the '${parsed.subcommand}' command`);
  }

  // FE-M2 (#386): Warn if --all is passed to a non-session command.
  if (parsed.values.all && parsed.subcommand && parsed.subcommand !== "session") {
    warn(`--all has no effect with the '${parsed.subcommand}' command. --all is only valid with 'summon session'.`);
  }

  // FE-L1 (#621): Warn if --vim is used with a command that doesn't consume it.
  if (parsed.values.vim) {
    const sub = parsed.subcommand;
    const isLaunchTarget = sub !== undefined && !(sub in registry);
    if ((sub && sub in registry && !VIM_ALLOWED_SUBCOMMANDS.has(sub)) || isLaunchTarget) {
      warn(`--vim has no effect with the '${sub ?? ""}' command. --vim is only valid with 'summon keybindings'.`);
    }
  }

  for (const [flag, owner] of SINGLE_OWNER_FLAGS) {
    if (!parsed.values[flag]) continue;
    const sub = parsed.subcommand;
    if (sub !== owner) warn(`--${flag} has no effect with the '${sub ?? ""}' command. --${flag} is only valid with 'summon ${owner}'.`);
  }

  // FE-L1 (#621): Warn if --fix is used with a command that doesn't consume it.
  if (parsed.values.fix) {
    const sub = parsed.subcommand;
    const isLaunchTarget = sub !== undefined && !(sub in registry);
    if ((sub && sub in registry && !FIX_ALLOWED_SUBCOMMANDS.has(sub)) || isLaunchTarget) {
      warn(`--fix has no effect with the '${sub ?? ""}' command. --fix is only valid with 'summon doctor'.`);
    }
  }

  try {
    // INTERNAL TEST HOOK, not a user setting (DO-L1): SUMMON_TEST_THROW=1 throws a synthetic unhandled error so
    // index.test.ts can check the debug hint. Undocumented on purpose; keep it, the suite depends on it.
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
        const { detectedSetupBackend } = await import("./commands/setup.js");
        // A directory target launches right after the wizard, and the launch prints the detection notices itself.
        // UX-L2: when the launch follows, the wizard's last line says so instead of "Run summon .".
        await runSetup({ ...detectedSetupBackend({ showNotices: !isDirectoryTarget }), launchNext: isDirectoryTarget });
        // UX-M3 (#476): After wizard completes (returns normally), continue with the original
        // launch intent when the user was targeting a directory. Cancellation (Ctrl+C) exits
        // inside runSetup itself, so this code only runs on successful completion.
        if (isDirectoryTarget && parsed.subcommand !== undefined) {
          const overrides = buildOverrides(parsed.values);
          const { resolveTargetDirectory } = await import("./cli/resolve-target.js");
          const targetDir = resolveTargetDirectory(parsed.subcommand, Object.keys(registry));
          await launchOrExit(targetDir, overrides);
        }
        process.exit(0);
      }
    }

    if (!parsed.subcommand) {
      // UX-S1 (#315): Show quick-start hint for returning users in TTY
      // UX-L1 (#425): Include setup and --help in the hint so users know where to start
      // INTERNAL TEST HOOK (DO-L1): SUMMON_FORCE_TTY=1 lets index.test.ts reach the TTY hint from a pipe. Undocumented on purpose.
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
      // UX-M3: the registry's names are suggestion candidates for a mistyped subcommand.
      const targetDir = resolveTargetDirectory(parsed.subcommand, Object.keys(registry));
      await launchOrExit(targetDir, overrides);
    }
  } catch (err) {
    await reportError(err);
  }
}

/**
 * A direct launch: an untrusted `.summon` (SummonError) is a branded error and exit 1, without the debug hint (UX-M2).
 * On a terminal the user is first offered to trust the file and launch (UX-M4); declining exits 130.
 */
async function launchOrExit(targetDir: string, overrides: CLIOverrides): Promise<void> {
  // PE-M1 (#474): launch and trust load only when a launch happens, not at startup.
  const { launch } = await import("./launcher.js");
  const { SummonError, withTrustPrompt } = await import("./trust.js");
  try {
    await withTrustPrompt(() => launch(targetDir, overrides));
  } catch (error) {
    if (!(error instanceof SummonError)) throw error;
    const { fail } = await import("./ui/output.js");
    fail(error.message);
    process.exit(1);
  }
}

/** Present operational failures without Node's uncaught source excerpt. */
async function reportError(error: unknown): Promise<void> {
  // Set before the lazy import below, so a failing import still exits 1; exitCodeFor refines it.
  process.exitCode = 1;
  // Error-only imports preserve the true lazy --version and --help paths.
  const { PromptCancelled, exitCodeFor, getErrorMessage, isDebug } = await import("./utils.js");
  // UX-L3: a user cancel (a wizard prompt, a declined confirmation) is quiet and exits 130, like the picker.
  process.exitCode = exitCodeFor(error);
  if (error instanceof PromptCancelled) return;
  const { SummonError } = await import("./trust.js");
  const { fail, err } = await import("./ui/output.js");
  fail(getErrorMessage(error));
  // UX-M2: a trust error is branded like any other but needs no debug hint; its own lines say what to run.
  if (error instanceof SummonError) return;
  if (isDebug()) {
    err(error instanceof Error ? error.stack ?? error.message : getErrorMessage(error));
  } else {
    err("Re-run with SUMMON_DEBUG=1 for full details.");
  }
}

// Also catch parser/import errors before command dispatch enters its own guard.
void main().catch(reportError);
