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

## Phase 2: `summon ports` (text and `--json`), `doctor`, `inspect`

**Delivered:**
- `src/ports.ts`:
  - `detectAllPorts` returns a `PortsReport`: the static `assignments`, `conflicts` and `projectCount` as before, plus `live`, `held`, `notes`, `liveWorkspaces` and `readWorkspaces`.
  - The live read runs beside the static scan, with one `LiveBudget`, and only for `active` or `partial` records whose backend has `livePorts`.
  - New exports: `EPHEMERAL_FROM` (49152), `holderLabel`, `heldLine` and `liveNoteLines`, which are shared by `ports` and `doctor`.
- `src/commands/runtime.ts`: `handlePortsCommand({ values })`.
  - **Text:** a `DETAIL` column that appears only when there is a detail, so a static-only table is unchanged. Claims show `listening: <pane> (<process>)` or `held by <project>/<pane> (<process>)`, and live rows carry source `live`.
  - **Hidden ports:** an unclaimed ephemeral port is hidden and counted. A holder bound on two addresses counts once. With one project the count line names it, with two or three it lists them, and past three it counts the workspaces.
  - **Footer:** held conflict lines and note lines.
  - **`--json`:** prints one JSON object.
- `src/commands/doctor.ts`:
  - `livePortsCheck(report)` (pure) and a `Checking live ports...` section after the static port check.
  - A held conflict is a FAIL and one issue. With nothing held the check passes. Notes print as INFO, and the check is not counted when nothing was read or no Rex workspace runs.
- `src/backends/rex/status.ts`: `inspectRex` reads `ports` for each available pane, with a 2 s timeout. It stops after a server with no `ports` method or a timeout, and adds `panes[].ports`, `portsStatus` and `portsReason`.
- `src/backends/rex/workspace.ts`: inspect text prints `    ports: <port> <address> (<process>), ...` under a pane, and `  live ports: <reason>` when the read was incomplete. Everything is escaped.
- `src/backends/rex/ports-reply.ts` (new, a leaf module): the reply parser and its constants. `ports.ts` re-exports them, so a status read does not load the side-by-side live read.
- `src/cli/help.ts`: `summon ports [--json]`, in the overview and the subcommand help. `src/completions.ts`: `Print JSON (inspect, list, ports)`.

**Deviations from the plan, with reasons:**
- **D-P2-1 (JSON shape):**
  - A `held` conflict carries `process`, and its `claimants` are `[{ project, source }]` rather than names. The source is what tells the user where to change the claim.
  - Each `live[]` row carries the workspace `state`, which the text table needs too.
  - The runtime test asserts this shape.
- **D-P2-2 (note wording):**
  - One wording, `live ports incomplete for <projects> (<reason>)`, covers both "unavailable" and "partial". Grouping by reason keeps one line for many workspaces.
  - The partial reason from Rex reads `some processes could not be read; a port may be missing`.
  - The API note prints once, without project names: `this Rex server has no live ports (needs API 16 or later)`.
- **D-P2-3 (hidden line):**
  - The wording is `N ephemeral live port(s) hidden; summon inspect <project> lists them.` when the ports are in one project's recorded panes.
  - Otherwise it reads `(<projects>)` for up to three projects, or `in N workspaces` past three, and points at `summon ports --json`.
  - The reason: on the owner's machine all 17 workspaces hold an agent port, and listing 17 names made the line unreadable.
- **D-P2-4:** in `inspect`, the ports of panes that were not recorded are not listed. Inspect lists recorded panes only, as before. `summon ports --json` has every block, and the hidden line points there when a hidden port sits in a pane split by hand (review R2-1).
- **D-P2-5:** inspect stops asking for ports after the first timeout, as it does for a server without the method, so a slow server costs one 2 s wait rather than one per pane.
- **Order:** the tests came first for the `detectAllPorts` live data, the `ports` command, the doctor check, help and completions, and `inspectRex` and its output. Each failed before its code. The later changes (the hidden-line shortening, the review fixes) got their tests in the same step as the code.

**Gate on the Phase 2 tree** (Phase 3 work stashed, so the tested tree is the committed tree): typecheck, lint and build exit 0 (a first run failed typecheck on an untyped callback parameter in the new doctor test; fixed and rerun); `pnpm test` 105 files, 3,943 passed, 20 skipped; `pnpm test:lua` 60 passed.

**Independent review:** one reviewer, read-only, briefed with both phase files, the plan's decisions, stuck states and consumer sweep, and the Phase 1 notes. Verdict: CHANGES REQUESTED, with no must-fix items.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R2-1 | should-fix | The hidden line points at `inspect`, which lists recorded panes only | Fixed: D-P2-4, with a test for a hidden port in an unrecorded pane |
| R2-2 | should-fix | The JSON and text contract differed from the plan and was not recorded | Recorded: D-P2-1, D-P2-2, D-P2-3; Phase 3 docs and C24 use the final shape |
| R2-3 | should-fix | Inspect's ports calls used the 8 s read timeout | Fixed: 2 s `PORTS_CALL_TIMEOUT_MS`, and a stop after the first timeout (D-P2-5); test checks both |
| R2-4 | should-fix | Doctor's counting of the live check was untested end to end | Fixed: a `handleDoctorCommand` test with a held report (one more check, one more failure) and a clean one (one more passed check) |
| R2-n1 | nit | DETAIL column out of line by 2 | Fixed: the header gap is 6 spaces; the alignment was checked by printing rows |
| R2-n2 | nit | Hidden count counted bindings | Fixed: deduplicated on port, project and pane; tested |
| R2-n3 | nit | `rex/status.ts` imported `./ports.js` statically, which made the lazy import in `livePorts` pointless | Fixed: the leaf module `ports-reply.ts` |
| R2-n4 | nit | Doctor imported `../ports.js` both statically and dynamically | Fixed: static only |
| R2-n5 | nit | `readLive` loads `backends/workspace.js` when only Ghostty workspaces run | Accepted: the phase design dispatches through `workspaceBackendFor`; filtering on `backend === "rex"` in the generic module would hard-code a backend. The cost is one module graph load on a command that already reads every status. |
| R2-n6 | nit | No inspect exit-code test with a ports failure | Covered: the inspect output test runs a partial ports read through `handleInspectCommand` with `process.exit` stubbed to throw, so an exit 2 would fail it |
| R2-n7 | nit | A shared static claim where one claimant also runs gives two FAIL lines | Accepted: it matches D2 as the owner chose it (the static check unchanged, plus the held check) |
