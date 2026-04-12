# Remediate Pre-Launch Findings

Model tier: **sonnet** — Sonnet 4.6 (1M context) session. All subagents:
`model: "sonnet"`.

Resolve all findings from the pre-launch audit. Creates GitHub issues,
orchestrates parallel TDD agents in worktrees, merges sequentially per
wave, verifies CI, and reports.

## Input

If `$ARGUMENTS` is provided, use it as the report path or wave selector
(e.g., `wave=2` to resume at Wave 2). Otherwise, auto-detect the report
at `docs/agents/pre-launch-report.md`. If no report exists, suggest
running `/pre-launch` first and **STOP.**

If `wave=N` is provided, skip the Step 1 STOP gate — the plan was
already approved in a prior run. Begin directly at Wave N processing.

## Step 1: Parse & Plan

Gather context before making any changes.

1. **Read the pre-launch report** completely.

   The report uses a 16-section format. Findings live in sections 4-11
   (Frontend, Backend, Performance, DevOps/SRE, Security, Architecture,
   QA, UX). Section 14 (Before/After/Later) is the wave-ordering index.
   Section 15 (Open Questions) is NOT findings — skip it.

2. **Extract EVERY finding** — all 5 severity tiers: launch-blocker,
   high, medium, low, strategic. No filtering by severity — Rule #58
   100% coverage.

   Parser contract:

   - Findings are the `#### <Finding-ID> <Title>` blocks in §4-§11.
   - Finding ID regex: `(AR|FE|BE|PE|DO|SE|QA|UX)-(B|H|M|L|S)[0-9]+`
   - Each finding has structured fields (bold format:
     `**Severity:**`, `**Time horizon:**`, `**Evidence type:**`,
     `**Files:**`, `**What's happening:**`, `**Why it matters:**`,
     `**Recommendation:**`, `**Expected impact:**`,
     `**Effort estimate:**`).
   - Parse every finding — never drop one.

3. **Group related findings into work units:**

   Grouping hierarchy:

   1. By time horizon first (Before → After → Later) using Section 14.
   2. Within each horizon: by file ownership (conflict avoidance).
   3. Within each file group: by severity descending.

   Wave 3 exception: findings in the "Later / strategic" wave (low and
   strategic severity) do NOT get grouped into work units. They use a
   "file-only" path — create issue, do not spawn worktree agent. This
   is the only exception to Rule #58: low and strategic items require
   human architectural judgment that AI agents cannot reliably provide.
   This exception is documented explicitly here and in the pre-launch
   spec.

4. **Detect the integration branch:**
   - Check CLAUDE.md or git config for the documented default branch.
   - Fall back to `git symbolic-ref refs/remotes/origin/HEAD`.

5. **Present the work plan** to the user, grouped by wave:

   **Wave 1: Before launch (must fix before release)**

   | # | Work Unit           | Domain   | Severity | Files Owned | Agent   |
   |---|---------------------|----------|----------|-------------|---------|

   **Wave 2: After launch (post-release sprint)**

   | # | Work Unit           | Domain   | Severity | Files Owned | Agent   |
   |---|---------------------|----------|----------|-------------|---------|

   **Wave 3: Later / strategic (issues only — no fix agents)**

   | # | Finding ID | Title | Severity | Rationale       |
   |---|------------|-------|----------|-----------------|

   Total: N work units covering M findings across K files.
   Wave 1: X work units. Wave 2: Y work units. Wave 3: Z issues-only.
   Integration branch: `<branch>`.

**STOP.** Wait for the user to review and approve the decomposition
before proceeding.

## Step 2: Create Issues & Launch Agents

After user approval:

1. **Create a GitHub issue for every finding** (all waves, including
   Wave 3):

   ```bash
   gh issue create \
     --title "[remediate] <finding-id> <title>" \
     --body "<evidence type>, <file refs>, <what's happening>,
   <why it matters>, <recommendation>, <expected impact>,
   <effort>, <finding ID>" \
     --label "<domain>,<severity>,<wave>"
   ```

   Label scheme:

   - Severity: `launch-blocker`, `high`, `medium`, `low`, `strategic`
   - Wave: `wave-1-before-launch`, `wave-2-after-launch`,
     `wave-3-later`
   - Domain: `architect`, `frontend`, `backend`, `performance`,
     `devops-sre`, `security`, `qa-reliability`, `ux`

   Check that labels exist before using them. If they don't, create
   them or omit.

   After all issues are created: confirm Wave 3 issue count matches
   the Wave 3 row count in the Step 1 plan table.

2. **Spawn worktree agents for Wave 1** (parallel, via Agent tool with
   `isolation: "worktree"`, `model: "sonnet"`).

   Wave 1 only — do NOT start Wave 2 agents yet.

   Each agent receives these instructions:

   a. Read the GitHub issue and all source files in your ownership set.

   b. **TDD: Write a failing test FIRST** that captures the finding.
      For non-testable findings (documentation, configuration, CI
      changes), skip directly to implementation.

   c. Implement the minimum fix to make the test pass.

   d. Run verification sequentially:

      ```bash
      $TEST_CMD; $TYPECHECK_CMD; $LINT_CMD
      ```

   e. Run `/simplify` on changed files.

   f. Run verification again (in case `/simplify` introduced changes).

   g. Commit with message: `fix: <issue-title> (#<issue-number>)`

   h. Do NOT push. The orchestrator handles all pushes.

3. **Monitor Wave 1 agent progress.** As agents complete, log their
   status (pass/fail, tests added, files modified).

4. **Wave 3 — file-only.** Issues were created in step 1. No worktree
   agents are spawned for Wave 3. Report these as "filed, not fixed"
   in Step 5.

## Step 3: Integration & Verification

Run the full push-PR-merge cycle once per wave. Complete Wave 1 before
starting Wave 2.

### Wave 1 Integration

1. **Review each Wave 1 worktree** — verify clean commits, no
   uncommitted changes.

2. **Push all Wave 1 branches in one burst:**

   ```bash
   git push origin remediate/slug-1 remediate/slug-2 ...
   ```

3. **Create PRs** for each branch, linking to the corresponding issue.
   Check for existing PRs first:

   ```bash
   gh pr list --head remediate/<slug>
   gh pr create --head remediate/<slug> \
     --base <integration-branch> \
     --title "fix: <title>" \
     --body "Closes #<issue-number>"
   ```

4. **Merge PRs sequentially** to the integration branch. For each PR:

   a. Merge: `gh pr merge <pr-number> --squash`
   b. Pull: `git pull`
   c. Run full verification: `$TEST_CMD; $TYPECHECK_CMD; $LINT_CMD`
   d. If tests break, fix before proceeding to the next merge.
   e. Close the corresponding GitHub issue after successful merge.

5. **Run `/simplify`** on the full integrated Wave 1 result.

6. **Run Wave 1 final verification:**

   ```bash
   $TEST_CMD; $TYPECHECK_CMD; $LINT_CMD; $BUILD_CMD
   ```

7. **Push to remote. Monitor CI:**

   ```bash
   gh run list --branch <integration-branch> \
     --limit 1 --json databaseId,conclusion,status
   ```

8. **If CI fails:**
   - Get failure logs:
     `gh run view <run-id> --log-failed 2>&1 | tail -200`
   - Diagnose and fix (same logic as `/fix-ci`).
   - Re-push and re-check (max 3 iterations per wave).

**STOP.** Wave 1 complete. Present Wave 1 integration results to the
user. Ask: "Proceed to Wave 2 now or defer (run `/remediate wave=2`
later)?"

### Wave 2 Integration

If user proceeds:

1. **Spawn worktree agents for Wave 2** (same pattern as Wave 1
   step 2).
2. **Monitor Wave 2 agent progress** (same pattern as Wave 1 step 3).
3. **Complete push-PR-merge cycle for Wave 2** (same steps as Wave 1).
4. **Run `/simplify`** on the full integrated Wave 2 result.
5. **Run Wave 2 final verification** (same commands as Wave 1).

**STOP.** Wave 2 complete. Confirm Wave 3 issues are filed in the
backlog. Document any deferred waves with timeline.

## Step 4: Cleanup

Remove worktrees per wave before starting the next wave.

**After Wave 1:**

1. **Remove all Wave 1 remediate worktrees:**

   ```bash
   git worktree list
   # For each Wave 1 remediate worktree:
   git worktree remove --force <path>
   ```

2. **Delete all Wave 1 remediate branches** (local and remote):

   ```bash
   git branch -D remediate/<slug>
   git push origin --delete remediate/<slug>
   ```

**After Wave 2:**

Repeat the same cleanup for Wave 2 worktrees and branches.

Wave 3 has no worktrees or branches to clean up.

**After all waves:**

Verify clean state:

```bash
git worktree list   # Should show only main worktree
git branch          # Should show only the integration branch
```

## Step 5: Report

Generate a remediation report at `docs/agents/remediation-report.md`:

```markdown
# Remediation Report
> Generated on [date] | Branch: `[branch]` | [N] findings processed
>
> Pre-launch report: `[report-path]`

## Summary
- Findings processed: [N] (Wave 1: X, Wave 2: Y, Wave 3: Z)
- Issues created: [N]
- Issues resolved (merged): [N] (Wave 1: X, Wave 2: Y)
- Issues filed only (not fixed): [Z] (Wave 3)
- Tests added: [N]
- Files modified: [N]
- CI status: PASSING / FAILING

## Wave 1: Before launch (must-fix)
| # | Finding ID | Title | Severity | Tests Added | PR | Status |
|---|------------|-------|----------|-------------|----|--------|

## Wave 2: After launch
| # | Finding ID | Title | Severity | Tests Added | PR | Status |
|---|------------|-------|----------|-------------|----|--------|

## Wave 3: Later / strategic (filed, not fixed)
| # | Finding ID | Title | Severity | Issue | Rationale       |
|---|------------|-------|----------|-------|-----------------|

## Final Verification
- [ ] Wave 1 merged, CI green
- [ ] Wave 2 merged, CI green (or explicitly deferred)
- [ ] Wave 3 issues filed in backlog
- [ ] /simplify final pass complete for waves that ran
- [ ] All worktrees and remediate branches removed

## Deferred Items (if any)
[Waves the user chose to defer with timeline]
```

Present the report summary to the user.

## Rules

- **100% coverage.** Process EVERY finding — all 5 severity tiers.
  Wave 3 low and strategic items get ISSUES but no fix agents (requires
  human architectural judgment — the one documented exception to Rule
  #58's 100% auto-fix coverage). Every finding still gets an issue.
- **Wave ordering.** Process Waves in order: 1 → 2 → 3. Never
  interleave waves.
- **Per-wave verification.** Each wave goes through the full merge →
  verify → CI-check cycle before the next wave begins.
- **User can defer waves.** After any wave, user may ship and schedule
  the next wave separately. Pass `wave=N` in `$ARGUMENTS` to resume.
- **TDD mandatory.** Each agent writes a failing test before
  implementing. The only exception is non-testable work
  (documentation, configuration, CI changes).
- **Agents do NOT push** (Central Commit Rule). Only the orchestrator
  pushes. Worktree agents commit locally, orchestrator batch-pushes.
- **Sequential merges.** Merge PRs one at a time, test after each.
  Never merge multiple PRs simultaneously.
- **File ownership enforced.** Two agents must never modify the same
  file. If findings overlap files, group them into one work unit.
- **Branch verification before every commit.** Run
  `git branch --show-current` and verify the result (Error #33).
- **/simplify twice.** Once per agent (after their fix), once on the
  integrated result per wave.
- **CI accountability.** The push is not done until CI is green. If CI
  fails, fix it (max 3 iterations per wave).
- **Clean exit.** Remove worktrees and remediate branches per wave
  before reporting.
- **Never weaken a test.** If a test fails after merge, fix the source
  code, not the test.
- **Check for existing PRs** before creating with `gh pr create`.
- Run verification commands sequentially, never as parallel Bash calls.
