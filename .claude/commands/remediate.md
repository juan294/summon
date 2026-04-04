# Remediate Pre-Launch Findings

Model tier: **sonnet** — Sonnet 4.6 (1M context) session. All subagents: `model: "sonnet"`.

Resolve all findings from the pre-launch audit. Creates GitHub issues, orchestrates parallel TDD agents in worktrees, merges sequentially, verifies CI, and reports.

## Input

If `$ARGUMENTS` is provided, use it as the report path. Otherwise, auto-detect the report at `docs/agents/pre-launch-report.md`. If no report exists, suggest running `/pre-launch` first and **STOP.**

## Step 1: Parse & Plan

Gather context before making any changes.

1. **Read the pre-launch report** completely.

2. **Extract EVERY finding** -- blockers, warnings, AND recommendations. No filtering by priority.

3. **Group related findings into work units:**
   - Findings affecting the same files go into the same work unit (prevents merge conflicts).
   - Findings in the same domain that don't overlap files may be separate units.
   - Each work unit gets: title, description, file ownership list, severity, domain label.

4. **Detect the integration branch:**
   - Check CLAUDE.md or git config for the documented default branch.
   - Fall back to `git symbolic-ref refs/remotes/origin/HEAD`.

5. **Present the work plan** to the user:

   | # | Work Unit | Domain | Severity | Files Owned | Agent |
   |---|-----------|--------|----------|-------------|-------|
   | 1 | ... | security | blocker | src/auth/*.ts | agent-1 |
   | 2 | ... | performance | warning | src/utils/*.ts | agent-2 |

   Total: N work units covering N findings. Integration branch: `<branch>`.

**STOP.** Wait for the user to review and approve the decomposition before proceeding.

## Step 2: Create Issues & Launch Agents

After user approval:

1. **Create a GitHub issue for each work unit:**

   ```bash
   gh issue create --title "[remediate] <work unit title>" \
     --body "<findings, files to modify, acceptance criteria>" \
     --label "<domain>,<severity>"
   ```

   Check that labels exist before using them. If they don't, create them or omit.

2. **Spawn a worktree agent for each work unit** (parallel, via Agent tool with `isolation: "worktree"`, `model: "sonnet"`).

   Each agent receives these instructions:

   a. Read the GitHub issue and all source files in your ownership set.

   b. **TDD: Write a failing test FIRST** that captures the finding.
      For non-testable findings (documentation, configuration, CI changes), skip directly to implementation.

   c. Implement the minimum fix to make the test pass.

   d. Run verification sequentially:

      ```bash
      $TEST_CMD; $TYPECHECK_CMD; $LINT_CMD
      ```

   e. Run `/simplify` on changed files.

   f. Run verification again (in case `/simplify` introduced changes).

   g. Commit with message: `fix: <issue-title> (#<issue-number>)`

   h. Do NOT push. The orchestrator handles all pushes.

3. **Monitor agent progress.** As agents complete, log their status (pass/fail, tests added, files modified).

## Step 3: Integration & Verification

After ALL agents complete:

1. **Review each worktree** -- verify clean commits, no uncommitted changes.

2. **Push all agent branches in one burst:**

   ```bash
   git push origin remediate/slug-1 remediate/slug-2 ... remediate/slug-N
   ```

3. **Create PRs** for each branch, linking to the corresponding issue. Check for existing PRs first:

   ```bash
   gh pr list --head remediate/<slug>
   gh pr create --head remediate/<slug> --base <integration-branch> \
     --title "fix: <title>" --body "Closes #<issue-number>"
   ```

4. **Merge PRs sequentially** to the integration branch. For each PR:

   a. Merge:

      ```bash
      gh pr merge <pr-number> --squash
      ```

   b. Pull:

      ```bash
      git pull
      ```

   c. Run full verification:

      ```bash
      $TEST_CMD; $TYPECHECK_CMD; $LINT_CMD
      ```

   d. If tests break, fix before proceeding to the next merge.

   e. Close the corresponding GitHub issue after successful merge.

5. **Run `/simplify`** on the full integrated result.

6. **Run final verification:**

   ```bash
   $TEST_CMD; $TYPECHECK_CMD; $LINT_CMD; $BUILD_CMD
   ```

7. **Push to remote. Monitor CI:**

   ```bash
   gh run list --branch <integration-branch> --limit 1 --json databaseId,conclusion,status
   ```

8. **If CI fails:**
   - Get failure logs: `gh run view <run-id> --log-failed 2>&1 | tail -200`
   - Diagnose and fix (same logic as `/fix-ci`).
   - Re-push and re-check (max 3 iterations).

## Step 4: Cleanup

1. **Remove all remediate worktrees:**

   ```bash
   git worktree list
   # For each remediate worktree:
   git worktree remove --force <path>
   ```

2. **Delete all remediate branches** (local and remote):

   ```bash
   git branch -D remediate/<slug>
   git push origin --delete remediate/<slug>
   ```

3. **Verify clean state:**

   ```bash
   git worktree list   # Should show only main worktree
   git branch          # Should show only the integration branch
   ```

## Step 5: Report

Generate a remediation report at `docs/agents/remediation-report.md`:

```markdown
# Remediation Report
> Generated on [date] | Branch: `[branch]` | [N] issues resolved
>
> Pre-launch report: `[report-path]`

## Summary
- Findings processed: [N]
- Issues created: [N]
- Issues resolved: [N]
- Tests added: [N]
- Files modified: [N]
- CI status: PASSING / FAILING

## Issues Resolved
| # | Issue | Domain | Severity | Tests Added | PR | Status |
|---|-------|--------|----------|-------------|----|--------|

## Final Verification
- [ ] All tests passing
- [ ] Typecheck clean
- [ ] Lint clean
- [ ] Build succeeds
- [ ] CI green
- [ ] /simplify final pass complete

## Remaining Items (if any)
[Items that could not be auto-fixed with explanation]
```

Present the report summary to the user.

## Rules

- **100% coverage.** Process EVERY finding -- blockers, warnings, AND recommendations. The user sets the quality bar. No filtering by priority.
- **TDD mandatory.** Each agent writes a failing test before implementing. The only exception is non-testable work (documentation, configuration, CI changes).
- **Agents do NOT push.** Only the orchestrator pushes (Central Commit Rule). Worktree agents commit locally, orchestrator batch-pushes all branches.
- **Sequential merges.** Merge PRs one at a time, test after each merge. Never merge multiple PRs simultaneously.
- **File ownership enforced.** Two agents must never modify the same file. If findings overlap files, group them into one work unit during Step 1.
- **Branch verification before every commit.** Run `git branch --show-current` and verify the result before committing (Error #33).
- **/simplify twice.** Once per agent (after their fix), once on the integrated result.
- **CI accountability.** The push is not done until CI is green. If CI fails, fix it (max 3 iterations).
- **Clean exit.** All worktrees and remediate branches must be removed before reporting.
- **Never weaken a test.** If a test fails after merge, fix the source code, not the test.
- **Check for existing PRs** before creating with `gh pr create`.
- Run verification commands sequentially, never as parallel Bash calls.
