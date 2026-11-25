# Exploratory charter for Rex launch and recovery

**BLOCKED.** On Rex preview.21 and preview.23, a project with a 14-character name and a root pane named `editor` reported ready while its root command never ran. The worker ran. The root had no receipt for recovery.

The candidate was post-merge commit `2cf312f814c2cdb68c1b5a136d361cbe3482382a`. The comparison baseline was v2.2.0 (`8ad08f0941ef975b924f63bd69872e3f8baa7e89`). The charter exercised the built CLI in the candidate worktree. Its entry file had SHA-256 `dbf296d0ba7a6344aef6ea6edc6a24dd4199101e525a6646127741ec7ca6e3af`. The independent executor had a 30-minute timebox. The project overlay was `.rpi/project/rpi-explore-release.md`, with no declared overrides.

## Risk hypothesis

When a project starts, the root pane must run its command and record the server session and block that own it. A lost create reply, a later retry, a root pane exit or more than one connected app could cause a user to lose a workspace, open a duplicate or close another tab. Tests used the public CLI, real private Rex sessions and isolated filesystem state. The simulated app clients recorded which client received each selection request.

## Maneuvers

| # | Maneuver | Result | Evidence |
|---:|---|---|---|
| 1 | Try the action twice | PASS | A short-name launch followed by two more invocations kept one native session, the same launch ID and two identical block IDs on both versions. The repeat reported a switch. |
| 2 | Edit after every error | FAIL | An invalid layout exited 1 without creating a session. After correction, both commands ran and both receipts matched Rex. Dropping the successful native create reply and delaying the zsh startup also recovered the original session on the short-name controls. With the longer alias on preview.23, a second invocation could not adopt the created session because its root receipt was missing (RR-01). |
| 3 | Interrupt mid-flow | PASS | SIGINT after native create interrupted the CLI. A retry adopted the original short-name session on both versions. Its PID and active files belonged to that live launch. The next explicit fresh launch reclaimed the dead owner's launch lock. Ctrl-C at the shell-command confirmation exited 130 without a new session or transient file. |
| 4 | Use a second session or role | PASS | Two simultaneous invocations against a fresh short-name project produced one create and one switch. The record and the private server agreed on one session and two blocks. A launch from a real bare Rex tab selected the simulated app attached to the caller despite a newer candidate app. Rex closed the bare launcher. With a second pane in the launching tab, both blocks survived. |
| 5 | Switch runtime and terminal context | PASS | Bash with Node 22.12.0, C locale and 24 columns, and zsh with Node 24.22.3, UTF-8 locale and 160 columns, both switched to the same recorded session. The length failure reproduced separately on Rex API revisions 18 and 19. |
| 6 | Compare copy with outcome | FAIL | For every failing length in the boundary table, Summon exited 0 and printed “ready in Rex.” The native capture stopped inside an unfinished shell command, the root receipt was absent and only the worker's command marker existed (RR-01). |
| 7 | Read back downstream state | FAIL | Successful short-name controls had version 1 in both status and manifest. Each pane's two-line receipt matched the server session and its exact native block. Both receipts survived a real root shell exit with a surviving sibling. Preview.23 recovered a legacy blank-session receipt while its root was alive. When the root had closed, both versions preserved that legacy receipt and explained why it could not be adopted. Longer aliases had a native root block and status record but no root receipt (RR-01). |
| 8 | Challenge unsafe behavior | PASS | A permission-denied worker directory never ran the worker command in the fallback home. Preview.21 rejected creation. Preview.23 started the valid sibling and showed the diagnostic in the affected pane. The verified split-launcher case also preserved its sibling. |

## Findings

**RR-01 (S1). A normal Rex launch can silently omit the root pane's command and prevent recovery.** A short, valid change to a project alias reproduced the failure. Both the receipt and the independently written command marker disappeared. This breaks workspace launch even when the caller receives a successful create reply.

To reproduce, use an isolated home and a private Rex preview.21 or preview.23 endpoint on macOS. Register a project as `rc-xxxxxxxxxx` (13 characters). Configure two panes named `editor` and `worker`, each with a safe command that records its working directory to its own file. Run the named layout. Register an otherwise equivalent project as `rc-xxxxxxxxxxx` (14 characters) and repeat. Read the two command markers, pane receipts, native terminal capture and the generated `session.create` request.

| Project name length | Bytes before first newline in root input | Root receipt and command marker, preview.21 | Root receipt and command marker, preview.23 |
|---:|---:|---|---|
| 12 | 1,016 | Present | Present |
| 13 | 1,023 | Present | Present |
| 14 | 1,030 | Absent | Absent |
| 15 | 1,037 | Absent | Absent |
| 20 | 1,072 | Absent | Absent |
| 25 | 1,107 | Absent | Absent |

Every listed launch exited 0 and ran the worker. For the 25-character preview.23 case, the root was still missing after the 12-second receipt wait. With the successful create reply suppressed, the CLI timed out after its eight-second recovery window, and a later launch still lacked the root receipt. In the 14-character case the root terminal stopped mid-path. The candidate constructs the first physical line by joining the root bootstrap with the receipt writer at `src/backends/rex/layout.ts:168`. The added fallback lookup and receipt command are at `src/launch-identity.ts:206`. The measured boundary applies to the tested root pane name and shell. The exact Rex or terminal-driver mechanism was not established.

## Skipped high-risk areas

None within the assigned recovery scope. Native app-client registration and visual focus used a simulated client transport. The chosen client ID was recorded, and launcher closure and split protection were checked against the real private server. The user’s running app and sessions were outside the charter.

## Fixtures and cleanup

All five disposable fixture roots were removed, including their homes and socket paths. The runner checked the owning PID and endpoint, enumerated the private sessions, closed them, waited for an empty inventory, stopped its server and checked that fixture snapshot writers were gone. Only one server ran at a time.

| Fixture | Rex version | Server PID | Teardown |
|---|---|---:|---|
| `summon-rel-r23-519` | preview.23 | 64836 | Removed |
| `summon-rel-r23-efb` | preview.23 | 22527 | Removed |
| `summon-rel-r21-729` | preview.21 | 13003 | Removed |
| `summon-rel-r23-55f` | preview.23 | 68626 | Removed |
| `summon-rel-r21-301` | preview.21 | 93789 | Removed |

Raw evidence is in the release coordinator's local `docs/agents/release-v2.2.1/` folder. The length sweep and targeted results are in `rex-target-21.jsonl` and `rex-target-23.jsonl`. The short-name recovery results are in `rex-control-21.jsonl` and `rex-control-23.jsonl`. The original longer-name observations are in `rex-charter-23.jsonl`. The command captures, native create payloads and `resource-ownership.txt` are alongside them. The initial harness used an incorrect split-response field and treated a recoverable dead-owner lock as permanent residue. Targeted checks read the actual split block IDs and verified reacquisition of the lock. A first prompt probe timed out. Subsequent PTY probes observed exit 130 on both versions.

## Charter decision

**BLOCKED** by RR-01. Repair the root bootstrap and recheck the failing lengths, both pane receipts, real command markers and dropped-reply adoption on both Rex versions before accepting a replacement candidate.
