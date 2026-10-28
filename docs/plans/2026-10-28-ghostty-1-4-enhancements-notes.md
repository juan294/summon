# Ghostty 1.4 plan decisions and review notes

Date: 2026-10-28. Scope: planning only. [Main specification](2026-10-28-ghostty-1-4-enhancements.md) and its five linked phase files are the execution contract. Baseline develop d2af8cb33be48da452c94f95b26e80482c2b5dc3; checkout chore/cc-rpi-sync-20261004 at 8ca366c62c205ffe9ab9a2105b4494a20a8c0bda. Existing dirty .rpi/manifest.json was preserved. Product code matches develop; sole committed branch divergence is .github/workflows/sutura.yml, outside scope.

## Owner decision

The owner accepted the proposed five sequential phases and compatibility policy: doctor/security diagnostics; native pane inspection/focus; hidden-monitor efficiency; title/reset/detach controls; SSH recipes/final compatibility checks. Ghostty 1.3.1 launch support remains, with warnings below recommended 1.4.0 and capability-gated new actions. No hard minimum bump, production action or cross-phase implementation continuation was requested.

## Evidence and refinements

Accepted research and assessment were read completely. Graphify plus source consumer searches were refreshed. Installed Ghostty reports 1.4.0 stable. A read-only `+show-config --no-pager --changes-only=false` probe returned effective allowlisted settings successfully; other configuration values were not printed. No product tests, native GUI actions, benchmarks or SSH connections were run during planning.

Read-only investigations resolved identity and visibility contracts. Native terminal IDs are surface-lifetime UUIDs from pinned upstream v1.4.0 ScriptTerminal.swift, distinct from numeric core IDs; record generator-owned UUIDs directly. Native arbitrary-text transport uses Foundation JSON. Visibility uses mode 2033 negotiation and 999 state replies, with visible fallback, restoration of prior state and a bounded hidden watchdog. No assumption of durable IDs across app restarts remains.

Existing focus only activates Ghostty (`src/script.ts:550`), picker ignores failure (`src/commands/project.ts:121`), and monitor Enter launches active rows (`src/monitor.ts:469`). Phase 2 explicitly covers these consumers and their failure/recovery behavior.

## Independent review dispositions

R1, pane ordering: confirmed and repaired in phase 2. Traditional names and generation order differ (`src/launcher.ts:793`; `src/script.ts:585-600`); empty sidebar is physically created but omitted by legacy name listing. One shared native inventory supplies capture order and Node mapping, includes all actual panes, and preserves legacy display fields. Explicit mixed-column/shell/empty-sidebar tests are required.

R2, native suite timing: repaired. Phase 2 creates src/e2e/ghostty-native.test.ts with distinct native off/advisory/required flags; phases 3/4 extend it and phase 5 consolidates it. Main plan states the exact required command. Native inability cannot pass by skipping.

Independent re-review confirmed both findings resolved and reported no residual blocker.

## Handoff and limits

No product implementation, configuration, dependency or remote state changed. Plan checks verify local links, whitespace, resolved markers and baseline identity only. Runtime tests and performance outcomes remain obligations for implementation. Native 1.3.1 is unmeasured; compatibility fixtures do not become native proof. Default terminal security, trusted config and escaping remain mandatory.

Main plan and phase files follow local ignore policy. This notes file is eligible for tracking via the existing *-notes.md exception; no staging or commit was performed. Preserve all artifacts before any future worktree cleanup. Next authorized step requires an implementation request, starting with phase 1 and revalidating actual refs/files/runtime. Stop after each phase unless the owner explicitly authorizes continuation; no push/publication or CI routing authority is implied.

## Implementation authorization and actual baseline

2026-10-28: owner invoked rpi-implement for all five phases without stopping, followed by merge to develop, one push and pruning the task-owned worktree. This supersedes the plan's planning-only continuation/push limitations; production release remains outside scope. Original checkout /Users/juan/code/summon on chore/cc-rpi-sync-20261004 at 8ca366c62c205ffe9ab9a2105b4494a20a8c0bda and its dirty manifest/notes are preserved.

Fresh origin/develop is 5d7a9f52c221a8e6ba2fc6106087c760a164e7ba. Task branch feat/ghostty-1-4 lives at /Users/juan/code/summon/.worktrees/ghostty-1-4, based on this fetched integration tip. Product source matches the planned baseline; intervening changes are repository tooling, instruction packages and Sutura pins. Graphify queried before consumer sweep; source search saved with operational evidence. Installed Ghostty CLI reports 1.4.0 stable. Read-only version/dictionary/actions/effective-config and Foundation JSON inventory probes succeed. No existing native terminal was changed by those probes.

## Deviations

D1: Plan said integration baseline d2af8cb; found fetched develop at 5d7a9f5; chose current integration tip because product source is unchanged and this preserves current hosted routing/tooling without modification.

### Phase 2 preparatory independent review

Read-only native_contract assignment reviewed inventory/capture/focus design, budget ten minutes, no writes/native mutation; completed. NC-1: tree names a-b/a_b and case variants alias existing AppleScript variables. Resolve with unique structural variables consistently in generation/capture; add collision fixture. NC-2: enforce capture-size validation after subprocess execution, outside rollback catch. NC-3: duplicate explicit leaf names remain legal; preserve launch but reject ambiguous native metadata rather than last-wins mapping. All three are implementation obligations before phase 2 acceptance.

## Phase 1 accepted

Candidate inputs SHA256 `b26ec2d3d7765bcf7848350e09f4b37b05004925dee72e8d705cf39d78101979` (per-file map logs/ghostty-p1-candidate.json), branch feat/ghostty-1-4, base 5d7a9f5. Author phase1 completed bounded assigned files; parent independently reviewed plan compliance and all dispositions. P1-R1 resolved: invalid effective scalar prevents all automatic writes. P1-R2 resolved: new code/tests formatted for readability. P1-R3 resolved: unavailable dictionary/action evidence fails doctor while unsupported additions remain advisory. Reuse, quality and efficiency simplify passes found no further warranted edits; no tested source inputs changed after final gates.

TDD: API missing-module red, doctor 15/16 red against original code, review regressions 2/18 red; final 2518 passed plus one opt-in syntax skip across 52 files. Initial full run had three old-contract CLI failures; corrected doctor-only assertions for preserved missing file/default-effective configuration. Final sequential typecheck/lint/build/test/coverage all exit 0. Coverage statements 97.79%, branches 93.66%, functions 98.84%, lines 98.48%; exclusions/thresholds unchanged.

Installed Ghostty 1.4.0 native CLI/dictionary/effective-config readback matches fixtures. Live built `summon doctor` exits 2 solely for preexisting port 3000 conflicts across six registered projects; installed version, capabilities, effective keys, Accessibility and commands pass. No config was written. Native old 1.3.1 remains UNAVAILABLE; fixture compatibility is covered. Raw evidence is in logs/ghostty-p1-* and bounded assignment acceptance docs/agents/ghostty-p1-dispatch.json. Next: phase 2, authorized continuation; required identity/capture/native owned-fixture checks still pending.

### Phase 2 native investigation (acceptance pending)

P1 commit is 1d8480a. P2 native attempt 1 failed before generated product scripts: zsh -f emits no OSC7, so directory-based fixture discovery could not claim ownership. OS lsof/ps mapped UUID 5BA16AE6-15C4-41CD-94F9-FFF819865F80 to PID 93762 and its exact unique temporary directory. Closed only that proven task-owned terminal; readback restored 54 terminals in one preexisting window. Evidence: logs/ghostty-p2-native-first.log and logs/ghostty-p2-native-first-cleanup.log.

Attempt 2 failed before product generation when a full read-only ownership enumeration exceeded ten seconds. Bounded count query subsequently succeeded with 54 terminals/one window, and no task-owned cwd processes remained; no app restart/quit occurred. Initial hypothesis was excessive AppleEvent round trips under host load; later bounded count queries also intermittently time out, so this cause is not established. Baselines are now durable before GUI changes; fixture ownership uses direct UUID plus OS cwd proof, and incomplete cleanup retains evidence. Computer-use app inspection is unavailable because the CUA tool rejects Ghostty for safety reasons; no alternate UI automation was used. Required native acceptance remains pending until corrected bounded probes pass.

P2 review dispositions: NC-1 resolved with collision-free structural variables (legacy readable variables retained when unique). NC-2 resolved with capture parsing outside rollback and bounded nonfatal metadata errors. NC-3 resolved with actionable duplicate-name validation before native generation. P2-R1 resolved by extracting/reusing the cheap installed dictionary capability reader; exact actions never scan effective configuration. P2-R2 resolved by discarding only the old JSON after failed replacement, preserving root-shell sidecars; if both writes and invalidation are denied, explicitly disclose that previous metadata may remain. P2-N1 resolved by anchoring generated test root bindings to recorded UUIDs and validating baseline/window membership before adopting capture IDs.

Parent independent plan-compliance review and three simplify lenses (reuse, quality, efficiency) found no additional product change needed after those repairs. Native receiver stall remains an environmental acceptance blocker, not an approved exception. A read-only sample of unchanged Ghostty PID 35869 shows its main thread in SurfaceView.setTitle / NSTimer / CFRunLoopTimerCreate / malloc freelist; Foundation-only osascript succeeds while bounded app count/ID/PID/cwd AppleEvents time out. No other user's processes were stopped, no application restart/quit occurred, and readback/OS evidence found no remaining task-owned fixture process. Owner continuation decision requested before phase 3 or integration/publication; elapsed time is not approval.

## Phase 2 local implementation preserved; acceptance BLOCKED

Base 1d8480a3124125f6b96dc487b9a3032f48ada93f; branch feat/ghostty-1-4; worktree /Users/juan/code/summon/.worktrees/ghostty-1-4. Final source/config SHA256 `73be000d588b262e4b8730b15dc6851b3bd9ef9ad681aeaa0fdf86d1b76c7aa3`; per-file identities in logs/ghostty-p2-final-candidate.json were independently compared to actual files. All Phase 2 product scope and code findings are implemented/reviewed; required native behavior is UNVERIFIED, so this is not completed phase acceptance. Phases 3–5 have not begun. No develop integration, push, production action or task-worktree cleanup has occurred. Original checkout and unrelated manifest remain preserved.

Local checks: final typecheck/lint/build exit 0; 2572 tests passed, two intentional opt-in native/syntax skips in normal suite; coverage exit 0 with statements 97.52%, branches 93.24%, functions 98.55%, lines 98.29%. Required syntax mode separately passes all five tests with no skip. Final focused monitor run passes 110 tests. Earlier formatter-displaced lint directives and missing test callback annotation failures are retained in evidence. The final annotation/arrow parentheses are erased, with identical emitted JavaScript AST hashes in logs/ghostty-p2-erasure-proof.json; full test/coverage receipts are reused only for those identical executed inputs, while final typecheck/lint/build/focused monitor were rerun. Pre-commit also checks the exact preserved source.

Required native attempt failures and environmental readbacks remain visible, not green. Latest parent bounded count query at 18:08 UTC timed out after 3.005 seconds against the unchanged running application PID. No further fixture mutation occurred after the second attempt. Native 1.3.1 remains UNAVAILABLE; fixture compatibility does not count as native proof. Raw source/gate/provider receipts remain under logs/ghostty-p2-*.

Next entry: verify actual task branch/ref/source hashes and worktree state. Continue only if the required native checks can pass, or the owner explicitly changes that acceptance requirement and authorizes the resulting scope. An asynchronous choice between retaining the gate and continuing/pushing with explicitly UNAVAILABLE native evidence remains pending; no answer has been inferred. Source preservation does not imply acceptance or publication authority beyond the original completion contract.
