# Exploratory Charter — snapshot-isolation

- Candidate: `0692dbcdd74505d8a6efba82b0039d0de7f2962a` (immutable post-merge main); baseline: `v2.1.0`; release: 2.1.1.
- Worktree: `/Users/juan/code/summon-release-2.1.1`, detached and tracked-clean before and after execution.
- Reviewer: fresh independent context, not the implementer. No product edits, native services, UI, real user configuration, network or publication.
- Capability: generation-owned snapshot persistence and isolation across two synthetic Git projects sharing one isolated HOME.
- Actors/surfaces/states: separate CLI subprocesses; save/show/clear; valid and malformed generation, superseded owner, repeated write, durable JSON and absence after clear. External seams: local filesystem and local Git only in this execution; parent-owned native terminal evidence explicitly reused below.
- Budget: five-minute bounded revalidation. No whole suites were executed here.
- Raw evidence and ownership: `logs/release-2.1.1/final-charters/snapshot-isolation/` in the primary checkout. The user’s “primarylogs” means this primary-checkout logs directory; no evidence was placed in the detached candidate.

## Risk hypothesis

A stale generation could overwrite a newer project snapshot, subprocess repetition could corrupt state, or one project could write another project's data. Invalid input could prevent subsequent valid saves. Detached snapshot survival requires native interruption evidence beyond ordinary shell exit.

Fresh identity proof (`identity.json`): candidate whole tree equals both `83b180` and `921d011`: `3a4633e6ad0df0f55ad4d7cbb477946d13faeeb4`. The candidate has no diff from `4b70c8a` over all `src/`, `scripts/`, package.json, pnpm-lock.yaml, tsup.config.ts, tsconfig.json and vitest.config.ts. Per-file SHA-256 hashes cover these tracked inputs; baseline diff/stat and commit history are retained. Thus snapshot/runtime/native test inputs are unchanged, while documentation commits and the post-merge commit identity remain distinct.

Executed the actual existing production split CLI `/Users/juan/code/summon-release-2.1.1/dist/index.js` directly through its shebang, including invocation through `/bin/bash -f` and `/bin/zsh -f`. Parent `logs/release-2.1.1/main-build.log` records its production build in that worktree. `identity.json` pins every dist file by SHA-256; the runner verifies the complete build-file hash map stays unchanged after checks. No private unsplit artifact substituted for this final CLI. Build provenance relies on the parent build receipt plus current clean source identity, not an independently repeated build.

Source contracts confirmed directly: `src/commands/runtime.ts:19` dispatches snapshots; generation checks use the record owner before writing. `src/status-record.ts:220` locks and compares ownership; `src/status-record.ts:406` validates durable records. `src/snapshot.ts:43` collects Git state and `src/snapshot.ts:80` writes the snapshot atomically. No tracing or product changes were needed.

## Maneuvers

| # | Maneuver | Result | Evidence or N/A reason |
|---:|---|---|---|
| 1 | Try the action twice | PASS | Fresh `raw.json`: generation-owned save repeated under bash and zsh for each of two projects; valid JSON, show, clear/show/repeated clear. `checks.json` records success. |
| 2 | Edit after every error | PASS | Fresh malformed launch UUID fails nonzero without changing saved bytes; correcting to the owning UUID succeeds for each project. Traversal name rejected. Previous configuration repair remains separately attributed to prior raw.log, not fresh execution. |
| 3 | Interrupt mid-flow | PASS | Reused parent native interruption evidence at 4b70c8a, with unchanged-input proof: rex-cli.log 13/13; `src/e2e/rex-cli.test.ts:417` slows Git then kills the real Rex session and checks snapshot plus sidecar removal before any status reader at :432. SI-LIMIT-1 remains CLOSED. This reviewer performed no native interruption. |
| 4 | Use a second session or role | PASS | Fresh separate CLI processes across two isolated synthetic projects in one HOME: matching directory/project/branch; opposite generation cannot change existing bytes. Fresh checks are sequential and do not claim concurrency. Reused original raw.log covers 16 concurrent detached saves (eight/project), correct final state and parseability. |
| 5 | Switch shell, locale and viewport/device | PASS | Fresh actual CLI via bash and zsh, Unicode/spaces/exclamation-mark project paths; UTF-8 and Unicode layout preserved. Node v24.22.1. Prior generated shell-trap checks are reused. Alternate locales, interactive widths and a fresh Node 22 execution are outside this bounded non-TTY charter. |
| 6 | Compare copy with outcome | PASS | Fresh raw.json records save/show/clear messages and corresponding durable state. Superseded generation exits zero silently and preserves bytes; malformed UUID fails. Clear twice accurately reports absence. |
| 7 | Read back downstream state | PASS | Fresh durable JSON assertions check schema version 1, exact project/directory, fixture-main branch, dirty.txt and mode 0600 for both projects. Clear leaves no snapshot. No tmp/pid/active residue. cleanup.json records full pre-removal inventory and verified removal. |
| 8 | Ask should this exist | PASS | Fresh opposite-owner write is rejected silently without changing prior bytes; malformed generation cannot alter data; traversal name fails and no escaped snapshot exists. Trust/install/doctor-fix never invoked. |

## Findings

No confirmed product defect in exercised scope. Fresh bounded checks PASS for both projects; runner exit 0. SI-LIMIT-1 remains CLOSED for snapshot-isolation through valid parent native evidence, not through a newly executed final-SHA native suite. No new external issue or product fix is warranted by these observations.

Prior evidence reviewed: `logs/release-2.1.1/charters/snapshot-isolation/report.md`, raw.log, checks.json, cleanup.json, runtime-source-identity.json and native-evidence-review.json. The prior report's prepromotion/PENDING wording remains its historical scope; this report adds fresh post-merge identity and small CLI execution rather than rewriting old execution identity.

`native-reuse.json` freshly verifies every SHA-256 in the prior native review: rex-cli.log (13), rex-native.log (2), rex-lifecycle.log (2), ghostty-native.log (25), the earlier failed Ghostty log and rex-inventory-disposition.json. All match. Parent native coverage is 17 Rex and 25 Ghostty passes at the preparation inputs, reused by byte-equivalence. The Rex CLI snapshot-before-reconciliation assertion is decisive for SI-LIMIT-1; general Ghostty passes are not presented as a Ghostty snapshot-kill oracle. The earlier Ghostty evidence-directory failure (2 failed/23 passed) remains preserved; the subsequent 25/25 result does not erase it. Parent before/after Rex inventory preserves the same 12 IDs; this reviewer did not operate those sessions.

Parent final-main evidence: main-release-probes.log reports fresh 82/82 PASS, and published-main-ci.json binds successful CI to this exact SHA. The coordinator additionally confirms exact-SHA CI and CodeQL PASS in this conversation. These are parent-owned results, not tests or network verification performed here. No hosted-native coverage is inferred from CI skips. Candidate deployment/publication verification occurs later with the release coordinator; this report does not attest a published package, deploy, provenance or the overall release analyzer.

## Skipped high-risk areas

No high-risk snapshot-isolation maneuver remains undisposed: native interruption and detached shell concurrency use the valid unchanged-input parent/original evidence above. Fresh checks do not claim every concurrent write was delivered, continuous atomicity observation, arbitrary SIGKILL/host failure recovery, Ghostty-specific snapshot-kill survival, on-stop hook interruption or symlink-upgrade behavior. These are scope limits, not new successes inferred from general suite counts. Real Rex/Ghostty operations are expressly out of scope for this reviewer.

## Fixtures and cleanup

`ownership.json` was persisted before fixture allocation, with exact root, HOME, project paths, owner, disposable classification and intended exact teardown. After creation it records the allocated inode. Synthetic projects summon-rel-final-alpha and summon-rel-final-beta share only that isolated HOME; process environment is constructed explicitly (HOME confined to the fixture; Git global configuration /dev/null). No user configuration was read by the CLI. No Docker, databases, services, native sessions or windows were allocated.

All CLI children were synchronous, bounded by 15-second per-command timeouts and awaited. Before teardown, the root inode and candidate owner marker were rechecked. cleanup.json lists the owned inventory and confirms removed=true, allOwnedChildrenAwaited=true, retainedFixtures=[]. Only the exact recorded root was removed. Candidate tracked status remains clean and all dist hashes unchanged. Retained material consists only of authorized report and raw ownership/log evidence; no fixture or cleanup failure remains.

## Charter decision

PASS — final fixed-candidate snapshot-isolation revalidation for `0692dbcdd74505d8a6efba82b0039d0de7f2962a`, within the explicitly bounded scope. All eight maneuvers have fresh evidence or explicitly attributed valid unchanged-input reuse. SI-LIMIT-1 CLOSED; no new confirmed findings; cleanup PASS. This charter is ready for the parent's tag-gate aggregation; it does not itself authorize tagging or publication, alter the manifest, or declare the overall release gate passed.
