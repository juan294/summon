# Exploratory Charter — background-config

- Requested version: **2.1.1**; baseline: **v2.1.0**.
- Immutable POST-MERGE candidate: **0692dbcdd74505d8a6efba82b0039d0de7f2962a**.
- Checkout: `/Users/juan/code/summon-release-2.1.1`, detached HEAD, clean tracked tree verified before and after current execution.
- Executor: fresh independent context; did not implement the change. Final revalidation timebox: five minutes.
- Capability: Rex background classification, configuration recovery, dry-run documentation and state isolation.
- Actors/surfaces: CLI user, built `dist/index.js`, synthetic custom layout and machine config, captured stdout/stderr and isolated HOME inventory.
- Authorization: bounded local CLI dry-run only; no product edits, whole suites, network, publication, real services, user config or native UI changes.

## Risk hypothesis

Invalid background settings could silently select an unexpected plan, explicit false could fail to override detection, repeated previews could publish launch state, or corrected documentation could still contradict executed observations.

## Candidate and evidence identity

`identity.json` records Git object checks: the entire candidate tree equals both `83b180` and `921d011`, tree `3a4633e6ad0df0f55ad4d7cbb477946d13faeeb4`. The complete tracked diff from `4b70c8a` to this final SHA contains only `docs/rex.md`; therefore all runtime sources, package/lock/build inputs and tests are unchanged. Package version is 2.1.1. All **86** embedded source-map sources independently match the final checkout with zero mismatches; complete built-artifact SHA-256 values are retained. The current probes execute this final checkout's existing built CLI, without rebuilding.

Final `docs/rex.md` SHA-256 `d7f548ff3a822e5998f716ccdac87363bbbd570d5d0db429918a9e0a97ba42e3` equals the independently reviewed correction in original `documentation-review.json`. At `docs/rex.md:57`, warnings are explicitly limited to a Rex launch, while dry-run silently ignores an invalid value and shows the resulting plan. At `docs/rex.md:59`, protected-pane notices are limited to a Rex launch. Those claims match original executed `invalid-value`, `root-protected` and `empty-protected` observations; no unexecuted native-warning claim is inferred from previews.

Historical execution remains attributed to **4b70c8ade51d3d35d0b4b1701cb3790c9ff78985**, not relabeled as final-SHA execution. `reuse-validation.json` records independent raw-label/oracle checks; `identity.json` hashes every original report, receipt and raw file. Original `checks.json` remains **33 passing, one historical failing warning oracle**. Only the copy oracle changes under the verified corrected documentation contract. Original `raw.json` used a wrong layout filename and is retained as harness-error evidence, never classification evidence; corrected `raw-2.json` supplies the reused observations.

Raw evidence directory: `/Users/juan/code/summon/logs/release-2.1.1/final-charters/background-config/`. Original directory: `/Users/juan/code/summon/logs/release-2.1.1/charters/background-config/`.

## Maneuvers

| # | Maneuver | Result | Evidence or N/A reason |
|---:|---|---|---|
| 1 | Try the action twice | PASS | CURRENT `current-raw.json`: explicit-false-recovery and explicit-false-repeat both exit 0, keep worker visible and leave file hashes unchanged. REUSE raw-2 auto-first/auto-repeat both plan worker minimization. No native duplicate-pane claim. |
| 2 | Edit after every error | PASS | CURRENT invalid-silent-fallback exits 0 and plans worker minimization without an invalid-value warning; changing the same layout value to false exits 0 and keeps worker visible. REUSE broken-tree exits 1 then repaired-tree exits 0; invalid auto-resize exits 1 then set-repair exits 0 and readback confirms true. |
| 3 | Interrupt mid-flow | PASS | VALIDATED REUSE interrupt-output confirms live process before SIGINT, exit -2 after partial output; after-interrupt exits 0. Final inventory has no runtime residue. Preview interruption only; no native-launch interruption claim. |
| 4 | Use a second session or role | PASS | VALIDATED REUSE concurrent-0/concurrent-1 are recorded simultaneously started CLI previews sharing synthetic HOME; both exit 0 and minimize worker in the plan. No real-session or native launch-lock concurrency claim. |
| 5 | Switch locale and viewport/device | PASS | VALIDATED REUSE bash-C-narrow and zsh-UTF8-wide both exit 0 under bash/zsh, C/UTF-8, columns 20/120 and lines 8/40; Unicode command/cwd survive. Applies to non-TTY CLI output; alternate Node versions and TUI truncation are not claimed. |
| 6 | Compare copy with outcome | PASS | CURRENT silent invalid fallback and explicit false match final docs/rex.md:57. Independently verified final doc hash equals reviewed correction. REUSE protected root/empty preview omissions match launch-only notice wording at docs/rex.md:59. BG-01 resolved by documentation. |
| 7 | Read back downstream state | PASS | CURRENT every before/after inventory is equal; no forbidden backend calls; final inventory has no tmp/pid/active/lock residue. Exact owned HOME removed after token/inode checks. VALIDATED REUSE original final inventory and both cleanup receipts. No launch schema record is expected for a dry-run. |
| 8 | Ask "should this exist?" | PASS | VALIDATED REUSE pipeline/help/detached remain visible, true minimizes printf, false overrides pnpm dev, root and commandless worker remain protected, typo key does not execute a command. CURRENT false override reconfirmed. Generated commands remain captured data and were never executed. |

## Findings

**BG-01 — RESOLVED BY DOCUMENTATION (low severity).** Original FAIL: invalid `pane.worker.background=banana` silently fell back in dry-run although old docs promised a warning. Original reproduction, FAIL table and raw oracle remain preserved in `report-original.md`, `report.md`, `checks.json` and `raw-2.json`. The final contract explicitly documents this preview behavior, with an exact match to the earlier reviewed correction. Current final-built-CLI observation independently reconfirms silent fallback and successful explicit-false recovery/repeat. No product fix or exception is needed for the chosen documented behavior. No new finding or unresolved charter blocker.

## Skipped high-risk areas

No new native execution was authorized or performed. Real capsule display, restore/focus, native launch interruption/concurrency, alternate Node versions and TUI rendering are outside this bounded background-config preview charter; they are not converted into passes here. Native evidence is supplied separately by the parent and reused only for unchanged inputs.

Read-only corroboration of existing logs: `rex-native.log` 2/2 + `rex-lifecycle.log` 2/2 + `rex-cli.log` 13/13 = **17/17**, with CLI log explicitly naming 4b70c8a; `native-gates.json` records three exits 0. `ghostty-native.log` records **25/25**. `rex-inventory-disposition.json` preserves identical before/after session sets with empty missing/added arrays. Real capsule UI evidence/cleanup is recorded in `rex-visual-ownership.json` at **83b180**. Real Ghostty cadence ownership names **921d011**; `ghostty-cadence-e2e.log` records **25 passed, 17 skipped**, not 42 passes. Those executions stay attributed to their original inputs, supported by the equality proof above, and were not rerun by this executor.

Parent exact-main coverage remains separate: `main-release-probes.log` records **82 fresh passes** and parent confirms final candidate binding. Cached `published-main-ci.json` names exact 0692dbcdd74505d8a6efba82b0039d0de7f2962a, CI run 42346703088 and CodeQL run 42346703123, both completed/success; the owner confirms both now PASS. This executor did not query the network or independently rerun those suites. This scoped charter does not replace the overall release analyzer, native cadence gate or tag authorization.

## Fixtures and cleanup

Inline isolated-HOME/project/subprocess/inventory/cleanup harness follows `src/release/helpers.ts:106` without importing Vitest or starting suites. The environment is replaced, not inherited; HOME/XDG/TMPDIR are synthetic and TERM_PROGRAM=rex. Deny-and-log shims for rex, osascript, open and package installers prevent accidental PATH-native execution. No services, databases or Docker daemon were allocated or contacted.

`ownership.json` was written **before allocation**, with exact root, disposable scope, owner, process, workdir and intended teardown. Fixture ID: `summon-rel-final-background-59b06736cd0c4869bc6cb869de6cc744`. Root: `/tmp/summon-rel-final-background-59b06736cd0c4869bc6cb869de6cc744`. All three synchronous children exited. Before teardown the recorded inode and owner token were verified; only that exact root was removed. Receipt confirms removed=true and cleanup timestamp. `final-inventory.json` records no forbidden calls and no runtime residue. No fixture retained; no cleanup failure. Evidence/logs intentionally remain outside the deleted fixture.

## Charter decision

**PASS — all eight scoped maneuvers PASS**, with three current final-built-CLI checks and explicit validated reuse for unchanged runtime inputs. BG-01 is resolved by the final documentation contract. Cleanup verified; candidate remains detached and clean. Suitable as the background-config charter input to the parent's tag gate for requested version 2.1.1; this is not overall release approval or publication authorization.
