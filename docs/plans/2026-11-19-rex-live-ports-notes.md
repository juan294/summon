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

## Phase 3: docs, end-to-end tests, native acceptance

**Delivered:**
- `docs/rex.md`: a new section, "Live ports".
- `README.md`: the `summon ports [--json]` row.
- `docs/release/rex-e2e-guide.md`: the C24 row and manual step M4 4.8.
- `src/rex-hermetic.test.ts`: the fake `rex` now answers `block ls`, `block call ports`, a server without the method and a slow server. Three cases:
  - a held conflict through `ports`, `ports --json`, `inspect` and `doctor` (exit 2, FAIL);
  - a server without the method (static table, the API 16 note, no ports call);
  - a slow server (the command ends at its deadline with a note, exit 0).
- `src/e2e/rex-cli.test.ts`: scenario C24, plus a `freePort` helper.
- `src/commands/runtime.ts`: held-conflict footer lines are never cut to the terminal width. C24 found the claimant cut off when the output was piped (80 columns). The cause is fixed, and a test proved it fails without the fix.

**Deviations from phase-3.md, with reasons:**
- **D-P3-1:** C24 names its projects `e2e-<id>-eleven` (the holder) and `e2e-<id>-twelve` (the claimant), in the suite's naming scheme. The claimant claims the port through `package.json` (`vite --port P`), not `env.PORT` in a trusted `.summon`, so no trust step is needed. The poll is 15 s, not 10 s; the port appeared after 0.26 s in the earlier probe.
- **D-P3-2:** M4 step 4.8 does not check the hiding of agent ports. The guide's sandbox home runs no agent, so no ephemeral port can appear there. The hiding is checked in the owner's home (native acceptance step 2).
- **D-P3-3:** the hermetic cases share state in order. Cases 2 and 3 use case 1's workspace and registration, as the suite's existing cases do.

**Independent review:** one reviewer, read-only. It ran nothing against Rex, Ghostty or osascript. Verdict: CHANGES REQUESTED.

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| R3-M1 | must-fix | Guide 4.8 expected agent ports in a sandbox that has none | Fixed: D-P3-2; the step now checks the server's own live row |
| R3-S1 | should-fix | The docs said inspect lists every port of the workspace | Fixed: inspect asks the recorded panes; `--json` has the rest |
| R3-S2 | should-fix | The 4 s limit applies to `ports` and `doctor`, not inspect | Fixed: the docs give inspect's 2 s per pane, its stop after one pane does not answer, and its `live ports:` line |
| R3-S3 | should-fix | The rule for `live` rows was wrong for held ports | Fixed: "its own project does not claim it", marked as a conflict when another project claims it |
| R3-S4 | should-fix | The hermetic case 1 lacked the doctor assertion | Fixed: `doctor` exits 2 with a FAIL line holding the held text |
| R3-S5 | should-fix | C24's doctor check was weaker than the contract | Fixed: exit 2, and the held line carries FAIL |
| R3-n | nits | The guide's 4.8 text; the minimized `server` pane; the claimant name `slice`; the truncated-reply reason; the "one line" wording | Fixed: 4.8 rewritten; the C24 row and a test comment say the pane is minimized; the slice is replaced by a length assert; the truncated reason is in the docs; the docs say "one line per reason". The flake risk on a loaded machine is accepted: the holder is read first (newest active), and the 4 s budget covers it. |

**Evidence (Phase 3 tree, Rex server preview.21 API 18, Node v24.22.3).** The logs were copied to `/Users/juan/code/summon/logs/live-ports/`, which is gitignored.

| Check | Result |
| --- | --- |
| typecheck, lint, build | exit 0 |
| `pnpm test` | 105 files, 3,947 passed, 21 skipped (the gated E2E cases, C24 now among them) |
| `pnpm test:lua` | 60 passed |
| `pnpm test:coverage` | 97.29 / 93.25 / 98.26 / 98.59, at or above the plan baseline of 97.21 / 92.92 / 98.25 / 98.57 |
| Hermetic built-CLI suite | 12 passed |
| A7 Rex CLI E2E, required mode, run 1 | 13 passed; C24 failed. The held line was cut at 80 columns when piped. The cause was fixed in `runtime.ts`, with a test that fails without the fix. |
| A7 Rex CLI E2E, required mode, run 2 (after the review fixes) | 14 of 14 passed, C24 included; cleanup verified (no `RECOVERY.json`, no `e2e-*` session, 17 sessions before and after) |
| A9 Ghostty E2E, required mode | Run 1: 23 passed, and the 2 GUI cases stopped at `summon-not-running` because Ghostty was not running. Ghostty was started for run 2: 25 of 25, nothing skipped. Ghostty was quit afterwards, since it had not been running before. |
| Native 1: `summon ports` time, owner's 17 workspaces | 0.97, 0.77, 0.77 s (median 0.77 s; target 1.5 s or less; baseline 0.57 s) |
| Native 2: agent ports hidden | 42 live ports, all ephemeral (`claude`, `codex`), all hidden; the line reads `42 ephemeral live ports hidden in 17 workspaces; summon ports --json lists them.`; JSON has all 42 with `ephemeral: true` |
| Native 3: `summon inspect summon` | `ports: 52206 127.0.0.1 (claude)` under `opus`, `52066 127.0.0.1 (codex)` under `codex`; exit 0 |
| Native 4: `summon doctor` | `PASS  No running workspace holds a port another project claims (42 live ports read)`. Exit 2 comes from the existing static claim conflict on 3000 (seven projects), the same as installed 2.1.1. |

**Not covered:**
- A server older than API 16 was not available. The fallback is covered by unit and hermetic tests only, with the preview.19 reply shape from 2026-11-17.
- More than one Rex server was never seen.
- The manual guide steps (M4 4.8) were not run by hand.

**Next:** Phase 3 is complete on `feat/rex-live-ports`. The merge to `develop` and any push need the owner's word.
