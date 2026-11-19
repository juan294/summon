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
