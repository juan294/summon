# Rex end-to-end guide (v2.0.0 candidate)

Candidate: local `develop` at `70d72bd` (Rex backend, six phases plus four validation rounds). This guide is the test contract for the Rex release: an automated part that Claude runs and records here, then a manual part that the owner runs only after every automated item is green. It complements `docs/rex.md` (the user-facing Rex contract) and `docs/release/release-checklist.md` (the release procedure, which stays authoritative from the release PR onward).

Sequencing rule: no manual step starts while an automated item is red or pending. A manual finding goes through the ordinary implement, review and verify loop, after which the automated part is rerun in full before manual testing resumes.

## 0. Environment truth (verified 2026-10-30 on the owner's machine)

| Item | State | How verified |
| --- | --- | --- |
| Rex app | `Rex Beta.app` in `/Applications`, app client "Mac Studio" connected, one owner session alive (`brave-brook`) | `rex api call client.list`, `session.list` |
| Rex CLI | `/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex`, version `0.0.1793131181-gdd9a20`, api revision 7 | `summon doctor` on the candidate build |
| Rex server | reachable at `unix:///Users/juan/Library/Application%20Support/rex/server.sock` | `rex --autostart=false whoami --json` |
| Ghostty | installed; the owner's shell is Ghostty (`TERM_PROGRAM=ghostty`) | `ls /Applications` |
| Accessibility | granted to the shell running the suites (System Events reads the Rex window count) | `osascript` count windows |
| Rex window | the app must have at least one window open: `focus`, `open` and a launch's selection act in a window, and the harness checks only for a connected app client (§4 F8) | `osascript` names of Rex Beta windows |
| Global `summon` | **1.9.0** at `~/.nvm/versions/node/v24.22.1/bin/summon`. It is the released build, not the candidate | `summon --version` |
| Rex terminal environment | a Rex block exports `TERM_PROGRAM=rex`, `REX_SERVER`, `REX_SESSION`, `REX_BLOCK` and prepends `REX_BIN_DIR` to `PATH` (research §5.4) | observed 2026-10-29 |

The lifecycle suite pins the Rex build above. A Rex update changes the pinned observations and fails `rex-lifecycle` on purpose; treat that as a Rex behavior change to re-observe, not as a Summon bug.

## 1. Harness and safety contract

- **Always run the candidate, never the global 1.9.0.** Inside the repo use `./dist/index.js <args>` after `pnpm build` (or `npm link`, M0). For a throwaway state run it with another home: `HOME=$TMPDIR/summon-rc-home ./dist/index.js <args>`; the untracked helper `scripts/summon-rc.sh` (present only in the primary checkout, excluded through `.git/info/exclude`) wraps exactly that. A sandboxed home keeps the owner's real `~/.config/summon` (projects, trust, status, cache) untouched, with the Rex limits of the next two bullets.
- **Run Rex tests from a Rex terminal.** With Ghostty installed, Summon picks Ghostty in every terminal except a Rex one (detection table in `docs/rex.md`). Open a block in Rex Beta and run the candidate there. The Rex terminal exports `REX_SERVER`, which Summon honors inside Rex, so even a sandboxed `HOME` still reaches the real server. Scripts and the automated suite set `TERM_PROGRAM=rex` and `REX_SERVER` explicitly for the same reason.
- **Disposable projects only.** Every test project is a directory under `$TMPDIR` named `rc-<topic>` (manual), `summon-e2e-<id>` (the native and lifecycle suites) or `e2e-<id>-<name>` (the CLI suite; the status table shows 16 characters of a name). The suites and the owner destroy only sessions labelled with those names. Never kill, select or close the owner's own sessions (today: `brave-brook`).
- **The pane shells resolve `$HOME` themselves.** The bootstrap and the cleanup trap are typed shell text with `$HOME/.config/summon/...` paths, and a Rex block inherits the server's environment, not Summon's. A Summon run under a sandbox `HOME` therefore never sees its pane files unless the sandbox is handed to the blocks (the CLI suite sets the `env.HOME` config key; see §4 F3). Manual Rex testing runs against the real `~/.config/summon` after a backup (M0).
- **Never quit or restart the Rex app or server as part of an automated step.** The manual part has two steps that do (M6.5, M6.6); the owner runs them last and reopens the app afterwards.
- **One Rex suite at a time.** `rex-native`, `rex-lifecycle` and `rex-cli` share the server; run them as separate commands, never in one `vitest run`. An interrupted `rex-cli` run leaves its `e2e-<id>-*` sessions and its `summon-rex-cli-*` temp directory behind (the cleanup runs only at the end): kill and remove them by hand.
- **Evidence.** Each automated run writes its log under `logs/rex-e2e-2026-10-30/` in the primary checkout (gitignored, kept on this machine) and its result line to §2.3 of this guide (exit codes, counts, coverage, the Rex build). Manual results go in §3 with the date and the observed output when it differs from the expectation.

## 2. Automated part (run by Claude)

### 2.1 Items

| Id | Check | Command | Pass condition |
| --- | --- | --- | --- |
| A1 | Static gate | `pnpm typecheck && pnpm lint && pnpm build` | all exit 0; `src/shell-escape.lint.test.ts` still present |
| A2 | Unit and integration suite | `pnpm test` | 0 failures (3193 passed, 7 skipped at `70d72bd`) |
| A3 | Coverage gate | `pnpm test:coverage` | thresholds 95/90/95/95 hold |
| A4 | Release probes | `pnpm test:release` | 0 failures (candidate identity, no-skip and charter validator probes) |
| A5 | Rex native E2E, required mode | `SUMMON_REX_E2E_REQUIRED=1 pnpm exec vitest run src/e2e/rex-native.test.ts` | 2 passed: create, pane files within 8 s, startup variables in every pane, on-start once, switch on relaunch, read-only dry run, `--new-window` fallback with an unchanged window count |
| A6 | Rex lifecycle E2E, required mode | `SUMMON_REX_E2E_REQUIRED=1 pnpm exec vitest run src/e2e/rex-lifecycle.test.ts` | 2 passed: `rex kill` → trap fired, `stopped`; root block close → trap fired, `partial`; editor exit → trap armed, `active`; `exit` in root → trap fired, `partial`; CLI disconnect → `active` |
| A7 | Rex CLI E2E (new, `src/e2e/rex-cli.test.ts`) | `SUMMON_REX_E2E_REQUIRED=1 pnpm exec vitest run src/e2e/rex-cli.test.ts` | every scenario in §2.2 passes |
| A8 | Detection matrix through the built CLI (part of A7) | `--dry-run` under each environment row | the `-- Backend:` line matches the table in `docs/rex.md` for every row |
| A9 | Ghostty E2E regression | `mkdir -p logs && SUMMON_E2E=1 SUMMON_NATIVE_E2E=1 SUMMON_NATIVE_E2E_REQUIRED=1 pnpm exec vitest run src/e2e/ghostty-native.test.ts src/e2e/ghostty-recipes.test.ts src/e2e/applescript-syntax.test.ts`. `SUMMON_E2E` gates only the AppleScript syntax case; `ghostty-recipes` is ungated; the GUI case and the ownership readback need `SUMMON_NATIVE_E2E` (required mode fails instead of skipping) and open and close one Ghostty window | 0 failures, nothing skipped (the per-launch artifact change touched both backends) |

A1 to A4 run first and sequentially; a red item stops the run. A5 to A7 run one file at a time. A9 needs Ghostty idle (no Summon workspace of the test projects open).

### 2.2 Scenarios of the new CLI suite (A7)

The existing suites call `launch()` in process. The CLI suite drives `dist/index.js` as a child process, so the dispatch, flag parsing, exit codes and printed messages are what the owner will see. It runs under a sandbox `HOME` with `TERM_PROGRAM=rex`, `REX_SERVER` set to the real socket and `REX_BIN_DIR` set to the bundle helper directory, and registers its projects with `summon add`. Each scenario names the contract line it pins.

| # | Scenario | Expected (contract) |
| --- | --- | --- |
| C1 | `summon <p>` (layout `pair`, `sleep` commands) from the sandbox | exit 0; record `backend: rex`; session labelled `<p>`; window label `[<p>]`; four pane files within 8 s |
| C2 | `summon status --once` | the row shows `active`; a registered project that was never launched shows `stopped` with its directory (§4 F5, fixed) |
| C3 | `summon inspect <p>` and `--json` | block ids per pane, tty `UNAVAILABLE`, exit 0; JSON carries `backend`, `panes[].blockId` |
| C4 | `summon focus <p> sidebar` | exit 0; `summon focus <p> nope` exit 2 with `Unknown pane. Valid panes: editor, sidebar, right-1, shell. Run summon inspect <p>.` |
| C5 | `summon title <p> --set Spell`, read back, `--reset` | block label changes to `Spell` in `session.view`, then returns to the recorded label |
| C6 | `summon <p>` again | stderr `Workspace [<p>] is already running in Rex; switched to it`; no new session; same `launchId` |
| C7 | `summon <p> --dry-run` | stdout has `-- Backend: rex`, the `session.create` request and the recorded-workspace note; the session revision is unchanged |
| C8 | `summon <p> --maximize --float --fullscreen --font-size 14` on a fresh launch, and again on a switch | creation: one `Rex cannot honor <flag>; ignored` line per flag, exit 0; switch: no notice at all (§4 F7) |
| C9 | `summon clean <p>` while panes live | exit 2: `[<p>] still has live panes (editor, right-1, shell, sidebar); not cleaned. Close them or run rex kill <session> yourself.` (builder order); session untouched |
| C10 | `rex kill <session>` then `summon status --once` | row `stopped` with reason `Rex session no longer exists`; under the row `note: workspace ended outside Summon; snapshot saved <time>` (stdout); the snapshot file exists; record has `endedAt`; launch files gone; a second read prints no note |
| C11 | `summon clean <p>` after C10 | `Rex session for [<p>] is already gone; nothing to close`, exit 0 |
| C12a | Interrupt and `exit` every shell of a fresh launch (two writes: the interrupt flushes pending input) | observed on this Rex build: the session shown in the app is usually destroyed within seconds (the next read reconciles it like C10), and sometimes stays as an empty session (status `empty Rex session remains`, `clean` closes it). The scenario accepts the end that happened and checks that the read reports it (§4 F6) |
| C12b | A real empty session (one no app shows: `rex new <label> -- /bin/sh -c 'exit 0'`), the record pointed at it | status reason `empty Rex session remains; run summon clean <p>`; clean prints `Closed empty Rex session [<p>] (…)` with the P17 limitation sentence, exit 0; session gone; `endedAt` set |
| C13 | `summon <p> --new-window` with the first session alive, then `summon clean --orphans <p>`; then `rex kill` the first session and review again | a second session; the review names the earlier session as still having blocks and prints the exact `rex -S '<server>' kill <session>` line, nothing deleted; after the kill, adoption (which runs before the review) removes the files with `removed the files of earlier launch <id> (its Rex session is gone)` and the review has nothing left |
| C14 | Unconfirmed launch: a manifest of another launch id with no token and no pane files beside the live record, then `summon clean --orphans <p>` | printed with the exact `rm -f '<path>'` line on its own last line; file kept |
| C15 | Unreachable server: a record whose `rex.server` points to a dead socket | `status --once` row `unknown` with the reason; `focus` exit 2; `summon <p>` exit 2 (refuses to launch over it); `summon <p> --new-window` replaces it |
| C16 | `summon session add s <p1> <p2>` then `summon session s` | two sessions, one per project, the first shown again at the end; `--dry-run` prints two requests and selects nothing |
| C17 | `summon doctor` from the sandbox Rex environment | Rex section shows CLI, version, server, app client; `this shell launches in rex` |
| C18 | Detection matrix (A8) by `--dry-run` only | `TERM_PROGRAM=rex` → `rex`; `TERM_PROGRAM=ghostty` → `ghostty`; `TERM_PROGRAM=iTerm.app` with `REX_SERVER` set → `ghostty`; no `TERM_PROGRAM` with a valid `REX_SERVER` → `rex`; no `TERM_PROGRAM` with a dead `REX_SERVER` → `ghostty` |
| C19 | `summon open <project>` and `summon switch <project>` | a live workspace: `Switched to [<p>]` without the picker; a record whose server does not answer: exit 2 with `[<p>] could not be verified`, nothing launched; a mistyped name: exit 1 with `"<name>" is not a registered project` and `Did you mean: …` (§4 F1, fixed) |
| C20 | Cleanup | every `e2e-<id>-*` session killed (a failed listing prints the prefix to kill by hand), sandbox removed, the owner's sessions untouched |

### 2.3 Results

Filled by Claude after each run. A row is green only when the command above exited 0 and the pass condition was read from the output.

| Id | Date | Result | Evidence |
| --- | --- | --- | --- |
| A1 | 2026-10-30 | green: typecheck, lint, build exit 0 | `e2e-guide-gate-baseline.log`, tree `70d72bd` plus this guide |
| A2 | 2026-10-30 | green: 82 files, 3193 passed, 7 skipped | same log |
| A3 | 2026-10-30 | green: 96.81 / 91.86 / 98.84 / 98.37 | same log |
| A4 | 2026-10-30 | green: 5 files, 82 passed | same log |
| A5 | 2026-10-30 | green: 2 passed, required mode | `e2e-guide-rex-suites.log` |
| A6 | 2026-10-30 | green: 2 passed, required mode, Rex `0.0.1793131181-gdd9a20` | same log |
| A7 | 2026-10-30 | green: 9 passed, 1 todo (C19), required mode; two consecutive green runs of the reviewed suite (runs 13 and 14), after three green runs of the first version (8, 10, 11); §4 F3 to F7 came out of the earlier runs. A rerun after the last review nit (a rewritten C3 assertion) passed C1 to C3 and stopped at C4 because the Rex app had no window (F8); the code after that nit is otherwise identical to runs 13 and 14 | `e2e-guide-cli-run13.log`, `e2e-guide-cli-run14.log` |
| A8 | 2026-10-30 | green (C18 inside A7): all five rows of the detection table | same log |
| A9 | 2026-10-30 | green: the three files with only `SUMMON_E2E=1` gave 23 passed, 2 skipped (the GUI case and the ownership readback were skipped, so that run alone proves little); `ghostty-native` in required native mode then gave 9 passed, 0 skipped. Its first required run failed on a missing gitignored `logs/` directory in the fresh worktree, not on behavior; the suite writes its evidence JSON there | `e2e-guide-ghostty-e2e.log`, `e2e-guide-ghostty-native-required2.log` |

Final gate on the tree with the reviewed suite (2026-10-30, `e2e-guide-gate-final.log`): typecheck, lint, build exit 0; 82 files, 3193 passed, 16 skipped (the 9 gated Rex CLI cases and the 7 pre-existing skips), 1 todo; coverage 96.81 / 91.86 / 98.84 / 98.37; release probes 82 passed; `src/shell-escape.lint.test.ts` present. The handoff is in `docs/plans/2026-10-29-rex-backend-notes.md`.

Rerun on the findings tree `8a006f5` (F1, F4, F5 fixed; 2026-10-30, one Rex window open): A5 `rex-native` 2 passed, A6 `rex-lifecycle` 2 passed, A7 `rex-cli` 10 passed (C19 is a real case now, no todo), all in required mode, nothing left on the server or under `~/.config/summon/status` (`findings-rex-native-run2.log`, `findings-rex-lifecycle-run2.log`, `findings-rex-cli-run2.log`). Unit gate on the same tree: `findings-gate-final.log` (3206 passed, 17 skipped; coverage 96.82 / 91.87 / 98.85 / 98.38).

## 3. Manual part (run by the owner, after §2 is green)

Tags: **Rex** = run from a block inside Rex Beta; **Ghostty** = run from a Ghostty tab; **Other** = run from Terminal.app or iTerm; **Visual** = needs eyes on the app; **TTY** = needs an interactive terminal. Every `summon` below is the linked candidate (M0), never the released 1.9.0. Replace `[ ]` with `[x]` or a short note.

### M0. Setup

- [ ] Back up the real state: `cp -R ~/.config/summon ~/.config/summon.bak-$(date +%F)`. Manual Rex tests run against the real `~/.config/summon` (§1, F3); the backup restores it afterwards.
- [ ] `pnpm build` on `develop` at the candidate commit, then make the candidate the `summon` on PATH: `npm link` in the repo (undo later with `npm install -g summon-ws@1.9.0`). The cleanup trap now runs the binary that created the launch (§4 F4, fixed); the link is for the `summon` you type inside the panes.
- [ ] `summon --version` prints the candidate version (the `package.json` version until the 2.0.0 bump lands) and `which summon` points at the repo.
- [ ] Create three disposable projects: `rc-pair` (a git repo with a commit and a `package.json` dev script), `rc-grid`, `rc-tree`. Register them with `summon add`.
- [ ] Config: keep your real `editor`, `sidebar` and `shell` commands, or set `sleep 600` where a pane only needs to stay alive. Your real config is what the release will run.

### M1. Detection and doctor

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 1.1 | Rex | `summon doctor` | `Checking Rex...` section: CLI path, version, server reachable, the connected app client, `this shell launches in rex (placement inside …)`; Ghostty checks still run because Ghostty is installed | [ ] |
| 1.2 | Ghostty | `summon doctor` | same Rex section, `this shell launches in ghostty`; server unreachability would be `INFO`, not a failure, here | [ ] |
| 1.3 | Rex | `summon rc-pair --dry-run` | `-- Backend: rex`, `-- Launch: <id>`, the `session.create` JSON with four blocks each starting `/usr/bin/env … <your shell> -l`; nothing appears in the Rex picker | [ ] |
| 1.4 | Ghostty | `summon rc-pair --dry-run` | `-- Backend: ghostty` and the AppleScript; inherited `REX_*` ignored | [ ] |
| 1.5 | Other | `summon rc-pair --dry-run` from Terminal.app | `-- Backend: ghostty` (Ghostty installed wins) | [ ] |
| 1.6 | Other | `env -u TERM_PROGRAM REX_SERVER=unix:///Users/juan/Library/Application%20Support/rex/server.sock summon rc-pair --dry-run` | `-- Backend: rex` (no terminal context, validated `REX_SERVER`) | [ ] |
| 1.7 | Other | same as 1.6 with `REX_SERVER=unix:///tmp/none.sock` | `-- Backend: ghostty` (probe did not answer) | [ ] |

### M2. First launch, layouts and the shell environment

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 2.1 | Rex, Visual | `summon rc-pair` | one session `rc-pair` appears in the picker and is selected in this window; editor left, sidebar top right, shell bottom right; block labels `editor · sleep 600`, `sidebar · lazygit`, `shell`; window label `[rc-pair]` | [ ] |
| 2.2 | Rex, Visual | `summon rc-grid --layout grid` and `summon rc-tree` with a custom tree layout (`summon layout …`) | the split tree matches the preview `summon layout show` prints; the first left/right split honors `editor-size` when auto-resize is on | [ ] |
| 2.3 | Rex | in any pane: `echo $SUMMON_WORKSPACE $SUMMON_TAB_TITLE $SUMMON_LAUNCH_ID` | `1 rc-pair <launchId>`; `env.*` keys from the config are present; `~/.config/rex` unchanged | [ ] |
| 2.4 | Rex | `summon set on-start 'touch /tmp/rc-start'`; relaunch a fresh project | the file exists once; relaunching while the session lives does **not** touch it again (switch, not launch) | [ ] |
| 2.5 | Rex | `.summon` file with a dangerous command in `rc-tree`; `summon rc-tree` | trust prompt as under Ghostty; `summon trust` path works | [ ] |
| 2.6 | Rex | starship configured (`summon setup` or `summon set starship-preset …`) | the prompt in each pane uses the preset (`STARSHIP_CONFIG` reached the shell) | [ ] |
| 2.7 | Rex | `summon rc-grid --maximize --float --fullscreen --font-size 14` on a project with no live session | one `Rex cannot honor …; ignored` line per flag; the launch continues. On a switch nothing is printed (§4 F7): say whether that is acceptable | [ ] |
| 2.8 | Rex, Visual | `summon rc-pair --new-window` while `rc-pair` lives | a second `rc-pair` session, shown in the **current** window with the notice that `--new-window` opens a new session, not a new window | [ ] |

### M3. Showing a workspace: switch, open, focus, apps

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 3.1 | Rex, Visual | from another Rex block or window: `summon rc-pair` | `Workspace [rc-pair] is already running in Rex; switched to it (use --new-window for a fresh one)`; the app jumps to the session; on-start not rerun | [ ] |
| 3.2 | Ghostty, Visual | `summon focus rc-pair` and `summon focus rc-pair sidebar` from Ghostty | the Rex app shows the session (record backend decides); the sidebar block gains focus | [ ] |
| 3.3 | TTY, Visual | `summon open`, pick `rc-pair`; then `summon open rc-grid` and `summon switch rc-pair` | picker: `Switched to [rc-pair]`, picking a stopped project launches it; direct form: `rc-grid` launches when stopped, `rc-pair` is focused without a picker; `summon open rc-pai` exits 1 with `Did you mean: rc-pair?` | [ ] |
| 3.4 | TTY, Visual | `summon status`, Enter on an active Rex row | focus; Enter on a stopped row launches; `q` quits | [ ] |
| 3.5 | Rex, Visual | quit Rex Beta (server stays if it is a separate process; otherwise see M6.6), then `summon rc-grid` | Summon opens the app, waits up to 8 s, selects the session; if the app is slow: `Created in Rex but no Rex app is connected; open Rex and pick [rc-grid], or run summon open rc-grid`, exit 0, session exists | [ ] |
| 3.6 | Rex | two Rex apps connected (open a second Rex Beta window on another display or a second client if available; skip when only one app exists) | `Several Rex apps are connected; using <newest>, not <others>` | [ ] |

### M4. Status, inspect, title, program status

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 4.1 | Rex | `summon status --once` | Rex rows show `active`; non-active rows show the reason instead of the directory | [ ] |
| 4.2 | Rex | `summon inspect rc-pair` then `--json` | block ids, tty `UNAVAILABLE`, exit 0; root program status line absent when no program announced one | [ ] |
| 4.3 | Rex, Visual | in the root pane: `printf '\033]7501;state=blocked:title=Needs you:msg=approve\033\\'` then `summon status --once` and `summon inspect rc-pair` | a glyph before the project name and the `blocked` status with title and message in inspect; then `state=done` clears it | [ ] |
| 4.4 | Rex, Visual | `summon title rc-pair --set "Spell book"`, `summon title rc-pair`, `--reset`; then `summon title rc-pair sidebar --set Grimoire` | window label changes and returns to `[rc-pair]`; the sidebar block label changes and `--reset` restores `sidebar · lazygit` | [ ] |
| 4.5 | Rex | `summon title rc-pair --set $'bad\x07title'` | rejected as a usage error (controls), exit 1, nothing changed | [ ] |
| 4.6 | Rex, Visual | close the sidebar block in the app, then `summon inspect rc-pair`, `summon focus rc-pair sidebar`, `summon status --once` | inspect lists sidebar as closed; focus exits 2 `pane sidebar is closed in Rex`; status stays `active` (root alive) | [ ] |
| 4.7 | Rex | `summon briefing` and `summon ports` | Rex workspaces counted as active/partial; `unknown` listed as unverified; ports detected for the git project | [ ] |

### M5. Lifecycle outside Summon (observed table, D6)

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 5.1 | Rex, Visual | close the **root** block (editor) in the app; `summon status --once` | `partial` with reason `root pane closed`; `summon open`/Enter selects the first live pane | [ ] |
| 5.2 | Rex | type `exit` in the root shell after its command returns | same as 5.1 | [ ] |
| 5.3 | Rex | editor command exits by itself (`sleep 5` as editor) | the shell stays, state stays `active`, trap armed | [ ] |
| 5.4 | Rex | `rex kill <session>` (take the id from `summon inspect`) then `summon status --once` | one reconciliation notice; row `stopped` `Rex session no longer exists`; `summon snapshot show rc-pair` has the snapshot; `~/.config/summon/status/rc-pair.launches/` has no files of that launch | [ ] |
| 5.5 | Rex | `summon set on-stop 'touch /tmp/rc-stop'`; launch; `rex kill` | `/tmp/rc-stop` appears (the trap ran on-stop) | [ ] |
| 5.6 | Rex, Visual | quit Rex Beta completely (server gone) then `summon status --once`, `summon focus rc-pair`, `summon rc-pair` | row `unknown` with the reason; focus exit 2; launch refuses with exit 2 and the reason (`could not be verified on <server>`), nothing created; `summon rc-pair --new-window` would create a fresh one; reopen Rex: the next `summon status` resolves normally | [ ] |
| 5.7 | Rex | sleep the Mac for a minute with a workspace alive, wake, `summon status --once` | still `active`; panes respond | [ ] |

### M6. Clean and orphans

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 6.1 | Rex | `summon clean rc-pair` with panes alive | exit 2 naming the recorded panes and counting unrecorded blocks; session untouched | [ ] |
| 6.2 | Rex, Visual | type `exit` in every pane of `rc-pair` (interrupt the command first), then `summon status --once` | one of the two ends observed by C12a (§4 F6): the session is destroyed (row `stopped`, `Rex session no longer exists`, reconciliation note) or it stays empty (row `stopped`, `empty Rex session remains; run summon clean rc-pair`; then `summon clean rc-pair` closes it with the P17 sentence and the picker no longer lists it). Note which one you got | [ ] |
| 6.3 | Rex | after 2.8 (two sessions), `summon clean --orphans rc-pair` | the earlier session is reported as still having blocks with the exact `rex -S '<server>' kill <session>` line; run that line, review again: files removed, nothing else printed | [ ] |
| 6.4 | Rex | kill the current session, create an empty earlier one through `--new-window` then close its blocks, `summon clean --orphans rc-pair` | `closed its empty Rex session …` | [ ] |
| 6.5 | Ghostty | launch `rc-grid` in Ghostty, close its window, `summon clean --orphans rc-grid` | the dead Ghostty launch's liveness files are swept; a live one is kept | [ ] |

### M7. Multi-project sessions

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 7.1 | Rex, Visual | `summon session add trio rc-pair rc-grid rc-tree`; `summon session trio` | three sessions, one per project, `[1/3] Launched …` lines, the first one shown again at the end | [ ] |
| 7.2 | Rex | `summon session trio --dry-run` | three requests printed, nothing created or selected | [ ] |
| 7.3 | Rex | `summon session trio` again while all three live | three switch lines, no new sessions | [ ] |
| 7.4 | Rex | `summon session --all` with one untrusted project | the untrusted one is skipped with the `summon trust` hint, the rest launch | [ ] |

### M8. Setup wizard, keybindings, completions

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 8.1 | Rex, TTY | `summon setup` | `Rex detected (Ghostty not required)`; the Ghostty install and Accessibility steps are skipped; the wizard completes | [ ] |
| 8.2 | Rex | `summon keybindings` and `summon keybindings --help` | the command still prints Ghostty configuration; the help text (not the output) notes that Rex bindings live in `~/.config/rex/init.lua` | [ ] |
| 8.3 | Any | `summon completions zsh \| grep clean` | `clean` and `--orphans` are completed | [ ] |
| 8.4 | Any | `summon --help`, `summon clean --help` | both terminals named; the clean contract text | [ ] |

### M9. Ghostty regression and mixed use

The per-launch files and the locked record are shared by both backends, so Ghostty must behave as in 1.9.0.

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 9.1 | Ghostty, Visual | `summon rc-pair` from Ghostty (no Rex session alive) | the Ghostty workspace as in 1.9.0; `status` active; `focus`, `inspect`, `title` work; closing the window ends it and saves the snapshot | [ ] |
| 9.2 | Ghostty | `summon rc-pair` from Ghostty while a Rex `rc-pair` session lives | Ghostty launch wins the record; stderr `Rex session [rc-pair] <id> is still running; rex kill <id> closes it` | [ ] |
| 9.3 | Ghostty | `summon status --once` with both kinds of workspaces | each row resolves through its own backend | [ ] |
| 9.4 | Ghostty | `summon clean --orphans rc-pair` after 9.2 | the Rex orphan is reported with its kill line; Ghostty files untouched | [ ] |

### M10. Upgrade from 1.9.0 state

Run against a **copy** of the real state, never the live directory: `cp -R ~/.config/summon "$SUMMON_RC_HOME/.config/summon"` while no 1.9.0 workspace is being launched.

| # | Tag | Steps | Expected | Done |
| --- | --- | --- | --- | --- |
| 10.1 | Any | `summon status --once` against the copied state | legacy records (no `launchId`) show their 1.9.0 liveness; nothing is rewritten or deleted | [ ] |
| 10.2 | Ghostty | relaunch one legacy project | the new record has `launchId` and `backend`; the legacy sidecars are ignored from then on | [ ] |
| 10.3 | Any | `summon clean --orphans <legacy project>` | legacy records are left alone with the notice from an older Summon | [ ] |

### M11. Impressions (free form)

- [ ] Launch time inside Rex compared with Ghostty (note seconds).
- [ ] Every notice is understandable without reading `docs/rex.md`; list any that is not.
- [ ] Anything surprising in the picker, labels, focus order or window handling.

## 4. Pre-identified discrepancies (found while writing this guide, 2026-10-30)

| Id | Finding | Evidence | Proposed disposition |
| --- | --- | --- | --- |
| F1 | `summon open <project>` was documented and printed in notices (`docs/rex.md`, `CHANGELOG.md`, the "no Rex app" and "could not show" messages, plan §6) but the command was an interactive picker that ignored the argument: `./dist/index.js open summon-e2e-nope </dev/null` printed the picker and exited 0 | run on `70d72bd`, 2026-10-30 | **Fixed (owner decision 2026-10-30):** `open <project>` and `switch <project>` focus a live workspace, launch a stopped one with the flags given, refuse `unknown` with exit 2 and name a mistyped project with suggestions (exit 1); one status read, no picker. Pinned by C19 and `src/commands/project.test.ts` |
| F2 | The isolated `summon-rc` harness derives the default Rex socket from the sandbox `HOME`, so it reaches the server only where `REX_SERVER` is inherited (a Rex terminal) or exported | `defaultRexServer()` in `src/backends/rex/cli.ts` | Documented in §1; no code change. A harness note in `scripts/summon-rc.sh` is optional |
| F3 | A sandboxed Summon (`summon-rc`, or any run with another `HOME`) never sees its Rex pane files: the typed bootstrap writes to `$HOME/.config/summon/status` as the pane shell resolves it, and the block inherits the server's `HOME`. The first CLI-suite run left pane files in the real `~/.config/summon/status/summon-e2e-*` (removed by hand) | `bootstrapLine` in `src/launch-identity.ts` (`SHELL_STATUS_DIR = "$HOME/.config/summon/status"`), run 1 of A7 | Harness constraint, same design as Ghostty. The CLI suite passes the sandbox through `env.HOME`; manual testing uses the real home (M0). No product change proposed: in real use Summon and the shells share `HOME` |
| F4 | The cleanup trap called `summon snapshot save ... --launch <id>` by name inside the pane shell, so the binary that ran it was whatever `summon` was on the pane's PATH. With the released 1.9.0 installed globally that call failed silently (`2>/dev/null`; 1.9.0 rejects `--dir`), so the on-exit snapshot of a candidate launch was lost under Ghostty; under Rex the next read's reconciliation saved it anyway | `cleanupTrapLine` in `src/launch-identity.ts`; `which summon` = 1.9.0 | **Fixed (owner decision 2026-10-30):** the CLI entry registers its own node binary and the resolved path of its script (`src/self.ts`; the bin symlink of a global install is resolved at launch time), and the trap types both, double-quoted, in place of `summon`; without a registration (library use, tests) it still falls back to `summon` on PATH. The `npm link` in M0 stays so that `summon` typed by hand in a pane is also the candidate |
| F5 | `summon status --once`, the picker, the monitor, the briefing and `ports` showed a registered project that was never launched as `unknown`, the label the Rex state table reserves for a workspace whose server did not answer; since `unknown` is never launched over (P10), the picker and the monitor's Enter key refused to launch such a project with "could not be verified" | `loadProjectRows` in `src/monitor.ts` (since `0c6afb1`, before Rex); C2 | **Fixed (owner decision 2026-10-30):** a project with no record is `stopped` everywhere (one `neverLaunchedRow`, the briefing and `ports` defaults), so it launches from the picker, the monitor and `open <project>`; `unknown` keeps its Rex meaning. `docs/rex.md` says so |
| F6 | On Rex `0.0.1793131181-gdd9a20`, a session shown in the app is destroyed when its last block is closed with `rex block close`, and usually (not always: one run in four kept it) when its last shell exits; an empty session persists reliably when no app shows it (a `rex new` whose program exited, `windows: []`). Summon handles both ends, but which one a user gets is up to Rex | C12a (runs 8 to 11), C12b, the `e2e-empty-probe` experiment (killed) | Documented in C12 and M6.2; `docs/rex.md` could say when an empty session can arise. No product change |
| F8 | With the Rex app connected but windowless (its last window closed), `summon focus` fails with `Rex Beta has no window to act in. Run "rex -C Mac Studio actions" to see what it offers.` and the suite stops at C4; the harness prerequisite (a connected app client) does not catch it | a full rerun on 2026-10-30 after the review nits, while runs 13 and 14 had passed with a window open | Prerequisite added to §0; a harness check for an open window is a candidate follow-up. The owner reopens a window (Cmd-N in Rex Beta) before the suites run |
| F7 | The `Rex cannot honor <flag>; ignored` notices are printed only when a session is created; `summon <p> --maximize` on a live workspace switches silently | `src/launcher.ts` ordering (reuse decision before the flag notices, plan P2/P15); C8 | **Kept (2026-10-30):** nothing is created on a switch, and a user with `maximize` in the global config would otherwise read the notice on every switch. M2.7 still asks whether it feels wrong in practice |

## 5. Exit criteria

1. Every row in §2.3 green on the same candidate commit, logs kept.
2. Every row in §3 marked done, or marked skipped with a reason the owner accepts (3.6 and 5.7 may be skipped when the hardware is not available).
3. Every finding from §3 and §4 either fixed (with its regression test, independent review and a full rerun of §2) or explicitly deferred by the owner in `docs/plans/2026-10-29-rex-backend-notes.md`.
4. Only then: the optional exploratory charters (`/explore-release`), the version bump and `docs/release/release-checklist.md`.
