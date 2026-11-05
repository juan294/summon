# Notes: Rex minimized background panes

Plan: `docs/plans/2026-11-05-rex-minimized-background-panes.md`

## Handoff

- Objective: a Summon workspace pane that only runs a background program opens in a floating Rex layer that is minimized while the program keeps running. Ghostty unchanged.
- Approved scope: plan accepted 2026-11-05 with D3 (autodetection plus `pane.<name>.background` override) and D9 (late adoption minimizes still-tiled panes) as written. Phase 1 authorized. Phases 2 and 3 are not authorized yet; no push, no release.
- Base: `develop` at `6e3001d`. Worktree: `/Users/juan/code/summon-minimized-panes`, branch `feat/rex-minimized-panes`. The plan files are gitignored in the primary checkout; copies sit in this worktree's `docs/plans/`.

## Deviations

### Phase 1

1. `CreatedIds.minimized` is optional
   - Plan said: the create step sets `ids.minimized = result.minimized`.
   - Chose: the field is present only when at least one pane was minimized.
   - Why: the existing exact-equality assertions on `outcome.ids` (`launch.test.ts`) stay unedited, as the plan's acceptance criteria require.
2. S7 notices
   - Plan said: one "Rex stopped answering" notice naming the pane whose call went unanswered and the rest.
   - Chose: a pane whose float or minimize call may have gone through is named in its own notice (`pane <n> may float over the layout (Rex stopped answering); check it in Rex`); only panes that were never touched or definitely stayed tiled go in `Rex stopped answering; <n> stays in the layout as a normal split`.
   - Why: "stays in the layout" would be false for a pane that may already float.
3. Singular and plural in notices
   - Plan said: `<n>[, <n>] stay in the layout`.
   - Chose: `stays` for one pane, `stay` for several; `a normal split` / `normal splits`.
   - Why: grammar; same facts.
4. Pass budget (not in the plan)
   - Plan said: the first unanswered call ends the pass, which bounds the time under the launch lock (S8).
   - Found: a server that answers every call near its timeout would stretch the pass with the number of panes (up to about 34 s per pane), toward the 5 minute lock bound.
   - Chose: a 30 s budget for the whole pass (`MINIMIZE_BUDGET_MS`); panes not started when it is spent stay in the layout, with the notice `Rex is answering slowly; <n> stays in the layout as a normal split`. Worst case added under the lock is about 80 s; the comment on `LAUNCH_LOCK_STALE_MS` says so and the constant is unchanged. `docs/rex.md` says "about 2 minutes" for the lock: Phase 3 docs must add the pass.
   - Why: makes the S8 claim true for a slow server, not only a silent one.
5. `onlyTiled` is built and unit-tested in Phase 1
   - Plan said: Phase 2 uses `onlyTiled`; Phase 1's `minimizePanes` section says it is implemented in Phase 1.
   - Chose: implemented with its own unit tests now (`launch.test.ts`, "minimizePanes: only the panes still in the tiled layout"); Phase 2 adds the adoption wiring and its tests.
   - Why: the plan's two sections disagree on the owner of the option; building it with the function avoids a second change to the same code.
6. Layout listing rule is general
   - Plan said: list `pane.<name>.background` with the other settings.
   - Chose: every `pane.<name>.<sub>` key (cwd, background) is listed as a setting (`src/commands/layout.ts`); `.cwd` behaves as before.
   - Why: one rule instead of one suffix per sub-key.
7. Fake `rex` tiled layer id
   - Found: `rex-hermetic.test.ts` used `layer:1` for the tiled layer, which is not a valid Rex id and would make `parseBlockLayers` skip every block.
   - Chose: a well-formed layer id in the fake. No assertion changed.
8. Dry-run body test layout
   - Found: with `a | b` and `b` minimized the outer split collapses, so D11 correctly changes its ratio and the body differs.
   - Chose: the "body unchanged" test uses `a | (b / c)` with `c` minimized (the first right split keeps both sides).
   - Why: the plan's sentence "the request body stays as it is" holds when no right split collapses; the collapsing case is covered by `layout.test.ts`.
9. Extra evidence
   - The plan's E10 (create order equals view order) was verified with two blocks only. Verified again on 2026-11-05 with a four-block nested tree `(a | (b / c)) | d`: create order, view order and block labels agreed. The probe session was removed by id; the server listed the same 13 sessions before and after.
10. The pass lives in `src/backends/rex/minimize.ts`
    - Plan said: `minimizePanes` is new in `src/backends/rex/launch.ts`.
    - Chose (altitude review): the pass (`minimizePanes`, `floatBounds`, the targets and result types) is in `minimize.ts`; `launch.ts` re-exports `minimizePanes`, `floatBounds` and the types, so the plan's tests and Phase 2 keep importing from `./launch.js`.
    - Why: `launch.ts` is about 800 lines and Phase 2 adds the adoption caller there. Phase 3 docs must add `minimize.ts` to the module table in `CLAUDE.md`.
11. Containment and progress
    - Plan said: the pass never throws (S5 to S7), no progress text.
    - Chose: `minimizePanes` catches a defect and turns it into the notice `could not minimize background panes (<message>); check <n>[, <n>] in Rex` (it claims no state: a pane may float or already have its own notice), keeping the panes already minimized; the transient line reads `Summoning <p>… minimizing background panes` while the pass runs.
    - Why: review findings 6 and 7. A defect must not fail a launch whose session and manifest already exist, and the pass can take up to about 80 s under the lock.
12. A recovery read that fails while Rex is still answering does not end the pass
    - Plan said (phase 1): only `timeout`, `unreachable` and `signal` failures whose recovery read also fails end the pass.
    - Found: the first implementation ended the pass on any failed recovery read (review finding 1).
    - Chose: the pass ends when the call may have gone through (outcome unknown) or the read was unanswered; a rejected call with an unreadable read leaves that pane and goes on. Same rule for the minimize call.
    - Why: matches the phase text; tests `S7: a rejected float whose recovery read fails with an answer Rex gave` and the unreachable variant.
13. `parseBlockLayers` accepts any string layer id
    - Plan said: layer ids are validated with `isKindId(..., "layer")`.
    - Chose: the parser keeps every block whatever its layer id looks like (review finding 3); the id is checked with `isKindId` at the point where it is sent back to Rex, both when the float call returns it and when it comes from the recovery view (second review finding 5). An unreadable id from the view gives `pane <n> floats over the layout but could not be minimized (Rex returned an unreadable layer id); minimize it in Rex`.
    - Why: a layer id format change must not silently turn every tiled block into "not in the session".
14. An invalid `pane.<name>.background` value warns under Rex only (changed 2026-11-05 on the owner's decision; first it warned under Ghostty too)
    - Plan said: D12 "Ghostty ignores the key silently" and S11 "invalid value: warning naming the key".
    - First chose: S11 (config validation is backend-independent, review finding 4). Then, 2026-11-05, the owner chose silent under Ghostty: the parser collects the messages and only the Rex backend prints them. A valid value is silent under Ghostty; the Ghostty dry-run script is identical for `true`, `false` and no key. Phase 3 docs must say so. The key did not exist before, so no existing configuration gains a warning.
15. Test locations
    - The Ghostty-unchanged test is in `src/dry-run-parity.test.ts` (built CLI, fresh HOME, `TERM_PROGRAM=ghostty`), not `src/launcher.test.ts`. The lock bound has its own `src/backends/rex/minimize.test.ts`.
16. Derived lock bound
    - `MINIMIZE_WORST_CASE_MS` (81 s, from the call timeouts and the budget) replaces the hand-written numbers in the `LAUNCH_LOCK_STALE_MS` comment; `minimize.test.ts` asserts it plus 2 minutes stays below the 5 minute bound.

17. D11 changes the layout of a launch where minimizing does not happen
    - Plan said: D11, the editor size goes to the first right split that keeps a visible pane on both sides.
    - Found (second review, finding 6): the builder decides the ratios before the capability check. With `a | b` and `b` marked background, the only right split keeps 0.5. If minimizing then does not happen (Rex without `set_layer_state`, a rejected float), `b` stays a normal split in a 50/50 layout instead of the configured `editor-size`.
    - Chose: keep D11 as accepted. The notices already say the pane stays in the layout; Phase 3 docs must say that a pane that could not be minimized keeps the layout D11 gave it.
    - Why: choosing the ratio after the capability check would put a Rex call into the pure request builder.
18. The manifest parser drops the first pane from `minimize`
    - Chose (second review, finding 7): `parseLaunchManifest` removes `paneOrder[0]` from `minimize`, so Phase 2's adoption cannot try to float the root pane (D4).

## Review and simplify dispositions (Phase 1)

Independent review (fresh-context agent, 8 findings, none above low):

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Any failed recovery read ended the pass | Resolved (deviation 12) |
| 2 | Three untested branches in the pass | Resolved: tests added |
| 3 | Layer id format could hide every block | Resolved (deviation 13) |
| 4 | Invalid value warns under Ghostty | Accepted exception, recorded (deviation 14) |
| 5 | Cascade index comment wrong | Resolved: comment states the real rule |
| 6 | Pass not contained | Resolved (deviation 11) |
| 7 | No activity during a long pass | Resolved (deviation 11) |
| 8 | Duplicated expression and plural helper | Resolved in the simplify pass |

Simplify pass (reuse, simplification, efficiency, altitude agents):

- Resolved: move to `minimize.ts`; derived lock bound with test; one `extractPaneOption` in `src/tree.ts`; one `callSessionView` in `src/backends/rex/status.ts`; derivable `notice` field removed; `paneStays` helper; one pane-to-block map instead of two lookups; redundant guard removed; shared `MinimizeOptions`; empty-map ternary removed in `src/config-resolve.ts`; duplicate test fixture hoisted in `launch.test.ts`.
- Skipped with reason: merging `parseBlockLayers` into `parseSessionView` (the plan keeps that parser and its exact-equality tests unchanged); a shared pane-key predicate for `src/commands/layout.ts` (`layout.test.ts` mocks `../tree.js` with one export); hoisting `capture()` in `backend.test.ts` (edits pre-existing test code); `ignoredBackground` with reasons (the plan fixes it as a list of names); skipping the recovery read when a float never reached Rex (saves one call only on the Rex-down path and removes the chance that a blip lets the pass continue); making `paneBackground` required end to end (touches many fixtures for one conditional spread).
- `onlyTiled` is kept: the plan assigns its implementation to Phase 1 (deviation 5).

## Phase 3 follow-ups collected so far

- `docs/rex.md`: the launch lock paragraph says "about 2 minutes"; add the background-pane pass (`MINIMIZE_WORST_CASE_MS`).
- `CLAUDE.md` module table: add `backends/rex/minimize.ts` (and `background-command.ts` when it exists).
- Docs: an invalid `pane.<name>.background` value warns under Rex only (owner decision 2026-11-05: silent under Ghostty); `false` and `true` are silent under Ghostty.

## Second review (fresh context, on commit `d163595`): 7 low findings

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Containment notice could say "stays in the layout" for a floating pane | Resolved (deviation 11): the notice claims no state |
| 2 | "Pane file names the block" test could not tell file from position | Resolved: the view now starts with the root block and lists the rest in another order |
| 3 | Three untested branches in `minimize.ts` | Resolved: three tests added |
| 4 | `viewSession` lost its doc comment | Resolved |
| 5 | Layer id from the recovery view reused unvalidated | Resolved (deviation 13) |
| 6 | D11 ratio on the fallback path | Recorded (deviation 17), no code change |
| 7 | Manifest `minimize` could list the root pane | Resolved (deviation 18) |

Resolved 2026-11-05: the parser no longer writes; the Rex backend prints the collected messages, so the double resolve after the wizard cannot warn twice.

## Phase 3 follow-ups: addition

- Docs: a pane that could not be minimized keeps the layout D11 gave it (deviation 17).

### Phase 2

1. Progress on the launch path (not in the plan)
   - Plan said: the adoption minimizes background panes after the record is written; no progress text.
   - Chose (review finding 2): `AdoptDeps.progress`; the Rex backend's `beforeLaunch` shows the transient line `Summoning <p>… minimizing background panes` while an adoption minimizes, and clears it before any notice. Status reads and `clean --orphans` stay silent (the monitor already shows "updating…").
   - Why: the pass can take up to about 81 s when Rex is slow, and `summon <p>` would otherwise print nothing for that time.
2. The decision type carries the pass inputs
   - `Decision` of kind `adopt` gains `PendingMinimize` (`server`, `minimize`, `unconfirmed`). `server` exists only to narrow the optional `LaunchManifest.server`; the comment says so.
3. Test fixtures
   - `src/status.reconcile.test.ts`: the shared fake `rex` logs every call and answers `describe`, `session.float_block` and `session.set_layer_state` only when the fixture sets `layers: true`; every other test still fails on an unexpected call.
   - The hermetic scenario counts `session.create` across both launches (one in total) and asserts the switch line.

Accepted limitations (second review of Phase 2, none changes a plan decision):

- Interrupted adoption (finding 1, medium): the adoption record is written before the pass and the pass runs once. If the process is killed mid-pass (monitor quit, Ctrl-C of `summon status`), the panes stay normal splits and nothing retries (D10). The user sees the layout they would have had without the feature; the notices of that pass are lost.
- A pane whose file arrives after the adoption (finding 3) gets the "its block was not confirmed" notice and is not minimized later (D10). S5's "the next launch tries again" holds on the create path, not on the adoption path.
- A pane the user docked back into the tiled layout is minimized again when an older, still-live orphan is adopted later (finding 4); D9 protects blocks that already float.
- Phase 3 docs: say all three.

### Phase 2 review dispositions

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Interrupted pass never retries | Accepted limitation |
| 2 | Pass silent for up to about 81 s on the launch path | Resolved (deviation 1) |
| 3 | Late pane file, no retry | Accepted limitation |
| 4 | Docked-back pane re-minimized by an older orphan | Accepted limitation |
| 5 | Test gaps (server, second orphan, `clean --orphans`, notice order, exact call lists) | Resolved: tests added, live and superseded tests assert the exact call list |
| 6 | Hermetic "one create" only covered the second launch | Resolved (deviation 3) |
| 7 | Reconcile fake answered layer calls for every test | Resolved (deviation 3) |
| 8 | `server` field, `plain()` reuse, long union line | Resolved (deviation 2) |

### Phase 3

1. Phase 1 tests that used `npm run dev` as the unremarkable pane
   - Plan said: the Phase 1 and 2 tests stay green without edits, because their layouts use commands outside the table or the key.
   - Found: six Phase 1 tests (`layout.test.ts`, `backend.test.ts`) used `npm run dev` with no key, or with `false`, to assert "nothing is minimized"; the table now minimizes it.
   - Chose: those tests use `make serve` (outside the table), so they still prove what the key alone does; the table's own cases are in `background-command.test.ts` and the "autodetected background panes" describes. Tests that set `true` explicitly are unchanged in meaning.
2. C23 was not run through vitest
   - Plan said: `SUMMON_REX_E2E=1 pnpm vitest run src/e2e/rex-cli.test.ts` passes with C23.
   - Found (2026-11-05 09:37): the Rex app process (`Rex`) had no window open (`System Events` counts 0), which the suite's gate requires; the file skips all 13 scenarios without its opt-in and was not run with it. I did not send keystrokes into the owner's app to open a window.
   - Chose: the same checks by hand against the real preview.25 server in a sandbox HOME with the built candidate: dry run (both header lines, no session created); real launch (exit 0, `Workspace [<p>] ready in Rex (minimized: logs; summon focus <p> logs shows one).`); `session.view` (tiled layer holding only `editor`, one floating layer with `state: minimized` holding `logs`); a line appended to the followed file reached the minimized block on the first try; `status` active, `inspect` both panes available; `summon focus` exit 0 and the layer lost its `state`; `--layout bgkeep --new-window` kept both blocks tiled with no floating layer and no `minimized:` text. Both sessions were removed by id; the server listed the same 13 sessions as before. This is a manual run, not the suite: the suite's C23 itself is unrun and its selection and focus steps in a real window are unobserved.
   - Owner action to close the gap: with an app window open, `SUMMON_REX_E2E_REQUIRED=1 pnpm exec vitest run src/e2e/rex-cli.test.ts` (alone, load below about 15), then the manual step 2.9 of the E2E guide.
3. The table is stricter than the plan's list in a few places (second review of Phase 3, finding 2)
   - Chose: a program asked for `--help`, `--version` or `-h` is never a background program; `vite -v` and `nodemon -v` neither; `ngrok` only with `http`, `tcp`, `tls` or `start`; `rails s -d` and `rails server --daemon`, and `docker compose up` with `-d` (also inside a short option group), `--detach`, `--wait` or `--no-start`, return and are not background; `-F` counts as follow for `tail` only (`journalctl -F` is `--field`).
   - Why: each of those would have hidden a pane that prints a result or an error the owner needs to read. The plan's table and its must-be-true and must-be-false cases are unchanged.
4. Accepted limits of the table (listed in `docs/rex.md`)
   - The plan's script rule accepts any suffix, so `npm run dev:lint` or `npm run start-db` are minimized. `ngrok http` and `stripe listen` are in the plan's table although they print a URL or a secret; `docs/rex.md` says to use `background=false` or `summon focus`. Option forms the table does not look through (`vite --port 3000`, `pnpm -F web dev`, `flask --app x run`, `docker compose -f f.yml up`) are not detected and stay visible, which is the safe direction.
5. Documentation beyond the plan's list
   - `docs/architecture.md` gets rows for `background-command.ts` and `minimize.ts` and the new dependency of `backends/rex/layout.ts`. The user manual says that the existing `pane.backend=npm run dev` example is minimized under Rex.
6. `CLAUDE.md` has a `minimize.ts` row (deviation 10 of Phase 1) and a `background-command.ts` row.

### Phase 3 review dispositions

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Step 2.9 used a project and a layout that the guide's setup never creates | Resolved: the step carries its own setup and teardown |
| 2 | Finite or informational commands hidden (`vite --help`, `ngrok version`, `rails s -d`, `docker compose up --wait`, `journalctl -F`) | Resolved (deviation 3), tests added |
| 3 | `ngrok http` and `stripe listen` hide output the owner must read | Accepted: in the plan's table; documented, opt-out and `summon focus` |
| 4 | Script suffix rule hides `dev:lint`-style scripts | Accepted: the plan's regex; documented |
| 5 | Inconsistent option parsing (false negatives only) | Accepted: safe direction; documented |
| 6 | Doc claims wider or narrower than the code | Resolved: `docs/rex.md` matches the code |
| 7 | Weak C23 assertions | Resolved: `rowOf` for status, `availability` for inspect |
| 8 | `docs/architecture.md` rows missing | Resolved (deviation 5) |
| 9 | Manual example now minimized without a word | Resolved |
| 10 | Python rule hidden in `default:` | Resolved: commented |

## Final state of the work

- Branch `feat/rex-minimized-panes`, three phases, base `develop` at `6e3001d`. Nothing pushed, nothing published, no release.
- Resources: the Rex probe sessions of this work were removed by their ids; the server listed the same 13 sessions before and after each run. No Docker resources were used. The worktree `/Users/juan/code/summon-minimized-panes` is retained until the branch is integrated.
- Open owner items: the C23 suite run and the manual capsule check (deviation 2 of Phase 3); the interpretation of a warning under Ghostty for an invalid value (deviation 14 of Phase 1); release, push and version are separate authorizations.

