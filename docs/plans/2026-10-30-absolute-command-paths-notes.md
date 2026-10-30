# Notes: absolute command paths

Plan: `docs/plans/2026-10-30-absolute-command-paths.md`

## Deviations

### Phase 1

1. `commandFixHint` key test
   - Plan said: look up `VALID_KEYS` for `summon set` wording, fall back to the same wording for other keys.
   - Found: `src/launcher.test.ts` mocks `./config.js` without `VALID_KEYS`; every key that is not `pane.*` ends in the same wording either way.
   - Chose: branch on the `pane.` prefix only.
   - Why: identical output for every key, no new import into the launcher, no mock churn.
2. Second message line
   - Plan said: "Please fix it or <hint>" for every case.
   - Chose: missing-name keeps "Please install `x` manually or <hint>" (unchanged text for config keys, so existing tests and users see no change); missing-path uses "Please fix the path or <hint>"; bad-form uses "Please <hint>" (the first line already states the rule).
   - Why: the wording matches the action in each case.
3. Install-declined line
   - Plan said: replace the `summon set` text with the hint.
   - Chose: "Exiting — `x` is needed for this workspace layout. To use another command, <hint>".
   - Why: the hint is a clause that starts with "change", so it needs a lead-in.
4. utils tests
   - Plan said: `statSync`/`accessSync` spies in `src/utils.test.ts`.
   - Chose: real temp files (the file already spreads the real `node:fs`).
   - Why: exercises the real permission and file-type checks with no extra mocks.
5. `ensureCommand` signature
   - Plan said: `ensureCommand(cmd, configKey, layoutName?)` builds the hint.
   - Chose (simplify, altitude review): `ensureAndResolve` builds the hint with `commandFixHint(configKey, treeLayout?.layoutName)` and passes `ensureCommand(cmd, hint)`.
   - Why: `ensureCommand` used the key and layout only for the hint; one string is simpler.
6. Control-character regex
   - Plan said: reject characters below 0x20.
   - Chose (simplify, reuse review): one exported `CONTROL_CHARS_RE` (`[\x00-\x1f\x7f-\x9f]`) in `src/utils.ts`, now also used by `src/pane-inventory.ts`; `describeCommandFailure` classifies control characters as bad-form.
   - Why: the codebase already had this regex; the narrower copy let DEL and C1 through, and the classifier had drifted from `resolveCommand`.

### Phase 2

1. Install-offer note
   - Plan said (D3): one note per command that would stop the launch.
   - Found: a missing `claude` (or `lazygit` with Homebrew) does not stop a real launch; it prompts to install.
   - Chose: those get ``is not on your PATH; a real launch offers to install it.`` instead of "stops here". The probe is `knownInstallCommand`, the same one `ensureCommand` uses (it may run `command -v brew`, read-only). Docs and changelog say "reject (or offer to install)".
   - Why: "stops here" would be false for those commands.
2. `GhosttyCommandEntry` shape
   - Plan said: `Array<{ key, command }>`.
   - Chose: `{ key, pane?, command, set }`. `set` stores the resolved command back so the backend loop needs no per-field code; `pane` carries the leaf name so the note label does not re-parse `pane.<leaf>`.
   - Why: the backend and the dry run read one list (no drift), and the key string is parsed in fewer places.
3. Shared classifier (simplify, reuse and altitude reviews)
   - Plan said: `dryRunCommandNotes` calls `resolveCommand` and `describeCommandFailure`.
   - Chose: one `checkCommand(cmd)` (resolve, classify, install method) and one `COMMAND_FAILURE_REASONS` table in `src/launcher.ts`, used by both `ensureCommand` and the dry run. User-facing launch text is unchanged.
   - Why: the dry-run promise is "checks what a real launch would"; two copies of the decision and wording could drift.
4. Layout union type
   - Plan said: `ghosttyCommandEntries(layout)` with `{ kind, plan }`.
   - Chose: `PlannedLayout` exported from `src/tree.ts`; `SessionCreateInput.layout` in `src/backends/rex/layout.ts` now uses it.
   - Why: the Ghostty backend would otherwise import a type from the Rex module.
5. `Object.hasOwn` for the install table
   - Found (review): `KNOWN_INSTALL_COMMANDS[cmd]` matched inherited names, so a missing command named `toString` was treated as installable.
   - Chose: `knownInstallCommand` checks own keys; test covers the dry run and the real launch (mutation-checked).
6. Changelog heading
   - Plan said: add a `### Fixed` section. Found: `[Unreleased]` already had one. Chose: two entries under the existing heading.
7. Manual check 1 command
   - Plan said: `./dist/index.js /Users/juan/code/home-weave --layout abs-check`. Chose: added `--new-window` (also to the dry run).
   - Why: without it the launch could split the owner's front Ghostty window.

## Phase 1 handoff (2026-10-30)

- Worktree: `/Users/juan/code/summon-wt-abs-paths`, branch `fix/absolute-command-paths`, base `develop` at `d9ed5bb`, Phase 1 commit `61a500d` (pre-commit hook re-ran typecheck, lint, build and the full suite: 3150 passed, 7 skipped). Not integrated into `develop`, not pushed.
- Gate on the final candidate (sequential, all exit 0): `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (81 files, 3150 passed, 7 skipped), `pnpm test:coverage` (all files 96.69% statements, thresholds met). Baseline before changes: 3130 passed, 7 skipped.
- TDD evidence: utils and launcher tests failed before implementation (8 and 5 failures, missing functions or old messages); T1.9, T1.10, T1.11 failed with `src/utils.ts` stashed and passed with it; the control-character test fails with the guard removed (mutation check) and passes with it.
- Independent review (fresh agent): APPROVED. Findings and dispositions:
  - R1 should-fix, control-character test did not discriminate: fixed (real executable named `x\nrm`, mutation-checked).
  - R2 nit, inline tree commands (`tree="/opt/x/nope" | main`) get a `pane.<derived-name>=` hint that has no matching line: accepted as known limitation; `summon layout edit <layout>` in the same hint is correct. Follow-up candidate.
  - R3 nit, pre-existing: `src/backends/ghostty.ts:174` passes `"editor"` for `secondaryEditor`, so the hint says `summon set editor`: out of scope, follow-up candidate.
- Simplify pass (4 reviewers): applied S1 shared `CONTROL_CHARS_RE`, S2 classifier handles control characters, S3 `ensureCommand(cmd, hint)`, S4 `stopLaunch` helper for fail/err/throw, S5 removed unused `mockAccessSync`, S6 `whichMissing` test helper. Skipped with reason: unreachable `commandFixHint` fallback (kept as the plan's defensive branch, tested); un-exporting `describeCommandFailure` (plan specifies it, Phase 2 uses it); reusing `useTreeLayout` in T1.8 (T1.8 deliberately uses `pane.sidebar` to prove a pane named like a config key does not get `summon set sidebar`); moving rex `fakeBinary` to a shared helper (outside the diff); typed config/pane key union (touches the backend context type and 5 call sites; follow-up with R3); doctor still says "not found in PATH" for a missing absolute path (plan scope for doctor is tests only; follow-up).
- Phase 2 entry: this commit on the same worktree, gate green. Phase 2 uses `describeCommandFailure` and the `pane.<leaf>` keys.

## Phase 2 handoff (2026-10-30)

- Worktree: `/Users/juan/code/summon-wt-abs-paths`, branch `fix/absolute-command-paths`, Phase 2 commit `9d2a2eb` on top of `61a500d` (base `develop` at `d9ed5bb`). Files: `src/backends/ghostty.ts`, `src/launcher.ts`, `src/launcher.test.ts`, `src/tree.ts`, `src/backends/rex/layout.ts`, `docs/user-manual.md`, `CHANGELOG.md`. Not integrated into `develop`, not pushed.
- Entry check: `pnpm test` on `61a500d` before changes: 81 files, 3150 passed, 7 skipped.
- Gate on the final candidate tree (sequential, all exit 0): `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (81 files, 3157 passed, 7 skipped), `pnpm test:coverage` (all files 96.71% statements, thresholds met), zero-runtime-deps check. The pre-commit hook re-ran typecheck, lint, build and the full suite on the commit: 3157 passed, 7 skipped. `src/shell-escape.lint.test.ts` unchanged and passing.
- TDD evidence: T2.1, T2.2, the install-offer test and T2.5 failed before implementation (no notes; `ghosttyCommandEntries is not a function`); T2.3 and T2.4 are guards that passed before and after. The `toString` test fails with the own-key check replaced by `in` and passes with it.
- Manual acceptance (agent, Ghostty 1.x, `TERM_PROGRAM=ghostty`, built `dist/` from this tree):
  1. Layout `abs-check` (`tree=main | enhance`, `pane.main=zsh`, `pane.enhance=/opt/homebrew/bin/gh-glance`): dry run exit 0, no note. Real launch with `--new-window`: exit 0, "Workspace ready"; `summon inspect home-weave --json` shows pane `enhance` titled `/opt/homebrew/bin/gh-glance`; `ps -t ttys031` shows `node /opt/homebrew/bin/gh-glance` in the foreground (`S+`). The window was left open.
  2. `pane.enhance=/opt/homebrew/bin/nope`: dry run exit 0, script on stdout, stderr exactly ``summon: note: pane `enhance`: `/opt/homebrew/bin/nope` was not found or is not executable; a real launch stops here.``. Real launch exit 1 with the missing-path error and ``Please fix the path or change `pane.enhance=` in layout abs-check: summon layout edit abs-check``.
  3. `summon layout delete abs-check`: deleted, file confirmed absent.
- Independent review (fresh agent): APPROVED. Findings and dispositions:
  - R1 should-fix, install-offer note not recorded and docs inconsistent with changelog: fixed (deviation 1, docs say "reject (or offer to install)").
  - R2 should-fix, T2.5 compared the list with itself and did not test the `set` closures: fixed (stub resolves to `/r/<cmd>`; the test asserts every traditional field and every tree pane after launch).
  - R3 nit, inherited names matched the install table: fixed (deviation 5).
  - R4 nit, secondary editor labelled `editor`: same as Phase 1 R3, out of scope, follow-up.
  - R5 nit, Ghostty imported a Rex type: fixed (deviation 4).
  - R6 nit, dry run of a missing `lazygit` runs `command -v brew`: accepted, read-only and needed for a truthful note.
- Simplify pass (4 reviewers): applied shared `checkCommand` and `COMMAND_FAILURE_REASONS` (deviation 3), `pane` on the entry instead of re-parsing the key, field table for traditional entries, neutral `PlannedLayout`, multi-line T2.5 context reusing `stderrOf`. Skipped with reason: batching `which` calls (dry-run path only, under 40 ms, the launch path has the same pattern); a shared `BackendLaunchContext` test fixture across `launcher.test.ts` and `rex/backend.test.ts` (outside the diff); merging the `confirmDangerousCommands` command list (`src/launcher.ts`, uses `secondary-editor` as its key) with `ghosttyCommandEntries` (pre-existing, changes a security gate; follow-up); a shared `paneNameFromKey` helper for the other four `pane.` parses (outside the diff).
- Observed during manual check, not changed: a missing-path launch prints the headline twice (once by `stopLaunch`, once by the top-level handler in `src/index.ts:228`). Every launch error thrown through that handler repeats its message; the other `ensureCommand` cases print a shorter second line. Follow-up candidate (pass a reported flag or a distinct error class to the handler).
- Follow-up candidates carried: Phase 1 R2 (inline tree command hint), Phase 1 R3 / Phase 2 R4 (secondary editor key), doctor wording for a missing absolute path, `summon layout edit` requires a bare `EDITOR`, the duplicate headline above, the third command list in `confirmDangerousCommands`.
- Next: owner acceptance of Phase 2, then local integration into `develop` (fast-forward or merge of `fix/absolute-command-paths`, then the full gate on `develop`). Also commit this notes file, which is untracked in the primary checkout. Push, release and npm publish need separate authorization and follow `docs/release/release-checklist.md`.

## Integration (2026-10-30)

- Owner accepted Phase 2. `develop` fast-forwarded from `d9ed5bb` to `9d2a2eb` (`fix/absolute-command-paths`, no merge commit).
- Gate on `develop` at `9d2a2eb` (sequential, all exit 0): `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (81 files, 3157 passed, 7 skipped), `pnpm test:coverage` (96.71% statements), zero-runtime-deps check.
- Not pushed. Push, release and npm publish need separate authorization and follow `docs/release/release-checklist.md`.
