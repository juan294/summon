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
| Pane | One block, labelled like the Ghostty pane title (`role · command`, cut with `…` at the 128 characters Rex accepts; the command itself is never cut); the root pane is the first block, and Summon maps pane names to block ids |
| Layout (preset or custom tree) | The session's initial layout; the first left/right split honors `editor-size` when auto-resize is on, every other split is 50/50 |
| Pane command | Runs in the interactive login shell after it enters the pane directory. If the directory is inaccessible, the shell displays the error and skips the command |
| Workspace variables (`SUMMON_*`, `env.*` keys) | Each block starts as `/usr/bin/env K=V ... <login shell> -l`, so the variables reach the shell without touching `~/.config/rex` |
| Tab title | The window label, `[<project>]` (the session label is the project name and never changes) |
| Background pane (a dev server, a watcher, a log follower) | The pane is created in the layout with the others, then floated and minimized once the session exists (see Background panes) |

`maximize`, `float`, `fullscreen`, `font-size` and `clean` have no Rex equivalent. Each one given as a flag (`--maximize`, `--float`, `--fullscreen`, `--font-size`, `--clean`) prints one notice (`Rex cannot honor <key>; ignored`) and the launch continues. The same keys in config (machine config, `.summon` or a layout) are Ghostty preferences and are ignored silently, so one config serves both terminals; `new-window=true` in config is ignored the same way, and only the `--new-window` flag creates a fresh session (see below). `summon doctor` names the ones set in your machine config. `pane.<name>.background` is read only by Rex (see Background panes). `--new-tab` has no separate meaning under Rex: a workspace is always one session in the current window. The `on-start` and `on-stop` hooks, `.summon` trust and snapshots behave as under Ghostty; the `summon: note: on-stop will run on workspace exit.` line is printed as under Ghostty and does not keep the launcher tab open. Rex pane navigation is not generated: `summon keybindings` keeps producing Ghostty configuration, and Rex's own pane navigation is configured in `~/.config/rex/init.lua`. `summon keybindings rex` prints the palette action described in Open a workspace from the Rex palette.

## Seeing a workspace in the app

On an interactive terminal a launch shows a transient `Summoning <project>…` line on stdout while the session is created and the panes start, ending in `opening the Rex app` when Summon starts the app; the line is cleared before the result (`✓ Workspace [<project>] ready in Rex.` or the error). It is not shown when stdout is not a terminal, with `NO_COLOR`, `FORCE_COLOR=0` or `SUMMON_NO_SPINNER`, the same conditions under which the Ghostty spinner does not animate.

The Rex server holds the session; a Rex app shows it. After creating the session Summon selects it in one connected app: the apps attached to the session Summon was started from (when it runs inside Rex) are preferred, otherwise any connected app; among those the most recently connected one wins. When no app is connected at launch time Summon opens the Rex app and waits a few seconds for it to connect. If no app appears the launch still succeeds: the session exists on the server, and `summon open <project>` shows it once an app is connected (`open` and `focus` do not start the app; they say so and name the project to pick).

`summon open`, `summon focus`, the status monitor's Enter key and the picker all use the same selection, so a workspace can be shown again from any shell.

Under Ghostty, the tab you type `summon <project>` in becomes the workspace. Under Rex the workspace opens in its own session, so that tab would stay behind. When `summon <project>`, `summon open` (with a name or from the picker) or `summon session` succeeds inside Rex (a launch or a switch), Summon closes the tab it was typed in, just after it exits, when that tab holds only that one pane, is not a workspace tab (`[<project>]`), is not a pane of a Summon workspace (`SUMMON_WORKSPACE`), and has Summon as its foreground program. A tab with splits, a workspace tab, a failed launch, a dry run, and a Summon run by an agent or a script in the pane are left alone, and so is any run that printed something to read: a note, a warning, a skipped project, or a workspace that could not be shown. A launch that ran an `on-start` hook or installed a missing tool also keeps the tab, because the hook and the installer write straight to the terminal. When the tab is the last one in its session, Summon ends that session (`rex kill`) instead of closing the tab: an empty session would otherwise stay in the app's sidebar. The app already shows the new workspace. The two checks made at exit (the session's layout and the pane's foreground program) each ask `rex` for an answer within 2 s (about 4 s at most, with the process grace); a check that fails or does not answer keeps the tab. The close runs about 0.3 s after Summon exits and looks at the session again first: it ends the session only while the launcher tab is still its only tab, otherwise it closes just the tab, and it closes nothing when the tab gained a split, is gone, or the check fails. Each of these `rex` calls carries `--timeout`. Routine output (the switch line, and the note that the files of a launch whose session is gone were removed) does not count as something to read. A command chained after Summon on the same line (`summon <project> && make`) runs in a tab that is about to close. With `SUMMON_DEBUG=1` the tab stays, since debug output counts as something to read.

## Background panes

A pane that only runs a background program (a dev server, a watcher, a log follower) opens minimized: Rex shows it as a capsule over the workspace and the program keeps running. Summon still creates the session with one `session.create`, so every program starts once; `session.create` cannot make a floating layer, so right after the create, and before any app shows the session, each background pane is floated out of the layout (`session.float_block`) and its layer minimized (`session.set_layer_state`). Ghostty keeps a normal split and ignores everything on this page, including an invalid `background` value.

**Which panes.** A pane is a background pane when its command is one of these (a command that is not listed stays visible):

| Family | Commands |
|---|---|
| Package scripts | `npm start`, `npm run <script>`, `pnpm`/`yarn <script>` or `<script>` after `run`, `bun run <script>`, where the script is `dev`, `start`, `serve`, `server`, `watch` or `preview`, alone or followed by `:` or `-` and a suffix (`dev:web`) |
| Log followers | `tail` with `-f`, `-F` or `--follow` (a short option group counts, `-fn 20`); `journalctl`, `docker logs`, `docker compose logs`, `docker-compose logs` and `kubectl logs` with `-f` or `--follow` |
| Servers and watchers | `vite` (alone, with options only, or `dev`, `serve`, `preview`), `next dev`, `next start`, `nuxt dev`, `astro dev`, `astro preview`, `nodemon`, `tsx watch`, `tsc -w`, `wrangler dev`, `docker compose up` or `docker-compose up` that stays attached (no `-d`, `--detach`, `--wait` or `--no-start`), `python -m http.server`, `uvicorn`, `flask run`, `rails server` or `rails s` (without `-d`), `hugo server`, `cargo watch`, `stripe listen`, `ngrok http`, `ngrok tcp`, `ngrok tls`, `ngrok start` |

Leading `NAME=value` words and an absolute path to the program do not matter. A command with a pipe, a chain (`&&`, `;`), a redirect or a substitution is never guessed, and neither is one asked for its help or version (`--help`, `--version`, `vite -v`). The table is a convenience, not a guess about what you want to read: a script such as `npm run dev:lint` matches the script rule, and `ngrok http` and `stripe listen` print a URL or a secret you may want to see, so set `pane.<name>.background=false` for those, or run `summon focus <project> <pane>`. Option forms the table does not look through (`vite --port 3000`, `pnpm -F web dev`, `flask --app x run`, `docker compose -f file.yml up`) are not detected and stay visible; `pane.<name>.background=true` covers them.

**The key.** `pane.<name>.background=true` in a layout file or a `.summon` minimizes that pane whatever its command; `=false` keeps it in the layout. The project's `.summon` wins over the layout for the same pane. There is no flag and no machine config key. On a Rex launch, a value other than `true` or `false` prints a warning and is ignored. A dry run ignores the invalid value without that warning and shows the resulting plan. Ghostty ignores the key silently.

**Never minimized.** The first pane (it holds the cleanup trap and keeps the window visible) and a pane without a command. On a Rex launch, `background=true` on one of them prints `pane <name> cannot be minimized (the first pane and a pane without a command stay in the layout); pane.<name>.background ignored` and the launch goes on; a command that is only in the table (no key) is simply left alone.

**What you see.** The launch line names the panes and how to show one: `Workspace [<project>] ready in Rex (minimized: <pane>[, <pane>]; summon focus <project> <pane> shows one).` `--dry-run` adds `-- Minimized after create (float_block, set_layer_state): <panes>` and, when a pane was picked by the table, `-- Keep one in the layout with pane.<name>.background=false`. To show a minimized pane, click its capsule or run `summon focus <project> <pane>`, which returns the layer to normal. Summon minimizes a pane once, when the workspace is created (or, after a lost create answer, when that launch is adopted, see below): a switch to a running workspace, `open` and `focus` never minimize it again.

**Layout.** The editor size goes to the first left/right split that still has a visible pane on both sides, so a minimized pane gives its space to its neighbour and the workspace looks as if the pane were not there. When a pane could not be minimized it stays a normal split in the layout that rule gave it: a split that collapsed in the plan keeps 50/50, not the editor size.

**When it cannot be done.** Minimizing is presentation: a launch never fails because of it. Each pane left as it was is named in one note, with what to do:

| Note | Meaning |
|---|---|
| `this Rex build cannot minimize floating panes (session.set_layer_state is missing); <pane> stays in the layout. Update Rex to use background panes.` | Rex older than preview.25; the panes stay normal splits |
| `could not check whether Rex can minimize floating panes (<reason>); <pane> stays in the layout as a normal split` | The capability check failed (server did not answer) |
| `pane <pane> stays in the layout as a normal split (<reason>)` | Rex refused the float, or the block is not in the session |
| `pane <pane> stays in the layout as a normal split (its block was not confirmed)` | The pane's block could not be named after a lost create answer |
| `pane <pane> floats over the layout but could not be minimized (<reason>); minimize it in Rex` | The float worked, the minimize did not: minimize the window in Rex |
| `pane <pane> may float over the layout (Rex stopped answering); check it in Rex` | A call may have gone through when Rex stopped answering |
| `Rex stopped answering; <pane> stays in the layout as a normal split` | The pass ended at the first unanswered call; later panes were not touched |
| `Rex is answering slowly; <pane> stays in the layout as a normal split` | The pass used its 30 s budget |
| `could not minimize background panes (<message>); check <pane> in Rex` | An unexpected failure inside the pass |

The whole pass is bounded (a 30 s budget plus the last pane, about 80 s at the worst, added to the launch lock's 5 minute limit with room to spare) and the transient `Summoning <project>… minimizing background panes` line says what a slow launch waits for.

**After a lost create answer.** The launch manifest names the panes to minimize before the session is created. When that launch is adopted (by the next `summon <project>`, a status read or `summon clean --orphans`), the panes whose files prove their block and that are still in the tiled layout are minimized once, after the adoption line; a pane that already floats, or is minimized, is left alone. Three limits, all of which leave the pane as a normal split: a pass that is interrupted (the monitor quits, Ctrl-C of `summon status`) is not retried; a pane whose file arrives after the adoption is named in a note and not minimized later; a pane you docked back into the layout is minimized again if an older, still-live launch is adopted afterwards.

## Launching a project that is already running

Running `summon <project>` while the project's recorded session is alive switches to that session instead of creating a second one, and prints `Workspace [<project>] is already running in Rex; switched to it (use --new-window for a fresh one)`. The check reads the status record and asks the server; a session that cannot be verified (server unreachable, or a record whose Rex identity could not be read) refuses the launch with exit 2 and the reason, so a live workspace is never duplicated by accident. Two launches of the same project at the same time are serialized: each holds a per-project launch lock from its final check through `session.create` to recording the session (never while it shows a prompt or runs on-start), so the second waits for the first, checks again, and switches to the workspace the first one created. If both invocations reach `on-start` before either records the workspace, the hook runs twice and Rex creates one session. Make startup hooks safe to repeat, especially when they start a service or change a file. While it waits, an interactive terminal shows `Summoning <project>… waiting for another launch of <project>` on stdout, under the same conditions as the `Summoning <project>…` line (not when stdout is not a terminal, with `NO_COLOR`, `FORCE_COLOR=0` or `SUMMON_NO_SPINNER`). A launcher whose process has ended loses the lock at once. A live launcher keeps it for up to 5 minutes (well above the slowest launch, about 2 minutes when every Rex call reaches its timeout, plus up to about 80 s for the background-pane pass when the workspace has background panes and Rex is slow), so a hung or suspended launcher is taken over after that; a wait that lasts longer than 5.5 minutes stops with exit 1 and `Timed out waiting for another summon launch of <project> to finish. Retry when it is done; summon doctor names a lock that stays.` The session is shown in the app attached to the shell running Summon when there is one, else in the newest connected app, with a note when several apps are connected (the same choice a launch makes).

If a live or unverified workspace belongs to a different checkout with the same name, Summon refuses to switch or replace it. Register the second checkout under a distinct name with `summon add <name> <path>`. Symlinks to the same directory can reuse its workspace.

For the same checkout, `--new-window` skips the switch and creates a fresh session. Rex opens new windows with their own, server-chosen session and does not let a client move a session into another window, so the new session is shown in the current window with a notice. This is the behavior asserted by the Rex end-to-end suite, not a workaround that can be removed later. When the earlier session is still alive, that launch also says once that it stays open (`the earlier [<project>] session <id> stays open; summon <project> now switches to this one, and rex kill <id> closes the earlier one`). The new launch records the earlier one in its manifest (`keeps`), so later launches switch to the new session without repeating it; an extra session no launch announced (a launch whose answer was lost, or one left behind by a Ghostty launch in between) is still noted on every launch, and `summon status` and `summon clean --orphans` name every earlier session.

`--dry-run` never switches, never creates and never changes anything on the server: it prints the `session.create` request a real launch would send (one block per pane, the environment wrapper, the pane order the block ids arrive in), the server it would target, the panes it would minimize afterwards (see Background panes), and a note when a Rex workspace is already recorded. Backend detection runs before the dry-run guard, so the one read-only probe of the detection table (`rex whoami` on an inherited `REX_SERVER`, see above) can still run; no other Rex command does.

## Open a workspace from the Rex palette

Summon ships one Rex action, "Summon: Open workspace…". It lists the projects you registered with `summon add`, lets you filter them, and opens the chosen one in a new tab of the session you ran it from, which the app brings forward. That tab runs `summon open <name>`, so it does what `summon open <name>` does in a terminal: a live workspace is focused, a stopped one is launched, and a `.summon` that is new or changed asks for trust in that tab. Cancelling the picker opens nothing.

It needs macOS, a Rex server with API revision 17 or later, and a connected Rex app that can show pickers (check with `rex version` and `rex whoami --json`). When several Rex apps are connected, each one shows the picker and the first answer counts. The new tab opens in the session you ran the action from, and Summon then shows the workspace in an app as a normal launch does (see Seeing a workspace in the app).

**Install.** The action is one Lua file, `integrations/rex/summon-workspace.lua` in this repository. The installed CLI prints the same bytes:

```bash
mkdir -p ~/.config/rex
summon keybindings rex > ~/.config/rex/summon-workspace.lua.new
diff ~/.config/rex/summon-workspace.lua ~/.config/rex/summon-workspace.lua.new  # when updating an earlier copy
mv ~/.config/rex/summon-workspace.lua.new ~/.config/rex/summon-workspace.lua
```

Then load it from `~/.config/rex/init.lua` (create the file if you have none) and reload the configuration:

```lua
-- ~/.config/rex/init.lua
local summon = require("summon-workspace")
-- Optional key binding:
-- rex.bind("shift+cmd+o", "summon_open_workspace")
```

```bash
rex config reload
rex actions | grep summon_open_workspace
```

After a Summon upgrade, print the file again and compare it before you replace it. Settings stay in `init.lua`, so a new copy keeps them. To remove the action, delete the `require` line (and the binding), run `rex config reload`, and delete the file.

**Settings.** The action runs with the Rex server's environment, and a server started at login has a bare `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`). Summon's entry point needs `node` through `/usr/bin/env`, so the action lists projects through your login shell: `<shell> -lc 'exec "$0" "$@"' <executable> list --json`. Set these in `init.lua` after the `require` only when the defaults do not work (a value of the wrong type is reported when the action runs):

| Setting | Default | Set it when |
|---|---|---|
| `summon.settings.executable` | `summon` | Summon is not on your login `PATH`. An absolute path is allowed, spaces too. It is used for the listing and for the new tab. |
| `summon.settings.shell` | the server's `SHELL`, else `/bin/zsh` | Your login shell is not POSIX-style: a fish user sets `/bin/zsh`. |
| `summon.settings.path_prepend` | empty | Node or Summon is set up only in interactive startup files such as `~/.zshrc`. List the directories that hold them, for example `{ "/opt/homebrew/bin" }`. They go at the front of `PATH` for the listing and the new tab (a login shell's startup files can still reorder `PATH`). |

An absolute `executable` alone does not help when `node` is not on the login `PATH`: the error says so, and `path_prepend` is the fix.

**The launcher tab.** The tab is labelled `Summon · <name>` and starts in your home directory. A clean launch or switch to a Rex workspace closes it about 0.3 s after Summon exits, as for any launcher tab (see Seeing a workspace in the app): only that tab closes, unless it has become the session's only tab (you closed the others meanwhile), in which case the session ends with it. It stays open, with its output, when Summon exits with an error, printed a note, warning or error, switched to a workspace recorded under Ghostty, when you split the tab, or when Rex took longer than 2 s to answer the exit check. The full list, including a launch that ran an `on-start` hook or installed a missing tool, is in Seeing a workspace in the app. Close it when you have read it, and run the action again (or `summon open <name>` in a terminal) after fixing the cause.

**When it does not work.** The action opens a `Summon · error` tab in the session you ran it from, brings it forward, and prints the problem and its fix there; close the tab when you have read it. (The app shows an action error only as a one-line "Action failed" notice cut to about 60 characters, so the tab carries the full text. An error shown in a tab ends the action normally, so `rex do summon_open_workspace` then exits 0: read the tab, not the exit status. When no tab can be opened, for example outside a session, or when Rex did not confirm the new workspace tab, the action raises the error instead: the app shows the notice and `rex do` prints it and exits 1. After an unconfirmed tab, look for a `Summon · <name>` tab before you retry.) It explains: running it outside an open Rex session, a Rex app or server that cannot show pickers, another open Rex question, a picker that timed out, a shell, Summon or `node` that cannot be found, a Summon too old for `list --json`, a registry with no projects or with names Summon cannot open, and more than 2,000 projects. A registered name Summon cannot open (a hand-edited `~/.config/summon/projects`) is left out of the list, and the picker's filter field says how many were skipped. In every case `summon open` in a terminal still works.

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

## Live ports

Under Rex, `summon ports`, `summon doctor` and `summon inspect` read the TCP ports that a running workspace's panes actually listen on, through the terminal `ports` method. `summon ports` and `summon doctor` ask every terminal block of the session, including panes you split by hand; `summon inspect` asks the recorded panes. The method needs a Rex server with API revision 16 or later (`rex version` prints the revision). The ports are never saved: every command reads again. `summon ports` and `summon doctor` read the workspace status first, and that read reconciles a workspace that ended outside Summon, as `summon status` does (see below).

- `summon ports` keeps the claims it found before (PORT-style variables in a trusted `.summon`, `--port` flags of dev-server scripts in `package.json`, framework config files) and adds what holds each port now. A claim whose port its own workspace holds shows `listening: <pane> (<process>)`. A claim whose port another workspace holds shows `held by <project>/<pane> (<process>)` and counts as a conflict, because that project's server cannot start. A live port that its own project does not claim gets a row with source `live`, marked as a conflict when another project claims it.
- Ports from 49152 up (the macOS ephemeral range, where agents such as Claude Code and other helpers listen) are hidden from the table unless a project claims them; one line says how many were hidden. `summon ports --json` lists every port with an `ephemeral` flag, and `summon inspect <project>` lists every port of each recorded pane under that pane (a port in a pane you split by hand is in `--json` only, and the hidden line then points there).
- `summon doctor` keeps its check of claims that two projects share, and adds a failure for each port that a running workspace holds while another project claims it.
- When the live part could not be read, `summon ports` still prints the claims and says why, one line per reason: `note: this Rex server has no live ports (needs API 16 or later)`, or `note: live ports incomplete for <projects> (<reason>)` when a server did not answer, a pane did not answer or does not support live ports, Rex could not look at every process or a reply held more ports than fit (a port may then be missing); a table without a conflict then ends with `No port conflicts in the claims and live ports that were read`, without the check mark. In `summon doctor` these are `INFO` lines, never failures. `summon ports` and `summon doctor` stop the live read after 4 seconds; the next run reads again. `summon inspect` waits at most 2 seconds for a pane, stops asking after one does not answer, and prints the reason as `live ports: <reason>`; the exit code of `inspect` does not change.
- Ghostty has no way to tell which pane holds a port, so a Ghostty workspace shows only its claims, as before.

## When a workspace ends outside Summon

The root pane's shell installs the same cleanup trap as under Ghostty. `rex kill <session>`, closing the root block and `exit` in the root shell all fire it; a program that exits normally does not, and neither does a CLI client disconnecting. The trap first removes this launch's liveness files (`.pid`, `.active`), then runs the `on-stop` hook and `summon snapshot save`, so a trap cut short by the terminal (Rex was observed to kill the pane's processes about 2 s after the hangup) rarely leaves a stale pid behind. In Bash and zsh the trap can run twice, on the hangup and again when the shell exits: the second run completes a cleanup that the hangup cut short, so an `on-stop` hook should be safe to repeat. A shell that is killed outright runs nothing more. The `on-stop` hook and the snapshot save run detached from the pane's terminal: after `rex kill` the pty is already hung up, and Node aborts at startup when a standard descriptor is such a pty. The snapshot is therefore written by the trap itself; the reconciliation below saves it again (the file is overwritten) and marks the record. A workspace that ended outside Summon is reconciled on the next status read (`summon status` and its dashboard, `summon open`, `focus`, `inspect`, `title`, `briefing`, `ports`, `doctor`): Summon saves a snapshot, marks the record as ended, then removes this launch's files, in that order under the status lock. `summon status --once` (and `summon status` with piped output) prints one notice for what its own read ended, and reports a step that failed; the other commands print neither. A failed step is retried on the next read; a relaunch that happens first wins and nothing is touched. Reconciliation never runs on a launch path and never under `--dry-run`.

## `summon clean <project>`

`summon clean <project>` closes the project's recorded Rex session only when Summon's own check (`session.view`) shows it empty: no blocks at all. It refuses with exit 2 when the session cannot be verified (server unreachable) or still has panes, naming the recorded panes and counting unrecorded blocks. The check runs twice, the second time immediately before the close, to keep the window small.

Rex has no conditional destroy. Anything added to the session between the second check and `rex kill` is closed with it; the command says so in its output. After the close, Summon saves a snapshot, marks the record as ended and removes this launch's files, in that order, under the status lock; a step that fails is reported and retried on the next status read.

`summon clean --orphans <project>` reviews every earlier launch of the project: launches whose session the server confirms gone have their files removed (a file that cannot be removed is reported, and the manifest and the root pane's file are kept, so the next review finds the launch again, verifies its session again and finishes; the one file a failure can strand is a root pane file whose manifest already went, after the session was confirmed gone, which nothing reads); empty sessions are closed and their files removed; sessions that still have blocks are left alone with the exact `rex kill` command printed; launches that never confirmed their session, or left an unreadable pane file, are printed with the exact `rm` command and never deleted automatically (they may still be evidence). Both forms also remove the liveness files of earlier Ghostty launches whose recorded pid is proven dead (a launch still writing its files, or one whose pid cannot be read, is kept).

## Per-launch files

Every launch gets an id. Its files live under `~/.config/summon/status/<project>.launches/`:

| File | Written by | Purpose | Removed by |
|---|---|---|---|
| `<launchId>.json` | Summon, before the session is created | The launch manifest: server, layout, pane names and order, labels, and the panes to minimize. It lets a later read adopt a session whose creation answer was lost, and finish minimizing its background panes | Summon, once the server confirms the session is gone (reconciliation, `clean`, `clean --orphans`), or at once when `session.create` definitely created nothing (the server rejected the request, or the connection was refused before it was sent); a dropped or reset connection keeps it |
| `<launchId>.pane.<pane>` | Each pane's shell, first thing | The session and block IDs for this pane. On Rex server/CLI preview.23 and later, Summon looks up the session using `REX_BLOCK`. Older terminals supply `REX_SESSION` directly | Same as the manifest |
| `<launchId>.pid`, `<launchId>.active` | The root pane's shell | Liveness markers shared with the Ghostty backend | The cleanup trap of that launch; otherwise reconciliation |

The shared record `~/.config/summon/status/<project>.json` is written only by Summon under a file lock and names the launch it belongs to, so a relaunch, a reconciliation and a `clean` never overwrite each other's state.

A pane is **unverified** until Summon can read its pane file and identify the owning session. If only a block ID was saved, Summon can look up the session while the block is still open. The launch still succeeds with a notice; the next status read fills the mapping in when the file has arrived, before it asks the server, so a pane whose file arrived late counts as live from that read on. While a pane is unverified and the session still has blocks that no recorded pane names, a closed root reads as `stopped` (`no live panes; 1 pane unverified`) but the launch is not ended yet: one of those blocks may be the unverified pane, and a later read with its file recovers it. Until then `summon focus <project> <pane>` refuses that pane with exit 2 and `summon inspect` lists it as unverified. A pane that never recovers stays unverified while the session lives: `summon <project>` switches to the live session rather than recreating it, so use `--new-window` for a fresh one. A launch whose creation answer was lost entirely (`unknown outcome`) is adopted on the next status read from its manifest and pane files.

## `summon doctor`

Doctor gains a `Checking Rex...` section: where the `rex` CLI was found (or every location searched), `rex version`, whether the server answers at the socket this shell would use (a failure counts only when Rex is this shell's backend; otherwise it is informational), the connected Rex apps, the backend this shell launches in with its placement and server, and the Ghostty-only settings in your machine config that Rex ignores (only when some are set). With Rex installed and Ghostty absent, the Ghostty checks are reported as not applicable instead of failing.

## End-to-end tests

The Rex suites (`src/e2e/rex-native.test.ts`, `src/e2e/rex-lifecycle.test.ts`, `src/e2e/rex-cli.test.ts`) create and destroy their own sessions on the default server and need a connected Rex app. They are skipped unless `SUMMON_REX_E2E=1` is set (advisory: missing prerequisites skip with a reason) or `SUMMON_REX_E2E_REQUIRED=1` (required: missing prerequisites fail). `rex-native` and `rex-cli` also need the app to have a window open (`focus`, `open` and a launch's selection act in a window); the harness counts the app's windows through System Events and reports a missing one as a prerequisite. Run the files one at a time; they share the server. Each suite kills the sessions it created and polls the server until they are gone; a cleanup it cannot verify fails the suite (`rex-cli` keeps its sandbox with a `RECOVERY.json` naming the sessions). The lifecycle suite asserts the observed Rex behavior (which actions fire the cleanup trap), so a Rex build that changes it fails the suite instead of silently changing Summon's state table. The CLI suite runs the built `dist/index.js` as a child process under a sandbox home with the environment a Rex terminal exports (the sandbox reaches the pane shells through the `env.HOME` config key, since the typed bootstrap resolves `$HOME` inside the pane), and pins the dispatch, exit codes and messages of the Rex commands it covers (launch, switch, dry run, status, inspect, focus, title, clean, orphan review, named sessions, doctor, detection, `open <project>`), the cleanup trap's own snapshot after `rex kill`, the recovery of a launch whose `session.create` answer was lost (within the launch and on the next read, with no duplicate session), the literal delivery of environment values, a quoted project path and per-pane working directories to the panes, a background pane that opens minimized, keeps running and shows again on `summon focus`, and a pane's dev server read as a live port that another project's claim turns into a held conflict; `docs/release/rex-e2e-guide.md` lists its scenarios and the manual steps that follow them.

`src/rex-hermetic.test.ts` runs in every `pnpm test` without Rex: it starts the built CLI with `TERM_PROGRAM=rex`, a sandbox home and a scripted fake `rex` (found through `PATH` and `REX_BIN_DIR`) that keeps its server state in a file and answers in the shapes the real CLI uses (checked through Summon's own parsers). It covers a launch, a switch to a running workspace, a lost `session.create` answer adopted on the next launch (also with a background pane, which the adoption minimizes), a launch that minimizes a background pane and one on a Rex without `session.set_layer_state`, the launcher-tab close (the session ended for a single-tab session, only the tab closed otherwise) and a launch whose note keeps the tab. It does not replace the suites above: the fake follows the contract they observe.
