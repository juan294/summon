# Exploratory charter for Rex pane working directories

Candidate `2cf312f814c2cdb68c1b5a136d361cbe3482382a` (v2.2.1), compared with v2.2.0 at `8ad08f0941ef975b924f63bd69872e3f8baa7e89`. A fresh directory-charter executor ran this 30-minute charter on macOS. The tested CLI entry had SHA-256 `dbf296d0ba7a6344aef6ea6edc6a24dd4199101e525a6646127741ec7ca6e3af`.

## Risk hypothesis

A user starts a two-pane Rex workspace whose directory was renamed, deleted or made inaccessible. Rex may start the shell in the user's home. The candidate must show the directory error and skip both clearing the terminal and running either command in the pane. A valid directory, including one with an apostrophe, spaces and an accented character, should let the entire command run there.

The built CLI exported its Rex request through `--dry-run` after trusting a synthetic project configuration. Real shells started in an isolated home and received the generated `initial_input`. The fixture command recorded each invocation and its physical working directory. A separate fixture recorded calls to `clear`. Two independent preview processes exercised the same project. The terminal provider and workspace deduplication are outside this request-to-shell charter.

## Maneuvers

| # | Maneuver | Result | Evidence |
|---:|---|---|---|
| 1 | Try the action twice | PASS | In Bash and zsh each replay ran the secondary pane's two commands exactly once apiece. Both reported the configured directory, with one clear per replay. Fish repeated this result after the directory was restored. |
| 2 | Edit after every error | PASS | A missing directory, ordinary file, broken symlink and directory without search permission produced a directory error and zero commands or clears in Bash and zsh. Editing the pane configuration to point to the valid directory and trusting it again ran both commands. Restoring a directory after request generation also recovered in all three shells. |
| 3 | Interrupt mid-flow | PASS | On 32-column interactive Bash and zsh terminals, Ctrl-C during the incomplete command group ran neither marker. Re-entering the complete request ran both once in the configured directory. No temporary, PID or active sidecars remained at readback. |
| 4 | Use a second session or role | PASS | Two concurrent candidate invocations created separate request IDs for the same fixture. Their Bash and zsh processes each recorded the same correct directory twice and wrote their own block receipts. |
| 5 | Switch execution context | FAIL | Bash and zsh passed with requests from Node 22.12.0 and 24.22.3, under C and en_US.UTF-8. The secondary pane also passed in a real interactive Fish 4.9.3 login shell. The Fish root pane could not execute its generated startup input (F1). |
| 6 | Compare copy with outcome | FAIL | The missing-directory promise at `docs/rex.md:26` matched actual diagnostics in Bash, zsh and the Fish secondary pane. The promise that the command runs after entering an accessible directory did not hold for the Fish root pane (F1). |
| 7 | Read back downstream state | FAIL | Bash and zsh produced 20 two-line pane receipts in the completed run, including root receipts. Both command markers always agreed on the physical directory. Fish produced secondary receipts but no root receipt (F1). |
| 8 | Challenge wrong-directory execution | PASS | Moving the requested directory after request generation made all three shells skip the secondary pane's entire compound command and preserved the error. Removing the root project's path also suppressed its command in both Bash and zsh. No marker ran in the fallback home. |

## Findings

**F1 (S3). A Fish root pane cannot initialize.** Configure a root pane with an accessible working directory and a harmless marker command. Set `SHELL` to Fish and feed the root's generated `initial_input` to an interactive Fish 4.9.3 login shell. The root produced no marker, no clear and no root receipt. The same candidate, layout and directory ran correctly under Bash and zsh. Fish's native syntax checker returned 127 for each of the two generated setup lines. It rejected `$$` in the bootstrap (`src/launch-identity.ts:199`) and the POSIX function definition in the cleanup trap (`src/launch-identity.ts:274`). It accepted the subsequent guarded Fish command group with exit 0. The Fish secondary pane completed both marker commands in the correct directory and printed a visible diagnostic for the missing directory.

Both incompatible startup constructs were present in the v2.2.0 source. The release candidate still emits them before the Fish command group (`src/backends/rex/layout.ts:168`). The verified workaround is to start Summon with `SHELL=/bin/zsh` or `SHELL=/bin/bash`. No code was changed during this charter.

## Skipped high-risk areas

None within the directory-change and shell-execution scope. Native Rex session creation, restart recovery and app focus require separate evidence. The Rex sentinel recorded zero calls. The charter used real shell processes and actual candidate request text.

## Fixtures and cleanup

The release harness allocated six homes under `makeIsolatedHome()`, including the exploratory driver runs. Their IDs were `summon-rel-dir221-3bdcb5d7-1`, `summon-rel-dir221-f550cc1e-1`, `summon-rel-dir221-1132e5eb-1`, `summon-rel-dir221-55df7bd6-1`, `summon-rel-dir221-fish-3c141299-1` and `summon-rel-dir221-fish-a5ae05c4-1`. Before removal, the harness rechecked device and inode, and found no process with an open file in each home. Every recorded path was absent at final readback. The stage-owned Fish binary was a read-only input supplied by the release coordinator.

The local evidence directory `docs/agents/release-v2.2.1/dir-charter/` contains `observations.jsonl`, `lifecycle.jsonl`, the exported requests, Fish terminal transcripts and both completed harness logs. Project overlay `.rpi/project/rpi-explore-release.md` applied with no declared overrides.

## Charter decision

**BLOCKED pending disposition of F1.** No S1 or S2 finding. Before tagging, the charter requires a verified repair or owner approval to record F1 as an S3 known issue with its workaround.
