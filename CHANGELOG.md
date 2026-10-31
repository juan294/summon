# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Under Rex, `maximize`, `float`, `fullscreen`, `font-size` and `new-window` set in config are Ghostty preferences and are ignored silently, as `clean=true` already was. The flags (`--maximize`, `--float`, `--fullscreen`, `--font-size`, `--clean`, `--new-window`) still print their notice. The on-stop note (`summon: note: on-stop will run on workspace exit.`) is still printed, and no longer keeps the launcher tab open. `summon doctor` names the ignored settings found in the machine config once. With these, the tab now closes after a daily launch for users who share one config between Ghostty and Rex. Ghostty output does not change.
- Warnings and notes use one prefix each, `summon: warning:` and `summon: note:`, on stderr as before (the earlier `Warning:`, `Note:` and `⚠ Warning:` forms are gone, and config warnings that had no prefix, such as `Invalid panes value`, now have it). An unknown command with `--help` and an untrusted `.summon` now print `summon: error:` like every other error. Only the prefixes change; the text after them, the streams and the exit codes are the same.
- A mistyped subcommand gets a suggestion when it is a prefix or one edit away (`summon stauts` prints `Did you mean: summon status?` and no longer says to register `stauts` as a project). The `Did you mean` line now comes right after the error. `summon remove` and `session` print it too for a project name that is not registered, and `focus`, `inspect`, `title` and `clean` print it for a name that is not registered and has no workspace record. Exit codes do not change (`focus`, `inspect`, `title` and `clean` still exit 2).
- The setup wizard's tips are correct and match the detected terminal: `summon session add <name> <project>...` (there is no `session save`), `summon . --dry-run` (it needs a target), `--on-start` runs before the workspace is created, and the `--font-size` tip shows under Ghostty only. When a first-run wizard is followed by the launch you asked for, it ends with `Summoning your workspace now…` instead of telling you to run `summon .`.
- A Rex launch on an interactive terminal shows a transient `Summoning <project>…` line on stdout while the session is created, and says when it opens the Rex app; the line is cleared before the result. Piped output does not change.
- Development dependencies: `@types/node` now follows the Node.js 22 floor (`^22.12.0`), and eslint 10.12.0, typescript-eslint 8.71.2 and actions/setup-node 7.1.0 are picked up. The published package does not change.
- A `.summon` that changed after you trusted it (for example after `git pull`) is now reported as `This project's .summon file changed since you trusted it.` instead of `This project has a .summon file.` On a terminal, a launch (direct, `--dry-run`, `summon open`, the picker or Enter in `summon status`) then shows the file, with control characters escaped, and asks `Trust this file and continue? [y/N]`. `y` trusts exactly the content shown and continues; `n`, Enter, Escape or Ctrl+C trusts nothing and exits 130, except in `summon status`, where it shows `Launch cancelled.` and returns to the dashboard. Without a terminal the launch fails with exit 1 as before, and `summon session` (a named session or `--all`) still skips the project without asking.
- The persistent config cache (`~/.config/summon/cache.json`) is removed. Measured, it saved nothing (median `summon list` 45.05 ms with it, 44.34 ms without) and it wrote the file on every exit. Config is read from disk as before; `SUMMON_NO_CACHE` is accepted and has no effect. An old `cache.json` is no longer read, and you can delete it.
- More `env.<KEY>` keys are ignored with the existing `ignoring denylisted env var key` warning, because both backends apply them before the pane shell starts and they change what runs at startup or in common tools: `ENV`, `SHELL`, `PS1`, `PROMPT`, `PERL5OPT`, `RUBYOPT`, `GIT_ASKPASS`, `SSH_ASKPASS`, `LESSOPEN`, `LESSCLOSE` and every key that starts with `GIT_CONFIG`. `PATH`, `PYTHONPATH`, `ZDOTDIR` and `HOME` stay allowed; the docs say that the first three change what runs and should be reviewed in a trusted file like its commands. The README and the user manual now say that trusted env values are applied before the shell starts and list every denied key (SE-L3).
- The README and the user manual list `SUMMON_NO_SPINNER`, `FORCE_COLOR`, `TERM_PROGRAM`, `XDG_CONFIG_HOME` and `SUMMON_NO_VISIBILITY`.

### Fixed

- A config, status or trust lock left by a crashed Summon no longer blocks writes for good when its process ID was reused (or the process check is refused): a lock whose owner token is more than 60 seconds old is now treated as stale and removed. A transaction holds the lock for milliseconds and a waiter gives up after 3 seconds, so a live owner keeps its lock. Leftover `<file>.lock-<token>.tmp` directories from a killed Summon are removed when they are more than 60 seconds old (BE-L2).
- `summon doctor` now checks lock files under `~/.config/summon` and its `status` folder. It names a lock whose owner is gone, more than 60 seconds old (5 minutes for a Rex launch lock, `<project>.launch.lock`), or unrecognized, and changes nothing. `summon doctor --fix` removes the stale ones with the same rule; an unrecognized lock is left for you to remove by hand (QA-L1).
- Two launches of the same project at the same time on Rex no longer create two sessions. A per-project launch lock serializes them: the second launch waits, shows `Summoning <project>… waiting for another launch of <project>` on an interactive terminal, and then switches to the workspace the first one created. A live launcher keeps the lock for up to 5 minutes, and the lock of a launcher that is gone is taken over at once. A launch that waits more than 5.5 minutes stops with `Timed out waiting for another summon launch of <project> to finish. Retry when it is done; summon doctor names a lock that stays.` (exit 1) (BE-L1).
- Two `summon trust` runs at the same time (or a trust prompt answered while another runs) no longer lose one grant: every trust DB write is now one read-modify-write under the trust DB lock (SE-L5).
- A launch from a Rex tab keeps that tab open when an `on-start` hook or an install of a missing tool ran, so their output (written straight to the terminal) is not lost when the tab closes. Hooks still get the terminal, so an interactive hook works as before. A launch without either still closes the tab. Ghostty does not change.
- A user cancel exits 130: Ctrl+C or EOF at a prompt (and Escape at a yes/no key prompt), Ctrl+C in the grid builder (it exited 0) and in a setup wizard prompt (it exited 1), `0` in the `summon open` picker (it exited 0), and declining the nested-workspace or the install prompt (they exited 1), also during `summon session --all`, and answering `n` (or pressing Enter) at the shell-metacharacter confirmation prompt (it exited 1). Declining those two prompts no longer prints `summon: error:` and the `SUMMON_DEBUG` hint. `Directory not found` and `No editor configured` (without a terminal) are printed once instead of twice. Declining to save or overwrite a custom layout still exits 0 (nothing was cancelled, only not saved), and declining "Save these settings?" still starts the wizard over. Other exit codes do not change.
- `which`, `command -v brew` and `open` (Accessibility settings) are stopped after 5 seconds, so a stuck lookup cannot hang a launch or the setup wizard.
- A Ghostty launch no longer stops with `Accessibility permission is required` when System Events is only slow to answer the 2 second check: the launch goes on, and a real denial is still reported when the workspace script runs. The setup wizard and `summon doctor` say the permission could not be checked (doctor counts it as neither a pass nor a failure). A check that answers with a denial still stops the launch before any window opens.
- A failed Ghostty launch no longer closes your own window. Before, any failure that was not about Accessibility ran `close front window`, which in the default mode (no `--new-window`) closed the window you launched into, with all its tabs. Now Summon closes only what the launch created: the window opened by `--new-window` or the tab opened by `--new-tab`, found by its id. A launch into an existing window closes nothing; any splits it had already added there stay, so close them by hand. That close is limited to 5 seconds, so a Ghostty that does not answer can no longer hang Summon after a failure. A successful launch runs the same script as before.
- The cleanup trap now works for a project directory, or a Node or Summon install path, that contains `!`. These paths are typed into an interactive zsh, where `!` inside double quotes is history expansion, so the trap failed with `event not found` and the snapshot never ran. They are now single-quoted, under Rex as well (the trap is shared). A path with a control character (for example an escape or newline) is refused with a clear error instead of being typed into the terminal.
- `summon status` rows no longer run one column past the terminal when the branch, path or reason is cut off, so the monitor no longer scrolls at narrow widths.
- The monitor keeps the selection on the same project when a refresh reorders the rows, so Enter opens the highlighted project.
- Columns in `summon status`, the monitor and the `summon open` picker stay aligned with emoji and accented text. Emoji such as ✨, ✅, ❌, ⚡, ⭐ and ⌚, emoji with VS16 (❤️), ZWJ sequences and flags count as 2 columns, as do CJK Extension B and later. Accents in decomposed (NFD) macOS paths, ZWJ and variation selectors count as 0. Symbols that terminals draw narrow, such as the ⚠ ✓ ✗ status glyphs, still count as 1. A cut-off name, branch or path never splits an accent from its letter or an emoji sequence.
- The `summon open` picker keeps its columns aligned when a Rex row shows a program-status glyph. Before, such rows were one column out of line with the others.
- `Opening <project>...` from the monitor is now printed after the monitor leaves its screen, so you see it during the launch or focus. Before, it was drawn on the monitor screen just before that screen closed.
- In the monitor, Esc dismisses the help and error screens, and the next key is no longer swallowed.
- The monitor help legend explains `partial`, `unknown` and the Rex program-status glyphs.
- zsh and bash completion now offer the built-in layout presets (`minimal`, `full`, `pair`, `cli`, `btop`) as well as custom layouts for `--layout` and `summon set layout`; fish now also completes `summon set layout`. `summon layout show|delete|edit` and `summon freeze` complete custom layouts only, because those commands reject the presets. Bash completion of subcommand arguments (for example `summon set layout`) now also works without the bash-completion package.
- `summon completions --help` gives the working fish setup line, `summon completions fish | source` (the earlier `eval (summon completions fish | psub)` passed a file path to `eval`).
- The README and the user manual no longer say that `SUMMON_DEBUG` output is also written to `~/.config/summon/logs/`: it goes to stderr only. That folder holds the cleanup trap's `cleanup-<project>.log` (the `on-stop` command output).
- After the setup wizard, a launch reads `.summon` again and checks that content against the trust store before it uses it. A `.summon` changed while the wizard waited is refused. `summon freeze` and `summon keybindings` refuse an untrusted `.summon` with the same message as a launch (`freeze` accepts `--no-project-config`), so `freeze` can no longer copy untrusted commands into a layout.
- A Rex launch that the server rejected or never received no longer leaves its manifest behind, so later launches and `summon status` stop reporting it as an earlier launch that never confirmed its session. A launch whose connection dropped or reset after it was sent is now treated as an unknown outcome (its manifest stays, so the session can still be adopted), not as one that created nothing.
- Error text from a Rex server error object is shown with control characters escaped and capped in length, like the rest of the Rex error text.
- The monitor stays responsive when a Rex server is slow: with Rex workspaces it reads their status in a background process, so keys, resize and drawing keep working, and a refresh still running is never started twice. The header shows `updating…` while a read takes longer than one refresh, and `last updated Ns ago` after a failed one. Quitting or opening a project stops the read in progress. Ghostty-only setups read as before.
- Under Rex, closing the launcher tab no longer holds the exit for up to about 20 s on a slow server: the two checks made at exit each ask for an answer within 2 s (about 4 s at most), and a check that does not answer keeps the tab. The close itself, 0.3 s after Summon exits, checks the tab again and passes `--timeout` to `rex`. A tab or a split added in that time is no longer closed with it: the session is ended only while the launcher tab is still its only tab, otherwise only the tab is closed, and a tab with a new split stays.
- A Rex launch that finds earlier launches of the project now lists the server's sessions once, instead of once for the current record and again for the earlier launches.
- A launch manifest or status record whose pane names are not pane identifiers (for example `x/../<id>`) is no longer trusted: the manifest is ignored and the record keeps no panes, so removing a launch's files can never reach another launch's file. A trust database entry whose value is not a string counts as never trusted and is dropped on the next save.

## [2.0.1] - 2026-10-31

### Changed

- Under Rex, `summon <project>`, `summon open` (with a name, from the picker, or as `summon switch`) and `summon session` close the tab they were typed in once the workspace is shown in its own session, when that tab holds only that pane. When that tab is its session's only tab, the session is ended (`rex kill`), so no empty launcher tab or session stays behind (Ghostty reuses that tab, so nothing changes there). A tab with splits, a workspace tab, a failed launch, a dry run, a Summon run by an agent or a script, and any run that printed a note or a warning to read are left alone. A command chained on the same line (`summon <project> && make`) runs in a tab that closes about 0.3 s after Summon exits.

### Fixed

- Launching a project whose status record came from an older Summon no longer prints `run summon <project> to replace it`: the launch replaces it. `summon status` and `summon clean --orphans` still say it.
- `summon status --once` (and `summon status` piped) shows the git branch of live (active or partial) workspaces instead of `…`; one outside a git repository shows `—`.

## [2.0.0] - 2026-10-31

### Added

- Launching inside a Rex terminal (or with Rex installed and Ghostty absent) creates a Rex session named after the project, one block per pane, and shows it in the Rex app attached to the caller's own Rex session, else the newest connected app. Running `summon <project>` again while that session is alive switches to it instead of creating another; `--new-window` creates a fresh session (shown in the current Rex window: Rex opens new windows with their own session, so this flag cannot open one) and says once that the earlier session stays open; later switches do not repeat it. `maximize`, `float`, `fullscreen` and `font-size` (flag or config) and the `--clean` flag are ignored under Rex with one notice each; a `clean=true` config value is ignored silently. `summon session` under Rex creates one session per project and returns to the first, reporting `Switched to <project>` for a project already running. A launch from a pane of a Summon workspace does not warn about nested splits under Rex. `summon setup` skips the Ghostty install and Accessibility steps under Rex; `summon doctor` gains a Rex section and marks the Ghostty checks "not applicable" when Ghostty is absent and Rex is present. `summon keybindings` notes that Rex key bindings live in `~/.config/rex/init.lua`.
- The terminal backend is resolved automatically right after config resolution: the terminal running Summon decides (`TERM_PROGRAM`), an inherited `REX_SERVER` counts only when `rex whoami` answers on it, otherwise Ghostty if installed, else Rex if installed. The `rex` CLI is searched on `PATH`, then in `REX_BIN_DIR`, then inside the Rex app bundles.
- `summon clean <project>` closes an empty Rex session (refuses with the live pane names otherwise), saves a snapshot, marks the record ended and removes the launch files; `summon clean --orphans <project>` reviews earlier launches (closes empty sessions, removes files the server confirms gone, prints the exact command for anything it will not touch); `--orphans` with any other command warns that it has no effect, and shell completion offers `--orphans` and project names after `clean`. A Rex workspace that ended outside Summon is reconciled on the next status read: snapshot, `endedAt` on the record, then its launch files, with one notice. `summon status` and `summon inspect` show the root pane's program status (OSC 7501: blocked, error, working, done) for Rex workspaces. See `docs/rex.md`.
- `summon status`, the monitor, `summon open`, `summon focus`, `summon inspect`, `summon title`, `summon briefing` and `summon ports` understand Rex workspaces: a Rex record resolves to `active`, `partial` (root pane closed, other panes alive), `stopped` or `unknown` (server unreachable) with a reason; `unknown` is never launched over or focused (`open` exits 2 with the reason); `focus`, `inspect` and `title` work through the Rex server (block ids instead of terminal ids; the tty is not available under Rex); the briefing lists `unknown` workspaces as unverified. Launches with an unknown outcome are adopted on the next status read.
- `--dry-run` inside a Rex terminal prints the Rex `session.create` request a real launch would send (one block per pane, each an interactive login shell started under `/usr/bin/env` with the workspace variables), the server it would target and the pane order its block ids arrive in. A recorded Rex workspace is noted. Beyond the read-only `rex whoami` probe of backend detection, no Rex command runs during a dry run.
- Switching to a running Rex workspace (`summon <project>` again, the end of `summon session`) picks the app the way creation does: the app attached to the caller's own Rex session first, else the newest, with the same notice when several apps are connected. A Rex record whose identity could not be read refuses an ordinary launch (`--new-window` replaces it). A named-session dry run no longer selects a session at the end.
- A mistyped project name now ends with `Did you mean: chapa, chapa-cli?` (up to three registered names by prefix, subsequence or small edit distance, most recently launched first); the exit code and the target do not change. Help, completions, README, `CLAUDE.md` and `docs/architecture.md` describe both terminals; `docs/rex.md` is the Rex contract.

### Changed

- **Breaking:** `summon` run inside a Rex terminal now creates a Rex session instead of driving Ghostty (with the `rex` CLI found; there is no flag or config key to override it). To keep launching Ghostty workspaces, run `summon` from Ghostty or another terminal.
- **Breaking:** the Node.js engine requirement is now `>=22.12` (was `>=20.19`), the Vite 8 floor. The bundle targets `node22`, CI tests Node 22 and 24, and the post-publish smoke matrix covers Node 22.12 and 24.
- `summon open <project>` (and `summon switch <project>`) act on one project directly: a running workspace is focused, a stopped one launches with the flags given, and one whose liveness cannot be read is refused with the reason (exit 2). The notices that already said `run summon open <project>` now describe a command that exists. Without a name both still show the picker. Shell completions offer project names for `open` and `switch`.
- Every launch now has a launch id. Liveness sidecars live under `status/<project>.launches/<launchId>.*`, the cleanup trap removes only its own files, and the shared status record is written only by Node under a file lock with an explicit ownership expectation. Records gain optional `launchId`, `backend`, `rex` and `endedAt` fields (schema version stays 1; see `docs/decisions/status-record-launch-ownership-and-backend.md`).
- `--dry-run` output gains two header lines, `-- Backend:` and `-- Launch:`. A dry run on a machine with neither Ghostty.app nor the Rex CLI prints the Ghostty script with a notice instead of failing.

### Fixed

- `summon --help` said `--clean` and the `clean` key default to on; they default to off (since #362), as the README says.
- zsh and bash complete `true`/`false` after `summon set <boolean key>` again (they compared a literal string since 0.7.0).
- `summon status --once` prints a reason the detail column cuts off in full on the next line, so a recommended command such as `summon clean <project>` stays visible at 80 columns.
- `summon ports` with registered projects but no detected port explains where ports are read from instead of asking to register a project.
- The cleanup trap removes the launch's liveness files before it runs the `on-stop` hook and the snapshot save, so a trap the terminal cuts short under load rarely leaves a `.pid` behind that a reused process id could make look alive (a kill before the trap's first command still can).
- The cleanup trap's `summon snapshot save` and the `on-stop` hook no longer inherit the pane's terminal (`</dev/null >/dev/null 2>&1`). After `rex kill` or a window close the pty is already hung up, and Node aborts at startup when a standard descriptor is such a pty, so the trap never wrote the on-exit snapshot itself (observed under Rex, where the next status read's reconciliation hid it; a terminal window close is expected to behave the same).
- A registered project that was never launched showed as `unknown` in `summon status`, the picker and the briefing, the state Summon reserves for a workspace whose liveness could not be read, so `summon open` and the monitor's Enter key refused to launch it. It is `stopped` now, and launches.
- The cleanup trap typed into every workspace called `summon snapshot save` by name, so the on-exit snapshot was saved by whatever `summon` was on the pane's PATH at the time (an older install, or none). The trap now runs the same node binary and the resolved script path (the bin symlink of a global install resolved at launch time) that created the launch.
- A command whose executable is an absolute path (`pane.enhance=/opt/homebrew/bin/gh-glance`) no longer fails a Ghostty launch as "required but not installed". Summon accepts a full path to an executable file, keeps it as written, and reports a missing path, a `~/` or relative path, and a missing command on PATH with different messages. For a tree pane the fix hint now names `summon layout edit <layout>` and the `pane.<name>=` line instead of `summon set <name>`, which `summon set` rejects.
- `--dry-run` under Ghostty now prints one `summon: note:` line on stderr for each command that a real launch would reject (or offer to install). The script on stdout and the exit code do not change. Rex launches do not check commands.
- `summon snapshot save --dir … --project … --layout …`, the call made by the workspace cleanup trap, was rejected by the global flag parser ("Unknown flag '--dir'") so the on-exit snapshot never saved. The flags are now parsed like every other option (and `--layout` is validated as a preset only for launches); `--launch <id>` performs a generation-checked save.

## [1.9.0] - 2026-10-29

### Added

- `summon inspect <project> [--json]` reads workspace state and current native pane observations without activating Ghostty.
- `summon focus <project> [pane]` targets the recorded root or named pane by exact native terminal identity, including after a tab moves to another window.
- `summon title <project> [pane]` reads, sets or resets tab and pane title overrides, with Unicode validation and confirmed readback.
- `summon keybindings --detach-tab` prints an optional whole-tab detachment binding after checking action support.
- A Ghostty workflow guide with compatibility, recovery and opt-in SSH pane recipes, verified through real parsing and dry runs.

### Changed

- Doctor now reports installed capabilities and effective configuration, recommends Ghostty 1.4.0 while retaining 1.3.1 launch support, and limits automatic fixes to eligible missing settings in an unambiguous existing file.
- The interactive monitor negotiates terminal visibility and pauses regular work when the terminal reports hidden. Unknown visibility retains normal polling; `SUMMON_NO_VISIBILITY=1` disables negotiation.
- The project picker now confirms exact native focus, and monitor Enter focuses active workspaces instead of launching replacements. Legacy or closed targets receive recovery guidance.
- Release verification now records candidate-bound probes, fixture cleanup and independent exploratory evidence before tagging. npm publishing uses the existing GitHub Actions provenance workflow.

### Security

- Updated `brace-expansion`, Vite, Vitest and `source-map-js` to patched releases for the reported build and test tooling advisories.
- Hardened command confirmation, resolved-command quoting, hook trust and redaction, project-relative pane paths, and state-file cleanup.
- Title mutations reject control and bidi override characters and disclose unknown outcomes without automatically retrying a write.

### Fixed

- Kept ordinary CLI failures concise, with full stack diagnostics available through `SUMMON_DEBUG=1`.
- Serialized project registry and machine configuration updates across CLI processes to preserve concurrent changes, and removed contender staging before waiting on a busy lock.
- Restored monitor terminal modes on SIGINT and SIGTERM, and displayed the narrow-terminal warning at the actual terminal width.
- Preserved unrelated doctor failures after `--fix` and prevented speculative changes when configuration evidence is unavailable.
- Isolated test fixtures from host configuration and installed applications, and compiled native scripts only when the installed dictionary supports their capabilities.

## [1.8.0] - 2026-06-14

### Added

- **Persistent cross-invocation config cache.** A `~/.config/summon/cache.json` file now caches machine config and the project registry across CLI invocations. Entries are keyed by absolute path + `mtimeMs` + `size`, so any external edit is a cache miss and is re-read; the cache is written atomically (mode `0o600`) and silently ignored if corrupt. Set `SUMMON_NO_CACHE=1` to disable it entirely. (#516, #330)
- **`summon doctor --verbose`** prints a full diagnostic context — summon version, Node.js version, config directory, Ghostty path, accessibility status, and the trust database path with trusted-project count — without needing `SUMMON_DEBUG=1`. (#502)
- **`summon ports` positive confirmation.** When ports are detected and none conflict, `summon ports` now prints `✓ No port conflicts` instead of returning silently. (#442)
- **Recoverable session tab failures.** A new `TabOpenError` lets `summon session --all` warn and continue with the remaining projects when Ghostty fails to open a tab for one project, instead of aborting the entire run. (#518)
- **`--no-project-config` and `trust <path>` in zsh completions**, and **`fish` completions fully wired** through the dispatcher (`summon completions fish` now emits a valid script; bash/zsh suggestions list `fish` as a target). (#444, #527, #539)
- **Layout-builder numbered quick-pick.** The pane-command prompt in `summon layout create` lists detected tools by number — type `1`, `2`, … to pick without retyping; `c` opens free-text; Enter defaults to `shell`.
- **`summon open` cancel.** Entering `0` at the open picker prints `Cancelled.` and exits 0. (#475)
- **First-run setup continues to launch.** After the first-run wizard completes, `summon <directory>` proceeds to open the workspace without a second invocation. (#476)
- **Setup wizard back-navigation** on the Editor and Sidebar steps (`b`/`0`), with the misleading back hint removed from step 1. (#482, #483)
- **`--vim`/`--fix` misuse warnings**, `switch` shown as an alias of `open` in `--help`, and a `Docs & more` repo link in the help footer. (#621, #452, #518)

### Changed

- **Dangerous-command confirmation now defaults to _no_.** The shell-metacharacter prompt changed from `[Y/n/s]` to `[y/N/s]`; pressing Enter without typing now **aborts** the launch instead of proceeding. Scripts that relied on enter-to-confirm must now send an explicit `y`. (#528)
- **`on-start` failure is non-fatal.** A failing `--on-start` command now warns and continues launching the workspace instead of aborting, so pre-flight checks can fail gracefully. (#594)
- **`--new-window` and `--new-tab` are mutually exclusive** — passing both now produces a clean usage error at parse time. (#525)
- **Unified error output.** All user-facing errors now flow through a single writer emitting a consistent `summon: error: <msg>` prefix (red `✗` when color is enabled), replacing the previous mix of `Error:` / bare / inconsistent prefixes. (#568, #598, #600, #601, #602)
- **Trust errors include the real project path.** Untrusted `.summon` errors now print `Run 'summon trust <resolved-path>'` instead of `summon trust .`, which is correct when launching a project by name from another directory. (#590)
- **`env.*` config keys no longer warn.** `summon config` no longer prints `unknown config key: env.API_URL` for valid `env.*` entries; conversely, invalid `env.*` key names in machine config now emit a warning instead of being silently dropped. (#618)
- **Verified new-tab/new-window creation.** The generated AppleScript now snapshots the tab/window count, retries the `Cmd+T`/`Cmd+N` keystroke up to N times, and raises a named error if it never takes effect — eliminating the silent wrong-tab binding when Ghostty drops a keystroke. `session --all` also adds a 200ms inter-launch delay. (#543, #544, #518)
- **Config robustness.** Hand-authored `# comment` lines are preserved across writes; inline `# note` text in values is no longer stripped (values round-trip verbatim); malformed-line warnings are capped at 5 with a suppressed-count summary; config files over 1 MiB are skipped with a warning. (#494, #533, #620)
- **Snapshot/session names are validated** against path traversal before any filesystem access, and reserved names are rejected cleanly. (#531, #532)
- **Atomic writes hardened.** Temp files use a unique `<pid>.<rand>.tmp` suffix (no concurrent-write races during `session --all`) and default to mode `0o600`. (#524, #574)
- **Status monitor accessibility.** Long-running workspaces (>4h) show `active*` so they are distinguishable without color; the help-overlay legend shows glyph markers alongside colors; a too-narrow terminal shows a `widen to ≥N cols` hint instead of a broken grid. (#599, #616)
- **Spinners degrade gracefully.** Launch and `session` spinners print a single static label under `NO_COLOR`, `SUMMON_NO_SPINNER`, or a non-TTY stdout instead of animating. (#615, #519)
- **Wider `.summon` env denylist.** Command-carrying variables (`GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `PAGER`, `EDITOR`, `VISUAL`, `GIT_EDITOR`) are now denylisted, and a pane `cwd` that escapes the project directory is rejected at config-resolution time. (#609, #593)
- **CJK/wide-character-safe truncation** in `status`, `ports`, and `briefing` columns (Japanese/Chinese/Korean names and emoji no longer break alignment). (#505)
- **Cleaner interrupts and `doctor --fix`.** Ctrl+C during any wizard exits cleanly instead of printing a stack trace, and `doctor --fix` now reflects applied settings within the same invocation.
- **`--clean` prelude is skipped for `--new-window`**, so opening a new window no longer closes panes in an unrelated existing session. (#496)

### Fixed

- **Liveness-safe status cache.** The status-directory cache was replaced with a 1000ms wall-clock TTL, so a process that dies without touching the status directory is no longer reported "active" indefinitely. (#607, #570)
- **Trust symlink normalization.** `isTrusted`/`assertTrusted`/`assertTrustedContent` now resolve real paths, fixing macOS `/tmp` → `/private/tmp` mismatches that forced spurious re-trusting. (#471, #590)
- **Trust fails closed** on non-`ENOENT` read errors and warns (with path + reason) on a corrupt `trust.json` instead of silently treating projects as untrusted. (#493, #495)
- **Stricter port parsing.** Malformed ports like `3000abc` are rejected instead of being silently truncated, and oversized `package.json` files are skipped during port detection. (#591)
- **Phantom entries filtered.** Orphaned `.tmp` files and dotfiles (e.g. `.DS_Store`) no longer appear in `layout list`, `session list`, or `status`; failed renames clean up their temp file. (#605)
- **Newer-schema warnings** for status and snapshot files are now printed to stderr instead of the record being silently dropped. (#606, #514)
- **Setup wizard fixes:** 256-color `colorSwatch` fallback, corrected monitor color legend, restored overlay terminal state, and preview width snapshotted at construction so a mid-wizard resize no longer scrambles output. (#550, #529, #580, #581, #582, #589, #612)

### Performance

- **Zero-import `--version` / `--help` fast path.** A pre-import guard handles single-token `--version`/`-v` before any module loads; `--help` skips config, trust, and utils. Only subcommand/launch paths load the full import graph. (#569)
- **Bounded-pool git collection.** `status`, `briefing`, and `monitor` collect git data via a work-stealing concurrency limiter (`runPool`, `IO_CONCURRENCY`) instead of unbounded `Promise.all` or serial loops. (#603, #617)
- **Fewer syscalls in `ports`.** Framework-config detection replaced up to 24 `fs.access()` probes per project with a single `readdir`. (#442)
- **Monitor render efficiency.** The refresh loop skips the terminal write when a frame is identical to the previous one, and reuses prefetched git branches instead of triggering a second status rescan.
- **Force-reaped git timeouts.** `gitOutput`/`gitOutputSync` use `killSignal: "SIGKILL"` so a git process that ignores `SIGTERM` is still cleaned up at the 5s timeout. (#619)

## [1.7.0] - 2026-06-10

### Added

- Fish shell completions: `summon completions fish` is now fully supported alongside zsh and bash. Add `summon completions fish | source` to `~/.config/fish/config.fish`.
- zsh completions now include `--no-project-config` flag and path-completion for the `trust` subcommand.
- Progress line `"Launching <target>…"` is now printed to stderr before the workspace opens, so the terminal no longer appears to hang during a multi-second launch.
- Exit codes are now documented in the user manual: 0 (success), 1 (usage/config error), 2 (pre-launch guard failure), 130 (cancelled). Unexpected errors hint at `SUMMON_DEBUG=1` for full diagnostics.

### Changed

- **Dangerous-command confirmation now defaults to no.** Pressing Enter at the `Continue? [y/N/s(kip pane)]` prompt aborts the launch. Previously, Enter accepted the command (default yes). Any scripts or workflows that relied on enter-to-confirm must now send explicit `y`.
- Doctor diagnostics and launcher progress messages are now written to stderr. Stdout is reserved for machine-readable output (`export`, `status --once`). Pipelines like `summon export > .summon` are no longer polluted with human-facing chatter.
- Empty-state "no projects registered" messages unified across `list`, `open`, `status`, and the TUI monitor.
- Error message prefixes standardized to `summon: error:` across all commands.
- `on-start` command string is no longer echoed to stdout at launch; it is written to the debug log only when `SUMMON_DEBUG=1` is set.

### Fixed

- `summon session --all` no longer silently builds a project's workspace on top of the previous project's tab. New-tab and new-window creation now anchor the target window, verify the tab/window actually opened (retrying a dropped keystroke up to 2 times and polling for up to 0.6s per attempt), and a project whose tab cannot be opened is reported and skipped instead of disappearing. A 200ms inter-launch delay is added between projects to reduce cross-process keystroke contention.
- `--new-window` and `--new-tab` are now caught as conflicting flags at parse time and produce a clean usage error instead of an unhandled stack trace from deep inside the layout engine.
- `atomicWrite` now uses a `pid + randomBytes(6)` temp-file suffix instead of a fixed `.tmp` suffix, eliminating a concurrent-write race that could corrupt `trust.json` during `session --all`.
- Config values containing ` # ` (inline comment syntax) are no longer silently truncated on read. `on-start = build # release` now round-trips correctly.
- Snapshot and session commands now validate input at parse time. Path-traversal inputs (e.g. `../etc/passwd`) produce a clean error instead of an uncaught stack trace.
- Monitor help overlay color legend corrected: green = active, yellow = active >4h, dim = stopped. The previous legend was factually wrong.
- Monitor table columns and `truncateLine` in `ui/ansi.ts` are now display-width-aware for CJK characters and emoji. Wide characters no longer break table alignment.
- `--new-tab` is restored to the main `--help` Options list. Help text now wraps gracefully on narrow terminals instead of truncating with `…`.
- Symbol vocabulary (`✓` / `⚠`) unified: `project.ts`, `setup.ts`, and `snapshot.ts` now use the canonical glyphs from `ui/symbols.ts` instead of hardcoded alternatives.
- `snapshot.ts` color helpers deduplicated — `dim`/`green` now imported from `ui/ansi.ts`.
- `secondaryEditor` now round-trips through config: `freeze` no longer silently drops it.
- Module-global `scriptCache` removed from `script.ts` — `generateAppleScript` is now a pure stateless function (the cache never hit in production).
- `trust.ts` now imports `TRUST_FILE` and `CONFIG_DIR` from `paths.ts` instead of re-deriving them, preventing silent drift if the config directory is ever relocated.
- Cleanup log directory (`~/.config/summon/logs/`) is now created with `mode: 0o700`, matching the permissions of other summon state directories.
- `colorSwatch` in `ui/ansi.ts` returns a 256-color block on non-truecolor terminals so the Starship preset picker renders correctly on common terminal emulators.
- Layout presets in `--help` deduplicated: the hardcoded "Layout presets:" block is removed; only the single `LAYOUT_INFO`-generated "Layouts:" block remains.
- `PreviewRenderer` in the setup wizard now computes physical row counts (wrap-aware) for cursor-up redraws, preventing smeared output on narrow terminals.
- Setup wizard grid builder now documents Shift+Tab reverse navigation in the on-screen hints.

### Internal

- Publish workflow: added idempotency guard — a rerun after a transient failure skips the `npm publish` step if the version is already live, allowing the smoke-matrix to complete cleanly.
- npm tarball verification now asserts `README.md` and `LICENSE` are present in the published package.
- CHANGELOG/version/tag consistency check moved to the first step of the publish job (before `pnpm install`) to fail fast on mismatches.
- Added `SUMMON_E2E=1` job to CI that runs the AppleScript syntax E2E suite on `macos-latest`.

### Fixed

- `summon session --all` no longer silently builds a project's workspace on top of the previous project's tab. New-tab and new-window creation now anchor the target window, verify the tab/window actually opened (retrying a dropped keystroke up to 2 times and polling for up to 0.6s per attempt), and a project whose tab cannot be opened is reported and skipped instead of disappearing. A 200ms inter-launch delay is added between projects to reduce cross-process keystroke contention.

## [1.6.0] - 2026-06-04

### Added

- **Fish shell completions** — `summon completions fish` is now fully wired through the completions dispatcher. Fish users get the same project-name, layout, and config-key completions as zsh/bash.
- **`summon doctor --verbose`** — prints version, Node.js version, config directory, Ghostty binary path, and trust DB summary alongside the usual health checks.
- **Ghostty-specific accessibility messages** — the setup wizard and doctor now show Ghostty-tailored guidance for granting Automation and Accessibility permissions instead of generic macOS instructions.
- **Layout builder quick-pick** — the template gallery can now be navigated by typing a number directly at the quick-pick prompt in addition to scrolling.
- **Diagnostic info via `SUMMON_DEBUG`** — `SUMMON_DEBUG=1` now emits richer diagnostic output including config resolution trace and trust-check results.

### Fixed

- **Trust: symlink normalization** — `assertTrusted` now resolves symlinks before hashing, so projects accessed via symlinked paths trust-check the canonical real path (#471).
- **Trust: `.summon` reads in `ports`** — `ports.ts` now verifies trust before reading any `.summon` file; untrusted files are silently skipped (#472).
- **Performance: lazy launcher graph** — the full launcher graph (launcher, script, tree, etc.) is now loaded via dynamic `import()`. Normal subcommands (`list`, `status`, `doctor`, etc.) no longer pay the startup cost of loading the entire launch subsystem (#473).
- **UX: `summon open` cancel affordance** — the open picker now shows `(0 to cancel)` and exits cleanly when `0` is entered instead of re-prompting on out-of-range input (#475).
- **UX: post-wizard auto-launch** — after completing the first-run setup wizard, summon now continues to launch the target workspace instead of exiting (#476).
- **UI: unified color detection** — `supportsColor()` is now a single canonical implementation checked at call time; the three divergent inline copies have been removed (#477).
- **UI: canonical glyph vocabulary** — `✓`, `⚠`, `✗`, `·`, `•` exported from `ui/symbols.ts` and used consistently across all commands; mixed glyph sets replaced (#478, #479).
- **UI: TUI help color legend** — the `?` overlay in `summon status` now includes "Colors: yellow = active  dim = stopped" (#481).
- **UX: wizard back-navigation** — step 1 no longer shows a misleading "press b to go back" hint; Editor and Sidebar steps now correctly support `b` back-navigation (#482, #483).
- **UX: confirm prompt polarity** — dangerous command prompt changed from `[y/N/s]` to `[Y/n/s]` so pressing Enter accepts (matches the rest of the CLI) (#484).
- **Security: shell-escape lint gate expanded** — the static analysis test now covers `sendCommand(…)` and `setInitialInput(…)` helper calls in addition to raw template literals (#485).
- **CI: sourcemaps excluded from npm tarball** — source maps are no longer published; package size reduced from ~613 KB to ~156 KB (#488).
- **CI: tarball guard hardened** — the release workflow now verifies `dist/index.js` + at least one `chunk-*.js` exist in the tarball (#489).
- **CI: OIDC trusted publisher** — removed the now-redundant `NODE_AUTH_TOKEN`; `npm publish --provenance` authenticates via the OIDC trusted publisher already registered on npmjs.com (#490).
- **Backend: atomic file writes** — `status.json`, `snapshot.json`, `trust.json`, and config files are now written to a temp file then renamed (POSIX-atomic), preventing torn writes on crash (#491, #492).
- **Backend: forward-compatible schema readers** — `readWorkspaceStatus` and `readSnapshot` return `null` for records with `version > 1` instead of hard-rejecting with an error (#491).
- **Backend: corrupt trust DB warning** — `loadTrustDb` now emits a `SUMMON_DEBUG` warning on corrupt JSON instead of silently swallowing the error (#493).
- **Backend: config comment preservation** — inline comments in `.summon` and machine config files are preserved across `setConfig` / `writeKV` calls (#494).
- **Backend: trust fail-closed** — `assertTrusted` now rethrows non-ENOENT IO errors (e.g. permission denied) instead of silently bypassing the trust gate (#495).
- **Backend: `clean` prelude scoped** — `emitClosePrelude` now targets only the active workspace window, not all open Ghostty panes (#496).
- **UX: CJK/emoji widths in layout previews** — characters in the double-width Unicode ranges (CJK, Hangul, emoji) now occupy two terminal columns in layout diagrams (#505).
- **UX: terminal-width wrapping** — `--help` output, the help/ports table, and layout previews now wrap at the current terminal width instead of overflowing (#506, #507).
- **UX: TUI launch failure recovery** — a launch error inside `summon status` now shows an in-TUI error overlay and resumes the dashboard instead of dropping back to the shell (#508).
- **UX: consistent empty states** — `summon open`, `summon list`, and `summon status` all show the same actionable "No projects found — run `summon add …`" message (#509).
- **UX: pane-layout legend in `--help`** — the built-in layout preset diagrams are now included in `summon --help` output (#510).
- **UX: clean Ctrl+C exit** — `PromptCancelled` is caught at the top level so Ctrl+C prints nothing instead of a Node.js stack trace.
- **UX: `doctor --fix` stale-read** — `--fix` now re-reads the Ghostty config after writing, so checks pass immediately after applying a fix.

### Infrastructure

- Release smoke tests now cover Node 20.19.0 (minimum floor) and Node 24 (latest), in addition to Node 22 (#502).
- `pnpm build` added to the Husky pre-commit hook so the build is verified before every commit (#503).

## [1.5.2] - 2026-05-19

### Fixed

- **`summon session --all` no longer aborts on the first untrusted project.**
  Encountering an untrusted `.summon` file used to terminate the whole session
  via `process.exit(1)` from inside `launch()`, with the spinner swallowing the
  error so the user saw only a few tabs open and no clear reason. The trust
  gate now rethrows `SummonError`, and `session` catches it per-project: prints
  a warning with the exact `summon trust <path>` hint, continues with the
  remaining projects, and reports `N launched, M skipped (untrusted)` at the
  end. Direct `summon <project>` launches still exit cleanly on untrusted
  files via a top-level catch in the CLI entry.

## [1.5.1] - 2026-05-19

### Fixed

- **Empty pane commands are valid again.** A blank pane definition (e.g. `pane.shell=`)
  opens a plain shell — the over-strict guard added in 1.5.0 incorrectly rejected this,
  breaking `summon session --all` for any layout that included an empty pane (notably
  the `standard-rpi` template).

## [1.5.0] - 2026-05-11

### Added

- **`summon session`** — multi-project tab orchestration: launch a saved set of projects
  as separate Ghostty tabs in one command. Subcommands: `add`, `remove`, `list`, `show`,
  `--all` (launch every registered project). Sessions stored in `~/.config/summon/sessions/`.
- **Auto-clear restored panes** — stale panes from a prior Ghostty session are now cleaned
  up automatically on workspace launch (controlled by the `clean` config key; see Changed).
- Workspace monitoring subcommands: `briefing`, `monitor`, `ports`, `snapshot`, `status`
  (introduced as part of the workspace management suite).

### Changed

- **Trust gate is now fail-closed by default.** Projects with a `.summon` file are blocked
  until the user explicitly runs `summon trust <dir>`. The file's SHA-256 hash is stored and
  re-verified on every launch; a changed file requires re-trusting.
- **`--clean` / `clean` config key defaults to `off`.** Auto-close of restored panes must
  now be explicitly enabled via `--clean` or `clean=true` in config. Previously defaulted on.
- `summon doctor` output now shows `✔` / `✖` indicators with a pass/fail count summary
  and auto-fixable count (`--fix`).
- `summon open` uses the monitor TUI picker instead of a plain numbered list.
- Setup wizard gains back-navigation, preview re-enable after validation errors, and a
  legend for layout preview labels.
- Monitor TUI: branch names truncated with `…` on narrow terminals; stopped workspaces
  display their directory path instead of an em dash.
- CLI help text colorized (bold section headers, cyan command names, dim descriptions).
- Unknown commands suggest `summon --help`; bare `summon` with no projects shows an
  actionable empty-state hint.
- Config key validation now rejects keys containing `=`, newlines, or a `#` prefix.
- `summon trust` displays the SHA-256 hash of the trusted file for verification.

### Fixed

- Security: single-read `.summon` validation eliminates TOCTOU race between hash check
  and config parse.
- Security: `PROJECT_NAME_RE` hardened — rejects names with shell metacharacters
  (`;`, `|`, backticks) that could reach AppleScript or shell contexts.
- Config: inline `# comment` stripping in KV files; CRLF normalization; mtime-based
  memoization for repeated reads within a session.
- Trust: path normalization for symlinks and relative paths before hashing; fail-closed
  on IO errors (permission denied no longer silently bypasses trust).
- Launcher: non-empty pane commands validated before AppleScript generation; rollback
  skips `closeWorkspaceWindow` on accessibility errors.
- Monitor: async git branch reads; `NO_COLOR` respected for INVERT escape; narrow-terminal
  floor at 60 columns.
- Port detection: regex hardened to avoid false positives inside string literals and
  unrelated process args.
- Completions: dynamic layout list generated at shell completion time rather than hardcoded.
- Snapshot: negative `formatTimeSince` diffs clamped to `0`.
- Code splitting re-enabled (`splitting: true`) to un-nullify dynamic import pattern;
  all chunks included in published tarball via `files: ["dist"]`.

### Infrastructure

- Node 24 added to CI matrix; `timeout-minutes: 15` added to build jobs.
- pnpm store caching in CI for faster installs.
- SECURITY.md expanded with vulnerability reporting process.
- E2E AppleScript syntax test guarded with Ghostty presence check
  (`/Applications/Ghostty.app`) — skips automatically on machines without Ghostty.

## [1.4.2] - 2026-05-10

### Fixed

- `summon trust .` now stores the absolute project path so trust persists across
  launches. Previously the literal `"."` was recorded, never matching the resolved
  target dir on subsequent runs.
- Pane cleanup on launch no longer requires the front tab title to contain the
  project marker. Re-launching a project from any tab clears the existing panes
  and renders the fresh layout. `--no-clean` and `--new-window` remain the
  escape hatches.

### Added

- `--no-project-config` flag — skips reading and trust-checking the `.summon`
  file. The flag was previously advertised in the trust error message but never
  wired into the parser.

## [1.4.1] - 2026-05-09

### Fixed

- Build: disabled tsup code splitting so `dist/index.js` is self-contained.
  The default ESM splitting generated chunk files excluded from the npm tarball,
  causing `ERR_MODULE_NOT_FOUND` on install.

## [1.4.0] - 2026-05-09

### Added

- `summon trust <dir>` — direnv-style trust gate for `.summon` files. SHA-256
  hashes recorded in `~/.config/summon/trust`; trust revoked on content change.
- `SUMMON_DEBUG=1` — enables timestamped debug output to stderr and
  `~/.config/summon/logs/`.
- Fish shell completions (`summon completions fish`).
- Wizard back-navigation — press `b` at any setup step to return to previous.
- Skip-pane option in dangerous command prompt — `[y/N/s(kip pane)]`; `s`
  skips that pane and continues launching.
- Rollback on launch failure — `closeWorkspaceWindow()` called if osascript
  fails mid-launch.
- `launch-guards.ts` — `ensureGhostty`, `ensureAccessibility`,
  `confirmDangerousCommands` extracted from `launcher.ts`.
- `paths.ts` — canonical path constants (`CONFIG_DIR`, `STATUS_DIR`,
  `SNAPSHOTS_DIR`, `LAYOUTS_DIR`, `LOGS_DIR`, `TRUST_FILE`).
- `shell-escape.ts` — `escapeAppleScript`, `shellQuote`, `shellDoubleQuote`
  extracted from `script.ts`. Load-bearing lint test (`shell-escape.lint.test.ts`)
  statically enforces no raw template literal interpolates user values into
  AppleScript/shell contexts.
- `command-spec.ts` — `analyzeCommand`, `commandHasShellMeta`,
  `commandExecutable` extracted into a shared module.
- `generateAppleScript` options-object overload (`GenerateAppleScriptOptions`);
  positional signature preserved for backward compat.
- `src/commands/` — command handlers extracted from `src/index.ts`;
  `index.ts` reduced from ~1,006 to ~134 lines.
- `src/cli/parse.ts` — CLI argument parsing extracted from `index.ts`.
- `src/ui/ansi.ts`, `src/ui/layout-preview.ts` — ANSI color helpers and
  layout preview renderer extracted from `setup.ts`.
- `src/setup-gallery.ts` — template gallery data extracted from `setup.ts`.
- `gitSafeEnv()` — strips inherited `GIT_DIR`/`GIT_WORK_TREE`/
  `GIT_INDEX_FILE` to prevent hook-context git pollution.
- `PromptCancelled` error class — `promptUser` now throws instead of calling
  `process.exit(130)` on Ctrl+C/EOF.
- `--once` flag validation warning when used with non-launch subcommands.
- mtime-based KV file memoization in `config.ts`.
- Unknown config key warnings in `listConfig()`.
- `formatTimeSince` negative diffs clamped to `0s`.
- Path traversal guard for layout file paths and tree DSL `cwd` values.
- Tree DSL max nesting depth of 32 enforced.
- CRLF line ending normalization in config file reads.
- `addProject` path validation: absolute path stored, name rejects `=`,
  spaces, and path separators.
- E2E test scaffold (`src/e2e/applescript-syntax.test.ts`) — validates
  generated AppleScript via `osacompile` (gated on `SUMMON_E2E=1`).
- `AGENTS.md` — Codex/GPT compatibility manifest.
- Auto-detect and clear restored Ghostty panes on launch (`--clean` /
  `--no-clean` / `clean` config key, default `true`).
- **Workspace management subcommands:** `summon briefing`, `summon status`,
  `summon switch`, `summon ports`, `summon snapshot <save|show|clear>`.
- `on-stop` config key for post-workspace hook commands.
- `generateFocusScript()` in `script.ts` for workspace switching.
- Workspace status tracking — each launch writes JSON status + active marker.
- Shell completions for all new subcommands.

### Changed

- **Breaking:** Node.js engine requirement bumped from `>=18` to `>=20.19`.
- TypeScript bumped to `6.0.2+`.
- Vitest bumped to `4.1.5`. Vite 8 in devDependencies.
- Build: minification enabled, external sourcemaps, `files` narrowed to
  `dist/index.js`.
- CI matrix: `macos-13` runner added. Dependabot groups added.
- `resolveCommand` now uses `/usr/bin/which` directly (no shell spawn).
- `selectLayout()` return type extended to
  `Promise<string | typeof WIZARD_BACK>`.
- Status files created with `0o600` permissions.
- pnpm overrides: `picomatch >=4.0.4`, `brace-expansion >=5.0.5` (CVEs).
- Removed internal agent reports and scripts from git tracking.
- Replaced setup wizard static screenshot with animated GIF in README.
- Bumped vitest 4.1.0 → 4.1.1, typescript-eslint 8.57.1 → 8.57.2,
  eslint 10.0.3 → 10.1.0.

### Fixed

- Cache git branch queries in monitor refresh with TTL-based cache (10s) (#222)
- Cache git queries in briefing data collection with session Map cache (#223)
- Skip `runMonitor` TUI tests on Node 18 (CI hang).
- Isolate CLI tests from project-level `.summon` config.
- npm publish CI fixes: `NODE_AUTH_TOKEN`, `--access public`.

### Tests

- 5 new test files: briefing, monitor, ports, snapshot, status.
- ~1,818 new test assertions with mocked git spawns and TUI functions.
- Additional tests for launcher, focus script, CLI dispatch, completions.

## [1.3.0] - 2026-03-20

### Added

- `summon layout list` now renders ASCII box-drawing diagrams showing each command in its actual pane position, replacing the dense key=value dump
- Pre-flight macOS Accessibility permission check before workspace launch — clear error with actionable guidance instead of cryptic osascript failures
- Path traversal guard on Starship preset config paths (defense in depth)
- Trust advisory when `.summon` project files are detected in a directory
- Automated npm publish workflow via GitHub Releases
- Version number shown in `--help` output header

### Changed

- Pane commands now use Ghostty's `initial input` surface config instead of shell-wrapping `set command of cfg` — panes survive command exit (TUI quit drops to a shell prompt), error output is visible, and behavior is consistent across bash, zsh, fish, and ksh
- Accessibility permission check timeout reduced from 5 s to 2 s for faster launch feedback
- Auto-install prompt for missing commands now defaults to No (`[y/N]`) instead of Yes
- All CLI error messages now use consistent `Error:` prefix and usage hints
- Nested workspace abort now exits with code 1 (was 0)

### Fixed

- Shell metacharacter confirmation now covers tree-layout pane commands (previously only checked grid-layout commands)
- Config parser (`readKVFile`) now skips comment lines instead of treating them as malformed keys
- Bash shell completions use a portability fallback for shells without `compopt`, and `freeze`/`export` subcommands now appear in completion results
- Resolved `flatted` prototype pollution vulnerability in dev dependencies
- On-start hook failure message now includes the underlying error; status message writes to stderr
- `summon doctor` exit code 2 message formatting cleaned up
- `--auto-resize` default description consistent between options and config keys sections
- Double space in `summon set editor` reset hint removed

## [1.2.1] - 2026-03-17

### Removed

- `--theme` flag and `theme` config key — Ghostty's AppleScript API does not support per-surface themes (error -10006). Set themes globally in `~/.config/ghostty/config` instead.
- `window-save-state` from `doctor` recommendations — Ghostty restores split layouts but not pane commands, creating stale splits that conflict with summon's layout management.

### Fixed

- `ENV_KEY_RE` extracted to shared constant in `validation.ts` (was duplicated in index.ts and launcher.ts)
- `summon config` now shows effective defaults when no machine config is set

### Changed

- `@internal` JSDoc tags added to all test-only exports for consistency
- `listStarshipPresets()` results are now cached (avoids repeated shell-outs)
- Branch protection on `main` hardened: `enforce_admins` and `dismiss_stale_reviews` enabled

### Tests

- 958 total tests (was 955 in v1.2.0)
- 8 weak `.toBeTruthy()` assertions replaced with `.toBeTypeOf('string')`
- 4 new tests covering tree layout + project CWD merge path
- 3 new tests for starship preset caching
- 6 new tests for `ENV_KEY_RE` validation

## [1.2.0] - 2026-03-16

### Added

- `--theme <name>` flag and `theme` config key — set Ghostty theme per workspace
- `summon doctor --fix` — auto-add missing recommended Ghostty settings (backs up config first)
- `summon freeze <name>` — snapshot current resolved config as a reusable custom layout
- `summon keybindings [--vim]` — generate Ghostty key table config for pane navigation
- Per-pane working directories via `pane.<name>.cwd` config keys in tree layouts
- macOS Accessibility permission detection in setup wizard and doctor
- Shell completions for `doctor --fix` and `keybindings --vim` subcommand flags
- Path traversal hardening: `layoutPath()` validates resolved paths stay within layouts directory
- `isGhosttyInstalled()` shared helper extracted to utils.ts

### Changed

- `summon doctor` now exits code 2 when issues are detected (was 0)
- `summon export` now includes `env.*` keys and adds a generation timestamp
- `summon config` shows removal hint for unknown keys
- `summon set env.<KEY>` now validates env var key format
- Ctrl+C during prompts exits with code 130 (was 0)
- Nested workspace warning: "messy" instead of "too scary"
- btop preset description no longer hard-codes "lazygit"
- `layoutNotFoundOrExit` now includes "Error:" prefix
- `resolveCommand` wrapper removed from launcher.ts (callers use `resolveCommandPath` directly)
- `optsToConfigMap()` and `appendDryRunExtras()` extracted as shared helpers

### Infrastructure

- Added `main` field and `publishConfig` to package.json
- Updated `typescript-eslint` to 8.57.1

### Tests

- 955 total tests (was 930 in v1.1.0)
- New test file: `keybindings.test.ts`
- Coverage improvements: optsToConfigMap, path traversal, parser edge cases, multi-pane layouts

## [1.1.0] - 2026-03-16

### Changed

- Claude CLI is no longer the default editor — setup wizard runs on first launch when no editor is configured, letting users choose any editor (vim, nvim, emacs, copilot, etc.)
- Editor catalog reordered: vim and nano (ship with macOS) listed first, Claude moved to end
- `on-start` commands from CLI flags and machine config are now checked for shell metacharacters (previously only `.summon` project files were checked)
- `layout edit` validates `$EDITOR` environment variable against `SAFE_COMMAND_RE` before use
- `summon open` re-prompts on invalid selection instead of exiting with an error
- `summon set editor ""` (and other command keys) now refuses empty string values
- `ensureCommand` messaging improved: "is not installed" instead of "is required but not installed"
- `resolveCommandAsync` in setup.ts replaced with shared `resolveCommand` from utils.ts

### Fixed

- Flaky test under v8 coverage stabilized with timeout and retry
- Duplicate `SAFE_COMMAND_RE` check removed from launcher.ts `resolveCommand` wrapper

### Tests

- 875 total tests (was 829 in v1.0.0)
- setup.ts coverage: 94.56% → 98.74% statements, 86.42% → 92.38% branches
- launcher.ts branch coverage: 89.50% → 92.50%
- utils.ts branch coverage: 83.33% → 100%

### Infrastructure

- CodeQL now runs on `develop` branch pushes and PRs (was only `main` + weekly)
- `dependency-review.yml` strict mode — vulnerable deps now fail the check
- Standardized `@internal` JSDoc on all 4 test-only exports

## [1.0.0] - 2026-03-16

### Added

- Visual template gallery in layout builder — pick grid shapes from side-by-side mini diagrams instead of specifying column/pane counts numerically
- In-place live preview in layout builder — layout diagram redraws in the same screen region as commands are filled in, using ANSI cursor control
- Arrow-key grid builder — interactive raw-mode builder for custom grid shapes (←→ columns, ↑↓ panes, Tab/Shift+Tab focus, Enter confirm, Esc cancel)
- Command validation with typo detection in layout builder — Levenshtein-distance fuzzy matching suggests closest tool name
- Truncation indicator (`…`) for long commands in layout preview
- Layout name prompt now shows example hint `(e.g., mysetup)`
- `exitWithUsageHint` shared helper for consistent CLI error messaging
- `parsePositiveFloat` validation helper

### Changed

- Custom layout builder no longer forces a mandatory sidebar — total design freedom for workspace layouts
- Grid builder has no column/pane limits — build as many splits as your screen fits
- `detectTools` runs shell lookups in parallel via `Promise.all` for faster wizard startup
- `summon doctor` exits 0 for missing recommendations (reserved exit 1 for actual errors)
- `summon layout show <preset>` gives a helpful message for built-in presets instead of a generic "reserved name" error
- ANSI-aware text centering in layout previews — correctly measures visible width excluding escape codes
- Empty custom shell command in setup wizard now re-prompts instead of accepting
- Standardized "plain shell" terminology throughout setup wizard
- Improved error messages: `summon open` shows valid range, editor failure suggests checking EDITOR env var
- `--auto-resize`/`--no-auto-resize` conflict now uses `console.warn` instead of `console.error`
- Safe error handling: replaced unsafe `(err as Error)` casts with `getErrorMessage()` utility
- Decomposed large functions in launcher.ts and script.ts into focused helpers
- `readKVFile` optimized to single syscall (try/catch instead of existsSync + readFileSync)
- `collectLeaves` result cached in `TreeLayoutPlan` to avoid redundant tree traversals

### Fixed

- `--new-window` with custom/tree layouts on Ghostty 1.3.x — unified new-window creation to use Cmd+N via System Events instead of `make new window` which returns unusable tab-group references

### Tests

- 828 total tests (was 677 in v0.8.0), 97%+ statement coverage, script.ts at 100% branch coverage
- New tests for: centerLabel truncation, visibleLength, async detectTools, parsePositiveFloat, doctor exit codes, layout show error messages, grid builder unlimited columns/panes, tree.ts parser guards, script.ts layout branches, readKVFile error propagation, empty shell rejection

## [0.8.0] - 2026-03-14

### Added

- Custom layout builder with tree DSL for arbitrary Ghostty split configurations (e.g., `editor | shell / logs`)
- Interactive layout builder wizard via `summon layout create <name>` with live grid preview
- Layout CRUD commands: `summon layout create`, `save`, `list`, `show`, `delete`, `edit`
- Shell completions for `layout` subcommand and actions (zsh + bash)
- Custom layout names accepted by `--layout` flag and `summon set layout`
- Nested workspace detection: `SUMMON_WORKSPACE=1` env var set in all panes, warns when launching inside an existing workspace
- No-args invocation now shows full help text instead of terse error

### Fixed

- Ghostty AppleScript `make new window` bug workaround — uses Cmd+N via System Events instead of `make new window` which returns unusable tab-group references
- CLI `--env` key names now validated against `ENV_KEY_RE` — invalid keys (spaces, leading digits) are warned and skipped
- Layout name validation added to `layout show`, `layout delete`, `layout edit` — defense-in-depth against path traversal
- Path traversal guard in `resolveConfig()` — layout names from `.summon` files validated against regex before `isCustomLayout()`

### Changed

- Setup wizard now shows only detected/available tools instead of dimming unavailable ones
- Extracted 9 shared AppleScript generation helpers (`emitAutoResize`, `emitSurfaceConfig`, `emitRootPaneEnvExports`, etc.) reducing ~200 lines of duplication
- Extracted `validateLayoutNameOrExit()` and `layoutNotFoundOrExit()` helpers in CLI entry point
- Removed unreachable dead code in tree DSL parser

### Tests

- 677 total tests (was 523 in v0.7.0), 98.47% statement coverage
- Comprehensive coverage for `runLayoutBuilder`, `findPaneByName`, tree DSL parser, layout completions, env key validation, layout name validation

## [0.7.0] - 2026-03-14

### Added

- Window management flags: `--new-window`, `--fullscreen`, `--maximize`, `--float` for controlling workspace window behavior
- Per-workspace environment variables via `--env KEY=VALUE` (repeatable) and `summon set env.<KEY> <VALUE>`
- Font size override via `--font-size <n>` flag and `font-size` config key
- Pre-launch hook via `--on-start <cmd>` to run a command before workspace creation
- `summon doctor` subcommand to check Ghostty config for recommended settings
- `summon open` subcommand for interactive project selection and launch
- `summon export [path]` subcommand to export resolved config as a `.summon` file
- Environment variables and font size now set via Ghostty's `surface configuration` for automatic propagation to all panes

### Fixed

- Shell-quote env var values in root pane exports to prevent injection (#118)
- `SHELL_META_RE` now catches `${...}` parameter expansion patterns (#119)
- Env var key names validated against `[a-zA-Z_][a-zA-Z0-9_]*` pattern (#120)
- Help text column alignment for config keys and window flags (#121)
- Ambiguous flag hint: suggests `--flag=-value` syntax for values starting with `-` (#122)
- Warning on empty command values in `summon set` (#123)
- `summon doctor` exits with status 1 when issues found (#124)
- Plural mismatch in dry-run output: "1 editor panes" → "1 editor pane" (#125)

### Changed

- Documentation updated: README, user manual, and architecture docs refreshed for all new features, subcommands, and config keys
- Synced with cc-rpi blueprint v1.8.0 (added `/release`, `/update-docs`, `/detach` commands)

## [0.6.2] - 2026-03-14

### Added

- Interactive shell panes now receive a `clear` command after setup, removing the "Last login" message and any `export` commands from view

## [0.6.1] - 2026-03-14

### Fixed

- Starship `STARSHIP_CONFIG` env var injection now works correctly in Ghostty surface configurations. Previously used shell env-prefix syntax (`VAR=val cmd`) which Ghostty's `login`/`exec` mechanism doesn't interpret — now embeds `export STARSHIP_CONFIG=...` inside the login shell's `-lc` argument.

## [0.6.0] - 2026-03-14

### Added

- Per-workspace Starship prompt theming via `starship-preset` config key and `--starship-preset` CLI flag. Each workspace launches with `STARSHIP_CONFIG` pointing to a cached preset TOML, giving projects distinct prompt themes without modifying the global `~/.config/starship.toml`
- Starship preset selector in the setup wizard with true-color palette swatches for the 4 color-rich presets (pastel-powerline, tokyo-night, gruvbox-rainbow, catppuccin-powerline)
- "Random (surprise me!)" option in the Starship preset selector
- Shell tab completion for `--starship-preset` and `summon set starship-preset` with dynamic preset listing
- `COLORTERM` environment variable documentation in README

### Fixed

- Starship preset TOML files now use explicit `0o600` permissions, matching other config files (#97)
- Added "Aborted." message when user declines dangerous command confirmation (#98)

## [0.5.0] - 2026-03-13

### Added

- Pane titles: each pane now displays a human-readable title (`role · command`) via Ghostty 1.3.1's `set_surface_title` action
- Tab title: set to the project directory basename on launch via `set_tab_title`
- Environment Variables section in README and user manual documenting `SHELL` and `NO_COLOR`

### Fixed

- Bash completions now include all short flags (`-h`, `-v`, `-l`, `-e`, `-n`) — previously only `-p` and `-s` were completable (#93)
- Removed unused `printBanner` export from setup module (#94)

### Changed

- Minimum Ghostty version bumped from 1.3.0 to 1.3.1 (required for `set_surface_title` / `set_tab_title`)

## [0.4.1] - 2026-03-13

### Fixed

- `--help` now works on first run — moved help check before the setup wizard gate

### Changed

- Renamed "server" pane to "shell" across entire codebase (code, tests, docs, config keys)
- Consolidated readline boilerplate in `setup.ts` — `numberedSelect`, `confirm`, and `selectToolFromCatalog` now use shared `promptUser()` from `utils.ts`
- Renamed `COMMAND_KEYS` → `DISPLAY_COMMAND_KEYS` in `index.ts` to avoid naming overlap with the security validation Set in `launcher.ts`
- Enabled bundle minification via tsup (52 KB → 33 KB total, 36% reduction)
- Added `"exports"` field to `package.json` for explicit ESM module resolution
- Updated README, user manual, and architecture docs for v0.4.0 features

### Tests

- 381 tests (up from 377) — 4 new tests closing branch coverage gaps
- `script.ts` now at 100% branch coverage (was 97.43%) — covered `hasShell` without `shellCommand` and multi-editor right column without shell
- `setup.ts` coverage improved — covered `printSummary` with `shell="true"` and custom shell commands, non-minimal layout `selectShell()` path

## [0.4.0] - 2026-03-13

### Added

- Interactive setup wizard (`summon setup`) for first-run onboarding — choose layout, editor, sidebar, and shell preferences with numbered selection
- First-run auto-trigger: setup wizard launches automatically when no config file exists (TTY only)
- Tool detection during setup — checks if chosen commands (editor, sidebar, Ghostty) are installed, shows install hints for missing tools
- Shell tab completion for zsh and bash (`summon completions <shell>`)
- Short flags `-p` for `--panes` and `-s` for `--sidebar`
- Brief usage hint on no-argument invocation instead of full help dump
- Security confirmation prompt for `.summon` files containing shell metacharacters
- `SHELL` environment variable validation with safe fallback to `/bin/bash`
- Dry-run output includes layout summary header
- `NO_COLOR` support in setup wizard — respects the `NO_COLOR` environment variable per https://no-color.org/
- Invalid input feedback in setup wizard prompts

### Changed

- Renamed `mtop` layout preset to `btop` to match the actual binary name
- Shell config key description clarified: "Shell pane: true, false, or command"
- Shared `utils.ts` module with `SAFE_COMMAND_RE`, `GHOSTTY_PATHS`, `resolveCommand`, and `promptUser`
- Shared readline prompt helper extracted from launcher and setup
- `parseIntInRange` from `validation.ts` reused in launcher (replaced hand-rolled parseInt)
- `ensureConfig()` creates empty config file instead of hardcoded `editor=claude` — runtime defaults in `layout.ts` still apply
- `isFirstRun()` export in config.ts for checking whether config file exists without creating it
- `executeScript` uses `execFileSync` instead of `execSync` for osascript (defense-in-depth)
- `resolveCommand` in utils.ts validates command names against `SAFE_COMMAND_RE` before shell execution

### Tests

- 377 tests (up from 244 in v0.3.2) — extensive coverage for setup wizard, completions, launcher, utils, and security features
- Setup wizard coverage: non-TTY guard, user-decline loop, display paths, input feedback
- Sidebar-is-falsy branch in script generation covered

## [0.3.2] - 2026-03-13

### Fixed

- Config-launched panes (lazygit, editors, shell) now cd into the project directory before running commands
- Config display no longer treats `"0"` as falsy (#66)
- Removed misleading shell hint for valid single-word commands (#67)
- `summon set` now validates panes, editor-size, layout, and auto-resize values at write time (#68)
- osascript errors now surface their actual message instead of generic fallback (#69)

### Changed

- `command -v` lookup uses `execFileSync` with argument array for defense-in-depth (#71)
- Coverage thresholds raised from 60/55/85/60 to 95/90/95/95 (#72)
- Added `@internal` annotation to `resetConfigCache` for consistency (#74)

## [0.3.1] - 2026-03-13

### Fixed

- Config warnings, validation, homedir handling, editor flag, and resize conflict (#58, #59, #60, #62, #63)
- CLI audit fixes for set truthiness, config display, and layout validation (#43, #44, #45, #46, #51)
- Config hardening: explicit file permissions and getConfig cleanup (#47, #50)
- Empty config values no longer override preset layouts
- Detect Ghostty in `~/Applications` for Homebrew installs
- Exclude subprocess-tested files from v8 coverage (#54)

### Changed

- Cache resolved command paths to avoid duplicate lookups (#61)
- Lazy-load readline in launcher (#48, #52)
- Use `homedir()` for Ghostty path detection
- Updated dev dependencies (#49)

### Added

- Documentation for `.summon` file trust model (#55)

## [0.3.0] - 2026-03-13

### Added

- Auto-resize enabled by default — sidebar auto-resizes to match `editor-size` without needing `--auto-resize` flag
- `--no-auto-resize` flag to opt out of auto-resize (#37)
- Relative path resolution for target argument (#38)
- Per-subcommand `--help` support (#33)
- Context-aware empty-value messages in `summon set` (#40)
- Shared validation constants (`PANES_MIN`, `EDITOR_SIZE_MIN/MAX/DEFAULT`) (#42)

### Fixed

- Shell metacharacter escaping in root pane editor command (#39)
- `--panes` and `--editor-size` validated at parse time (#34)
- `ensureCommand` error message reflects actual config key (#35)
- Dry-run skips Ghostty/command checks for CI compatibility
- Auto-resize repositioned before editor column splits

### Changed

- Config reads cached and command resolution deduplicated (#31, #32)

### Docs

- Publishing guide updated with version placeholders (#41)

## [0.2.0] - 2026-03-13

### Added

- Experimental `--auto-resize` flag to resize sidebar to match editor-size

### Fixed

- Root pane now `cd`s into the project directory before launching editor
- `summon set` rejects unknown config keys with exit 1
- osascript execution failures show user-friendly error message
- Config `writeKV` sanitizes newlines to prevent config file corruption

### Changed

- `ensureConfig` cached to avoid redundant filesystem reads

## [0.1.0] - 2026-03-13

### Added

- CLI entry point with subcommand dispatch (launch, add, remove, list, set, config)
- Config system: machine-level (`~/.config/summon/`) and per-project (`.summon`)
- Layout planner with 5 presets: minimal, full, pair, cli, btop
- AppleScript generator for Ghostty native splits
- Launcher orchestrator with config resolution and command dependency checks
- Auto-install prompts for missing commands (claude, lazygit)
- Ghostty detection (checks `/Applications/Ghostty.app`)
- CLI flags: `--layout`, `--editor`, `--panes`, `--editor-size`, `--sidebar`, `--shell`
- Config resolution order: CLI > project > machine > preset > defaults
- README with layout diagrams, command reference, and config documentation
- Architecture documentation and user manual
- CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md
- GitHub issue templates and PR template
- CI pipeline with Node 18/20/22 matrix on macOS
- CodeQL security scanning
- Dependabot for npm and GitHub Actions

[Unreleased]: https://github.com/juan294/summon/compare/v2.0.1...develop
[2.0.1]: https://github.com/juan294/summon/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/juan294/summon/compare/v1.9.0...v2.0.0
[1.9.0]: https://github.com/juan294/summon/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/juan294/summon/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/juan294/summon/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/juan294/summon/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/juan294/summon/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/juan294/summon/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/juan294/summon/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/juan294/summon/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/juan294/summon/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/juan294/summon/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/juan294/summon/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/juan294/summon/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/juan294/summon/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/juan294/summon/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/juan294/summon/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/juan294/summon/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/juan294/summon/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/juan294/summon/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/juan294/summon/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/juan294/summon/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/juan294/summon/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/juan294/summon/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/juan294/summon/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/juan294/summon/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/juan294/summon/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/juan294/summon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/juan294/summon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/juan294/summon/releases/tag/v0.1.0
