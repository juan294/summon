# Summon under Rex

Summon launches the same workspaces in two terminals: Ghostty (AppleScript, see `docs/ghostty.md`) and Rex (beta, the Superlogical multiplexer). Nothing is configured: Summon detects the terminal that runs it, and every command that reads a workspace works on both. This page records what is specific to Rex.

## How detection works

Detection runs once per launch, right after config resolution, and never asks a question or reads a config key. The terminal running Summon decides first:

| Where `summon` runs | Backend |
|---|---|
| Inside a Rex terminal (`TERM_PROGRAM=rex`) and the `rex` CLI is found | Rex, on the server the terminal inherited (`REX_SERVER`, else the default socket) |
| Inside a Rex terminal but the `rex` CLI is missing | Ghostty when installed (with a notice naming the searched locations), otherwise the launch fails |
| Inside Ghostty (`TERM_PROGRAM=ghostty`) | Ghostty; inherited `REX_*` variables are ignored |
| Inside another terminal (iTerm, Apple Terminal, VS Code, ...) | Ghostty when installed, otherwise Rex when its CLI is found; `REX_SERVER` is ignored |
| No `TERM_PROGRAM` (scripts, launchd, editors) | An inherited `REX_SERVER` counts only when `rex whoami` answers on it; otherwise Ghostty when installed, otherwise Rex when its CLI is found |

When neither Ghostty.app nor the `rex` CLI is found a real launch fails with one message, and `--dry-run` prints the Ghostty script with a notice. The `rex` CLI is searched on `PATH`, then in `REX_BIN_DIR`, then inside the Rex app bundles (`Rex.app` and `Rex Beta.app` under `/Applications` and `~/Applications`). Every `--dry-run` prints the chosen backend on its `-- Backend:` line, and `summon doctor` prints the backend this shell would launch in.

## What maps to what

| Summon | Rex |
|---|---|
| Workspace | One session labelled with the project name (`summon <project>` ↔ one `session.create`) |
| Pane | One block, labelled like the Ghostty pane title (`role · command`); the root pane is the first block, and Summon maps pane names to block ids |
| Layout (preset or custom tree) | The session's initial layout; the first left/right split honors `editor-size` when auto-resize is on, every other split is 50/50 |
| Pane command | Sent as the block's initial input to an interactive login shell, exactly as the Ghostty backend types it |
| Workspace variables (`SUMMON_*`, `env.*` keys) | Each block starts as `/usr/bin/env K=V ... <login shell> -l`, so the variables reach the shell without touching `~/.config/rex` |
| Tab title | The window label, `[<project>]` (the session label is the project name and never changes) |

`maximize`, `float`, `fullscreen`, `font-size` and `clean` have no Rex equivalent. Each one that is set prints one notice (`Rex cannot honor <key>; ignored`) and the launch continues. `--new-tab` has no separate meaning under Rex: a workspace is always one session in the current window. The `on-start` and `on-stop` hooks, `.summon` trust and snapshots behave as under Ghostty. Rex key bindings are not generated: `summon keybindings` keeps producing Ghostty configuration, and Rex's own pane navigation is configured in `~/.config/rex/init.lua`.

## Seeing a workspace in the app

The Rex server holds the session; a Rex app shows it. After creating the session Summon selects it in one connected app: the apps attached to the session Summon was started from (when it runs inside Rex) are preferred, otherwise any connected app; among those the most recently connected one wins. When no app is connected at launch time Summon opens the Rex app and waits a few seconds for it to connect. If no app appears the launch still succeeds: the session exists on the server, and `summon open <project>` shows it once an app is connected (`open` and `focus` do not start the app; they say so and name the project to pick).

`summon open`, `summon focus`, the status monitor's Enter key and the picker all use the same selection, so a workspace can be shown again from any shell.

## Launching a project that is already running

Running `summon <project>` while the project's recorded session is alive switches to that session instead of creating a second one, and prints `Workspace [<project>] is already running in Rex; switched to it (use --new-window for a fresh one)`. The check reads the status record and asks the server; a session that cannot be verified (server unreachable, or a record whose Rex identity could not be read) refuses the launch with exit 2 and the reason, so a live workspace is never duplicated by accident. The session is shown in the app attached to the shell running Summon when there is one, else in the newest connected app, with a note when several apps are connected (the same choice a launch makes).

`--new-window` skips the switch and creates a fresh session. Rex opens new windows with their own, server-chosen session and does not let a client move a session into another window, so the new session is shown in the current window with a notice. This is the behavior asserted by the Rex end-to-end suite, not a workaround that can be removed later.

`--dry-run` never switches, never creates and never changes anything on the server: it prints the `session.create` request a real launch would send (one block per pane, the environment wrapper, the pane order the block ids arrive in), the server it would target, and a note when a Rex workspace is already recorded. Backend detection runs before the dry-run guard, so the one read-only probe of the detection table (`rex whoami` on an inherited `REX_SERVER`, see above) can still run; no other Rex command does.

## Status, open, focus, inspect, title

A Rex workspace resolves to one of four states, each with a reason when it is not `active`:

| State | Meaning |
|---|---|
| `active` | The session exists and the root pane's block is present (other recorded panes may be closed; `summon inspect` lists them) |
| `partial` | The session exists but the root pane's block is gone while other recorded panes are alive (`exit` in the root shell, or the root block closed) |
| `stopped` | The session no longer exists, or it exists with no live recorded pane (reason `empty Rex session remains; run summon clean <project>` or `no live panes`) |
| `unknown` | The server did not answer, or answered with a shape Summon cannot read, or the record's identity could not be read; nothing is assumed, nothing is launched over it, `open` and `focus` refuse with exit 2 and the reason |

A registered project that was never launched has no record and is `stopped`, not `unknown`: `summon open <project>`, the picker and the monitor's Enter key launch it.

`summon inspect` lists block ids instead of terminal ids; the tty is not available under Rex and prints `UNAVAILABLE` without changing the exit code. For the root pane it also prints the program status a program announced through OSC 7501 (`blocked`, `error`, `working`, `done`, with the title and message when given); `summon status` shows the same as a glyph before the project name. Programs that do not emit OSC 7501 show nothing. `summon title` sets the block label (pane) or the window label (tab); `reset` restores the block label recorded at launch or `[<project>]` for the window.

## When a workspace ends outside Summon

The root pane's shell installs the same cleanup trap as under Ghostty. `rex kill <session>`, closing the root block and `exit` in the root shell all fire it; a program that exits normally does not, and neither does a CLI client disconnecting. The trap's `summon snapshot save` and the `on-stop` hook run detached from the pane's terminal: after `rex kill` the pty is already hung up, and a program that inherits it (Node among them) aborts before doing anything. The snapshot is therefore written by the trap itself; the next read only reconciles the record. A workspace that ended outside Summon is reconciled on the next status read (`summon status`, `summon open`, `summon briefing`, the monitor): Summon saves a snapshot, marks the record as ended, then removes this launch's files, in that order under the status lock, and prints one notice. A step that fails is reported and retried on the next read; a relaunch that happens first wins and nothing is touched. Reconciliation never runs on a launch path and never under `--dry-run`.

## `summon clean <project>`

`summon clean <project>` closes the project's recorded Rex session only when Summon's own check (`session.view`) shows it empty: no blocks at all. It refuses with exit 2 when the session cannot be verified (server unreachable) or still has panes, naming the recorded panes and counting unrecorded blocks. The check runs twice, the second time immediately before the close, to keep the window small.

Rex has no conditional destroy. Anything added to the session between the second check and `rex kill` is closed with it; the command says so in its output. After the close, Summon saves a snapshot, marks the record as ended and removes this launch's files, in that order, under the status lock; a step that fails is reported and retried on the next status read.

`summon clean --orphans <project>` reviews every earlier launch of the project: launches whose session the server confirms gone have their files removed (a file that cannot be removed is reported, and the manifest and the root pane's file are kept, so the next review finds the launch again, verifies its session again and finishes; the one file a failure can strand is a root pane file whose manifest already went, after the session was confirmed gone, which nothing reads); empty sessions are closed and their files removed; sessions that still have blocks are left alone with the exact `rex kill` command printed; launches that never confirmed their session, or left an unreadable pane file, are printed with the exact `rm` command and never deleted automatically (they may still be evidence). Both forms also remove the liveness files of earlier Ghostty launches whose recorded pid is proven dead (a launch still writing its files, or one whose pid cannot be read, is kept).

## Per-launch files

Every launch gets an id. Its files live under `~/.config/summon/status/<project>.launches/`:

| File | Written by | Purpose | Removed by |
|---|---|---|---|
| `<launchId>.json` | Summon, before the session is created | The launch manifest: server, layout, pane names and order, labels. It lets a later read adopt a session whose creation answer was lost | Summon, once the server confirms the session is gone (reconciliation, `clean`, `clean --orphans`) |
| `<launchId>.pane.<pane>` | Each pane's shell, first thing | The block's own `REX_SESSION` and `REX_BLOCK`, so Summon can map pane names to block ids without trusting the creation answer | Same as the manifest |
| `<launchId>.pid`, `<launchId>.active` | The root pane's shell | Liveness markers shared with the Ghostty backend | The cleanup trap of that launch; otherwise reconciliation |

The shared record `~/.config/summon/status/<project>.json` is written only by Summon under a file lock and names the launch it belongs to, so a relaunch, a reconciliation and a `clean` never overwrite each other's state.

A pane is **unverified** when its pane file had not appeared when Summon last looked (a slow shell start, a pane whose shell never ran). The launch still succeeds with a notice; the next status read fills the mapping in when the file has arrived, before it asks the server, so a pane whose file arrived late counts as live from that read on. While a pane is unverified and the session still has blocks that no recorded pane names, a closed root reads as `stopped` (`no live panes; 1 pane unverified`) but the launch is not ended yet: one of those blocks may be the unverified pane, and a later read with its file recovers it. Until then `summon focus <project> <pane>` refuses that pane with exit 2 and `summon inspect` lists it as unverified. A pane that never recovers stays unverified while the session lives: `summon <project>` switches to the live session rather than recreating it, so use `--new-window` for a fresh one. A launch whose creation answer was lost entirely (`unknown outcome`) is adopted on the next status read from its manifest and pane files.

## `summon doctor`

Doctor gains a `Checking Rex...` section: where the `rex` CLI was found (or every location searched), `rex version`, whether the server answers at the socket this shell would use (a failure counts only when Rex is this shell's backend; otherwise it is informational), the connected Rex apps, and the backend this shell launches in with its placement and server. With Rex installed and Ghostty absent, the Ghostty checks are reported as not applicable instead of failing.

## End-to-end tests

The Rex suites (`src/e2e/rex-native.test.ts`, `src/e2e/rex-lifecycle.test.ts`, `src/e2e/rex-cli.test.ts`) create and destroy their own sessions on the default server and need a connected Rex app. They are skipped unless `SUMMON_REX_E2E=1` is set (advisory: missing prerequisites skip with a reason) or `SUMMON_REX_E2E_REQUIRED=1` (required: missing prerequisites fail). `rex-native` and `rex-cli` also need the app to have a window open (`focus`, `open` and a launch's selection act in a window); the harness counts the app's windows through System Events and reports a missing one as a prerequisite. Run the files one at a time; they share the server. Each suite kills the sessions it created and polls the server until they are gone; a cleanup it cannot verify fails the suite (`rex-cli` keeps its sandbox with a `RECOVERY.json` naming the sessions). The lifecycle suite asserts the observed Rex behavior (which actions fire the cleanup trap), so a Rex build that changes it fails the suite instead of silently changing Summon's state table. The CLI suite runs the built `dist/index.js` as a child process under a sandbox home with the environment a Rex terminal exports (the sandbox reaches the pane shells through the `env.HOME` config key, since the typed bootstrap resolves `$HOME` inside the pane), and pins the dispatch, exit codes and messages of the Rex commands it covers (launch, switch, dry run, status, inspect, focus, title, clean, orphan review, named sessions, doctor, detection, `open <project>`), the cleanup trap's own snapshot after `rex kill`, the recovery of a launch whose `session.create` answer was lost (within the launch and on the next read, with no duplicate session), and the literal delivery of environment values, a quoted project path and per-pane working directories to the panes; `docs/release/rex-e2e-guide.md` lists its scenarios and the manual steps that follow them.
