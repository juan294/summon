# Notes: live ports from Rex (implementation)

Plan: `docs/plans/2026-11-19-rex-live-ports.md` with phase files in `docs/plans/2026-11-19-rex-live-ports-phases/`. The plan and phase files are kept only in the main tree, under `/Users/juan/code/summon/docs/plans/`, because `.gitignore:31` ignores `docs/plans/*`. This notes file is force-added, as `2026-11-18-rex-workspace-picker-notes.md` was.

Authorization: the owner said on 2026-11-19 "go ahead with all phases, no stopping". Phases run one after another without a stop at the acceptance gates. A merge to `develop` and a push were not authorized by that message. Branch `feat/rex-live-ports` in worktree `/Users/juan/code/summon-live-ports`, base `develop` `69603ff`. The project overlay `.rpi/project/rpi-plan.md` does not exist; no declared override was applied.

## Phase 1: Rex live-ports reader

**Delivered:**
- `src/backends/rex/cli.ts`:
  - `rexArgs` and `completed` are extracted from `runRex`, which behaves as before. The full `runRex` suite passes unchanged.
  - New `runRexAsync`, plus `execRexAsync`, which calls `execFile` with no shell, closes stdin and kills with SIGKILL.
- `src/backends/port.ts`: new types `LivePort`, `LivePortsStatus`, `LivePortsResult` and `LiveBudget`, plus an optional `WorkspaceBackend.livePorts?`.
- `src/backends/live-budget.ts` (new): `createLiveBudget`.
- `src/backends/rex/ports.ts` (new): `parsePortsReply` and `readLivePorts`.
- `src/backends/rex/workspace.ts`: `RexWorkspace.livePorts`, which goes through `rexCommandGate` and loads `./ports.js` lazily.

**Deviations from phase-1.md, with reasons:**
- **D-P1-1:** `createLiveBudget(deadlineMs, now)` lives in `src/backends/live-budget.ts`, not in `backends/rex/ports.ts`. The budget is shared by every backend, and the generic `src/ports.ts` creates it, so it must not import a Rex module.
- **D-P1-2:** `readLivePorts(target, budget, run)` takes a `LiveTarget` (binary, server, session, blocks) instead of the gate object. That keeps the module free of the status types. `RexWorkspace.livePorts` builds the target from the gate.
- **D-P1-3:** the process label takes the basename of `argv0` and `name` as well as `script`. A full interpreter path as `argv0` becomes `Python`; a lone `/` stays `/`. The parser test asserts this.
- **D-P1-4:** a reply without a `processes` array is accepted as `ok`, with null process labels. Rex's schema makes `processes` part of every reply, so a missing array is an old or odd server, and the ports are still true. Step 1's "validate processes array" is narrowed to "validate when present".
- **D-P1-5:** each call is bounded by the shared deadline through `Promise.race` (`bounded`), as well as by passing the signal to the process. A runner that ignores the signal still ends at the deadline (review finding 3). The listed test with fake timers uses a real 50 ms deadline instead, plus an injected clock for the two branches where the deadline passes between steps.
- **D-P1-6:** `expired()` checks the clock as well as the timer, because synchronous work, such as `execFileSync` status reads, can hold the timer past the deadline (review finding 4).
- **Order:** for this phase's code the tests were written after the code, not before it. Coverage and the review's branch list close the gap. Phase 2 goes back to tests first.

**Independent review:** one reviewer, read-only, briefed with the phase file, the plan, the changed files and the verified Rex facts. Verdict: CHANGES REQUESTED.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R1-1 | must-fix | Coverage of `ports.ts` branches was 93.63%, below the 95% gate; no test made the `block ls` call itself fail; deadline and parser branches were uncovered | Fixed: tests for a failed block list, the deadline after the probe and during the list, a merged partial reason, a missing `processes` array, a non-integer pid, and the slash label. `ports.ts` is now 98.43% lines and 99.1% branches. |
| R1-2 | should-fix | `MaxListenersExceededWarning` on Node 22 when more than 10 reads share the signal | Fixed: `setMaxListeners(0, signal)` in `createLiveBudget`; a test adds 40 listeners and asserts no warning |
| R1-3 | should-fix | A runner that ignores the signal hangs `readLivePorts` | Fixed: D-P1-5; test "a runner that ignores the signal and never answers still ends at the deadline" |
| R1-4 | nit | Deviations not recorded; timer-only expiry | Fixed: D-P1-1, D-P1-2, D-P1-6 |
| R1-5 | nit | Parser behavior differs from the contract text | Recorded: D-P1-3, D-P1-4 |

The reviewer checked and found correct: parity between `runRex` and `runRexAsync` for every execFile error shape; nothing keeps the process alive; the capability probe is shared per binary and server; and `livePorts` starts no process for `stopped` or `unknown` records.

One test bug was found and fixed during the repair. The abort test's fake script ran a bare `sleep`, which the suite's empty `PATH` cannot find, so it exited 127 at once. It now uses `/bin/sleep`.

**Gate on the Phase 1 tree** (the Phase 2 work in progress was stashed, so the tested tree is the committed tree):

| Check | Result |
| --- | --- |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | exit 0 |
| `pnpm test` | 105 files, 3,912 passed, 20 skipped |
| `pnpm test:lua` | 60 passed |
