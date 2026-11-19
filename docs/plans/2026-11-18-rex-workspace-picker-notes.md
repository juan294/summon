# Notes: Rex workspace picker

Plan: `docs/plans/2026-11-18-rex-workspace-picker.md` (gitignored in the primary checkout).

## Handoff

- Objective: a Rex palette action that lists registered projects and opens the chosen one through `summon open <name>` in a focused launcher tab.
- Approved scope: the owner said "resume work" on 2026-11-19 after updating Rex (read as authorization for Phase 1), then "go ahead with all phases, no stopping, when you're done merge to develop and prune the tree". Local merge to `develop` and worktree removal are authorized. No push, no release.
- Base: `develop` at `0bd8224`. Worktree: `/Users/juan/code/summon-list-json`, branch `feat/list-json` (Phase 1), then `feat/rex-workspace-picker` on top of it (Phases 2 and 3).
- Runtime on 2026-11-19: Rex CLI and server `0.1.0-preview.21`, API revision 18. App `0.1.0 (2042)` connected. `rex.ui.pick` is a function in the CLI script runtime (Lua 5.1, no `jit`). Native prompt rendering is not yet observed.

## Phase 1: `summon list --json`

- TDD: `src/commands/project-list.cli.test.ts` ran against the unsplit bundle under a synthetic HOME. Before the change, the 2 human-output baselines passed and the 6 JSON cases failed (stdout was the human list).
- Change: `handleListCommand` takes the command context (default `{ values: {} }` for zero-argument callers) and, with `--json`, writes `JSON.stringify([{name, directory}...])` plus a newline through `process.stdout.write`. Help (`summon list [--json]`, overview line) and the shared `--json` completion description (`Print JSON (inspect, list)`) document it.
- Independent review: no correctness findings. Three low-severity test gaps were repaired: completion description now asserted, a launched registration (with a status record) is compared with a never-launched one, and a positive control proves the sentinel `rex` is found first on PATH and records a call. The reviewer also confirmed by hand that `doctor` trips the sentinel and `list --json` does not.
- Not covered, by design (reported as read; the action validates): CRLF registries, duplicate keys (Map keeps first position, last value), empty key.
- Deviation: none from the phase file.
- Gate on the committed tree, sequential: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build` 0, `pnpm test` 0 (100 files, 3845 passed, 20 skipped). `pnpm test:coverage`: statements 97.21, branches 92.91, functions 98.24, lines 98.57 (thresholds 95/90/95/95). The pre-commit hook re-ran typecheck, lint, build and test, all passing.

## Phase 2: the palette action and `summon keybindings rex`

- Files: `integrations/rex/summon-workspace.lua` (the action), `integrations/rex/test/summon-workspace.test.lua` (plain Lua 5.1 harness with a fake `rex`), `scripts/test-lua.mjs` (`pnpm test:lua`: finds a `_VERSION == "Lua 5.1"` interpreter, makes candidate JSON from `dist/index.js` under a throwaway HOME, runs the harness), `src/backends/rex/action-snippet.ts` (`printRexAction`), `__REX_ACTION_LUA__` defined in `tsup.config.ts` and `src/fixtures/build-cli.ts`, dispatch in `src/commands/setup.ts`, help, completions, `docs/rex.md`, `README.md`, `CLAUDE.md` structure.
- Provider facts measured on preview.21 / API 18 (`rex do` in the CLI runtime): `rex.action` rejects a table `keywords` (`field "keywords" must be a string, got table`); `rex.json.decode` returns `nil, "rex.json.decode: text is not valid JSON"` on invalid text without raising; a `null` inside an array is dropped (`#t == 2` for three elements with one null); the decoded empty array has no metatable. `rex api describe session.new_window` and the terminal flavor schema confirm `window_label`, `focus`, `layout`, `options.command`, `options.exit.on_completion`, `options.path_prepend`. The provider docs say a prompt cannot run inside `pcall`, so the action calls `rex.ui.pick` directly from `run`.
- Harness checks: 54 cases. Mutation checks: a changed listing timeout and `exit.on_completion` fail 3 cases; a `jit` reference fails the LuaJIT scan; a table `keywords` fails loading, as the real runtime does.
- Real-runtime smoke (`rex do --action summon_open_workspace` with `executable` set to a missing path): the action loads, runs `/bin/zsh -lc` and raises `` `summon list --json` failed with exit 127 (zsh:1: no such file or directory: /nonexistent dir/summon) `` with the three settings named. The first smoke found the `keywords` type error, which the fake did not model; the fake now checks the field types.
- Independent review: no high findings. Repaired: settings type checks (a wrong type is reported), a replaced `summon.settings` table takes effect, a missing `os` table is tolerated, the old-CLI message no longer copies registry text, install docs create `~/.config/rex` and `init.lua`, launcher-tab wording now matches `src/backends/rex/launcher-tab.ts` (session ends when the tab is its last one, 2 s exit check), help test for the rex form, retry-after-each-picker-reason and retry-after-malformed-list cases.

### Deviations

1. Settings live in the module's returned table.
   - Plan said: three settings sit at the top of the file.
   - Chose: the defaults sit at the top of the file, and users change them in `init.lua` after `local summon = require("summon-workspace")` (`summon.settings.executable = ...`). The action reads them when it runs.
   - Why: re-exporting the file after an upgrade would otherwise overwrite the user's settings. Risk to check in Phase 3: `require` caches the module in `package.loaded`; a `rex config reload` must still re-register the action and pick up a replaced file.
2. `keywords` is a space-separated string, because the real `rex.action` requires a string.
3. The action has `category = "Summon"` and items carry `icon = "folder"`, which the provider lists among item icons; Phase 3 confirms the app accepts it.

- Gate on the Phase 2 tree, sequential: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build` 0, `pnpm test` 0 (102 files, 3869 passed, 20 skipped), `pnpm test:lua` 0 (54 passed, LuaJIT reporting Lua 5.1), `pnpm test:coverage` 97.21 / 92.92 / 98.25 / 98.57.
- Docs: `docs/rex.md` and `README.md` describe the action. Per the plan's release-gate decision, they stay only if Phase 3 native acceptance passes.

## Phase 3: package and native verification (2026-11-19)

Environment: Rex server `0.1.0-preview.21`, API 18, pid 54075 with parent pid 1 (launchd), server `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `SHELL=/bin/zsh`. One app client, Rex `0.1.0 (2042)`. Load average 7 to 20 during the runs. Candidate: this branch, packed with `npm pack` and installed into a temporary prefix. Summon ran from a wrapper at a path with a space, under a sandbox HOME (`env.HOME` set), with projects `p3-plain` (machine config), `p3-trust` (`.summon`), `p3-slow` (`.summon` with `on-start=sleep 35`) and `p3-gone`. The invoking session was a disposable `p3-origin` whose pane ran `cat` into a sentinel file.

### Package

- The installed `summon keybindings rex`, run outside the checkout, is byte-equal to `integrations/rex/summon-workspace.lua` (checked again on the final candidate). `list --json` under a synthetic HOME is correct. `keybindings` and `keybindings --vim` are byte-equal to the `develop` baseline. The package contains no Lua file: the action is embedded in the bundle.
- `pnpm test:lua` on the emitted copy: 60 passed.

### Native results (live launchd server, packaged action loaded from a temporary `~/.config/rex`)

| Check | Result |
| --- | --- |
| Load, list | `rex config check`: 1 action (1 binding when bound); `rex actions` lists `summon_open_workspace` titled "Summon: Open workspace…" |
| Palette entry | Rendered under a "Summon" category |
| Defaults on the launchd server | The listing ran as `/bin/zsh -lc` and found the installed Summon 2.1.1 and Node on the login PATH; 2.1.1 has no `list --json`, so the action reported the old-CLI message. With the candidate wrapper, the listing child's PATH began `~/.nvm/versions/node/v24.22.3/bin:…:/opt/homebrew/bin:…` (the login PATH, not the server's bare PATH) |
| Picker | Title "Open Summon workspace", placeholder "Filter projects", folder icons, items in registry order; typing filtered the list |
| Cancel | Escape: `rex do` exit 0, no window created, sentinel unchanged |
| Stopped project, no `.summon` | `Summon · p3-plain` tab, session `p3-plain` created with the configured panes, app shows it; launcher tab closed within about 3 s; only that tab closed; one status record, one launch |
| Reopen active project | Same launch id and session id before and after; no second session; launcher tab closed |
| Trust: decline | Prompt shown in the launcher tab (brought forward); `n` exits 130; no session, no record, no trust entry; tab kept with transcript |
| Trust: approve | `y`: file trusted, `p3-trust` launched with its panes, launcher tab closed |
| Trust: changed file | After the session ended and the file changed: "changed since you trusted it"; declined, exit 130 |
| Long launch | Action returned at 08:08:36; the launch completed 37 s after trust, past the action's 30 s limit; tab kept (an `on-start` hook ran, documented case) |
| Registration removed after listing | `"p3-gone" is not a registered project`, exit 1, transcript kept |
| From inside a Summon workspace session | Switch to `p3-slow` from `[p3-plain]`: the workspace kept its tab and both blocks; launcher tab closed; `p3-slow` ids unchanged |
| Error presentation | See the correction below. Final behavior: palette and key binding each opened a `Summon · error` tab, brought forward, with the full message |
| Key binding | `rex.bind("shift+cmd+o", "summon_open_workspace")` ran the action from the keyboard |
| Uninstall | Removing the `require` and reload: action gone, an unrelated fixture action still listed and runnable |
| Reload after replacing the file | New behavior took effect after `rex config reload`; `require`'s cache does not keep the old copy |
| Rex CLI E2E (required mode) | `SUMMON_REX_E2E_REQUIRED=1 pnpm exec vitest run src/e2e/rex-cli.test.ts`: 13 passed, 0 `e2e-` sessions left |

### Findings and repairs during Phase 3

1. A new window's server focus does not change the tab the app shows (`session.view` reported the new window active; the app kept the old tab). Without a fix, a trust prompt would wait in a background tab. Repair: after creating a tab, the action queues the app's `session.select` with `window_id` (`rex.client.queue`), which runs after the action returns. Verified natively for the workspace tab and the error tab.
2. Error presentation. Correction of an earlier claim in this session: I first reported that an action error is not shown in the app. That came from screenshots of a 1800x1100 region of a 6016x3384 display, which missed the toast. The owner's screenshot shows the app's "Action failed" toast, cut to about 60 characters, so the fix text is not readable there. Repair, as the plan's stuck-state row provides: a failure opens a `Summon · error` tab (fixed `/bin/sh` script, the message as a positional argument, `shell = "none"`, kept after exit), brought forward, and the action ends normally. When no tab can be opened (no session) or the workspace tab was not confirmed, the action raises as before. Consequence, documented: after an error shown in a tab, `rex do` exits 0.
3. `confirm` reads one keypress: the test input must be one byte (`n` or `y`); a two-byte write was ignored. Delivery artifact, not a product change.
4. Test-control incident, no impact on owner state: an unset variable made the picker helper type "trust" and Enter into the app while no picker was open. The app was showing the disposable `p3-origin` session, so the text reached the sentinel `cat` (visible on screen, sentinel 12 to 18 bytes). The helper was then guarded to type only while the action waits on its picker. Earlier, one default-settings palette run executed while the app showed an owner session (`commit-portfolio-plans`): it failed at the listing before creating anything, and its keystrokes went to the palette.
5. Independent review of the repairs: no high findings. Repaired: the harness now tracks `pcall` and fails when the picker is called inside it (mutation: wrapping the action in `pcall` fails 34 cases); docs now say an unconfirmed workspace tab raises and that `rex do` exits 0 after a tab-shown error; a stale comment.

### Coverage gaps (recorded, not claimed)

- One app was connected: multi-app prompt routing and the answering-versus-displaying app were not observed.
- No runtime older than API 17 was available: the `no_picker` fallback is covered by the harness only.
- Partial and unknown workspace refusal through the picker were not exercised natively; `summon open <name>` is unchanged and its existing tests and Rex E2E cover it.
- The picker was answered with System Events keystrokes, and trust prompts with `block call write`, not by a person.
- Ghostty E2E (A9) not run: no Ghostty launch code changed; Ghostty key-table output is byte-equal to baseline.

### Cleanup

Killed `p3-origin`, `p3-plain`, `p3-slow` after matching each label and id to the sandbox records (`p3-trust` was killed during the test); `rex ls` shows no `p3-` session. Removed `~/.config/rex/init.lua`, `summon-workspace.lua` and the directory (none existed before), reloaded: `rex config check` reports no file, 0 bindings, and `rex actions` lists no Summon action. Removed the sandbox, package prefix and scratch files. Owner sessions were not touched; 19 remain.

- Gate on the final tree, sequential: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build` 0, `pnpm test` 0 (102 files, 3869 passed, 20 skipped), `pnpm test:lua` 0 (60 passed).
- Native acceptance passed with the gaps above, so the `README.md` and `docs/rex.md` entries stay.
