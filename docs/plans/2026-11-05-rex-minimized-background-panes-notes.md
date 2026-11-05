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
    - Chose: `minimizePanes` catches a defect and turns it into the notice `could not minimize background panes (<message>); <n> stays in the layout as a normal split`, keeping the panes already minimized; the transient line reads `Summoning <p>… minimizing background panes` while the pass runs.
    - Why: review findings 6 and 7. A defect must not fail a launch whose session and manifest already exist, and the pass can take up to about 80 s under the lock.
12. A recovery read that fails while Rex is still answering does not end the pass
    - Plan said (phase 1): only `timeout`, `unreachable` and `signal` failures whose recovery read also fails end the pass.
    - Found: the first implementation ended the pass on any failed recovery read (review finding 1).
    - Chose: the pass ends when the call may have gone through (outcome unknown) or the read was unanswered; a rejected call with an unreadable read leaves that pane and goes on. Same rule for the minimize call.
    - Why: matches the phase text; tests `S7: a rejected float whose recovery read fails with an answer Rex gave` and the unreachable variant.
13. `parseBlockLayers` accepts any string layer id
    - Plan said: layer ids are validated with `isKindId(..., "layer")`.
    - Chose: validated only on the id the float call returns (it is sent back to Rex); the view's ids are not format-checked (review finding 3).
    - Why: a layer id format change must not silently turn every tiled block into "not in the session".
14. An invalid `pane.<name>.background` value warns under Ghostty too
    - Plan said: D12 "Ghostty ignores the key silently" and S11 "invalid value: warning naming the key".
    - Chose: S11 (config validation is backend-independent, review finding 4). A valid value is silent under Ghostty; the Ghostty dry-run script is identical for `true`, `false` and no key. Phase 3 docs must say so. The key did not exist before, so no existing configuration gains a warning.
15. Test locations
    - The Ghostty-unchanged test is in `src/dry-run-parity.test.ts` (built CLI, fresh HOME, `TERM_PROGRAM=ghostty`), not `src/launcher.test.ts`. The lock bound has its own `src/backends/rex/minimize.test.ts`.
16. Derived lock bound
    - `MINIMIZE_WORST_CASE_MS` (81 s, from the call timeouts and the budget) replaces the hand-written numbers in the `LAUNCH_LOCK_STALE_MS` comment; `minimize.test.ts` asserts it plus 2 minutes stays below the 5 minute bound.

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
- Docs: an invalid `pane.<name>.background` value warns under both backends; `false` and `true` are silent under Ghostty.
