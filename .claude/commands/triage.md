# Triage Agent Reports

Model tier: **sonnet** — Sonnet 4.6 (1M context) session.

Process all overnight agent reports and the Dependabot PR queue. Discovers every report using timestamp-based discovery, checks for agent failures, scans open Dependabot PRs (Rule #72), synthesizes findings, proposes an action plan, implements all fixes, and merges the Dependabot PRs that are safe to auto-merge. Report commit policy depends on repo visibility: public repos keep reports local, private repos commit them as historical artifacts (Rule #70).

## Input

If `$ARGUMENTS` is provided, process only the specified report path(s). Otherwise, auto-discover all new/modified reports in `docs/agents/`. If no reports found and no agent failures detected, report "all clear" and **STOP.**

## Step 1: Discovery

Find EVERY report and agent failure. No assumptions about which agents ran or how many reports exist. Discovery uses file timestamps, not git status (Rule #71).

1. **Timestamp-based scan:**

   a. Check for the `.last-triage` marker:

      ```bash
      ls -la docs/agents/.last-triage 2>/dev/null
      ```

   b. If marker exists -- find reports modified since last triage:

      ```bash
      find docs/agents/ -name "*-report.md" -newer docs/agents/.last-triage
      ```

   c. If NO marker exists (first run) -- process ALL reports:

      ```
      Glob docs/agents/*-report.md
      ```

   d. Full inventory (for cross-reference and completeness):

      ```
      Glob docs/agents/*.md
      ```

2. **Check for agent failures:**

   Scan `logs/` for recent error logs:

   ```bash
   find logs/ -name "*.error.log" -mtime -1 2>/dev/null
   ```

   For each error log modified in the last 24 hours:
   - Read the last 50 lines.
   - Determine if the agent failed (non-zero exit, FATAL, crash).
   - If an agent failed but has no corresponding report in `docs/agents/`,
     flag it: "agent-name FAILED to produce a report -- check `logs/agent-name.error.log`"

3. **Check for open Dependabot PRs (Rule #72):**

   ```bash
   gh pr list --author "app/dependabot" \
     --json number,title,headRefName,mergeable,mergeStateStatus,statusCheckRollup,labels
   ```

   For each PR, classify the update type from the title (e.g., `Bump foo from 1.2.3 to 1.2.4` -> patch; `1.2.x -> 1.3.0` -> minor; `1.x -> 2.0.0` -> major) and the CI status:

   - **patch + CI green** -> ready-to-merge (auto)
   - **minor + CI green** -> ready-to-merge (auto)
   - **major** -> defer, human review required (regardless of CI)
   - **CI red, fix looks obvious** (e.g., snapshot/lockfile drift) -> attempt-fix
   - **CI red, not obvious** -> defer, note in report
   - **Mergeable conflict** -> attempt rebase via `gh pr update-branch`; if still conflicting, defer

4. **Classify files:**
   - New/modified reports (newer than `.last-triage`): primary triage targets.
   - `shared-context.md`: read for cross-agent intelligence, not a report itself.
   - Unchanged reports (older than `.last-triage`): skip -- already processed.

5. **Present discovery results:**

   Agent Failures (if any):

   | Agent | Status | Error Log | Last Line |
   |-------|--------|-----------|-----------|

   Reports to Process:

   | # | Report File | Modified | Size |
   |---|-------------|----------|------|

   Dependabot PRs (if any):

   | # | PR | Update Type | CI | Disposition |
   |---|----|----|----|----|

   Total: N reports to process, M agent failures detected, K Dependabot PRs (auto-merge: A, attempt-fix: F, defer: D).

   Do NOT stop here -- proceed directly to analysis unless there are ZERO reports, ZERO failures, AND ZERO Dependabot PRs (in which case report "all clear" and **STOP**).

## Step 2: Analyze

Read-only. Do not modify any files.

1. **Read `shared-context.md`** for cross-agent intelligence and patterns.

2. **Read EVERY report** from the discovery list. Completely. No skimming.

3. **For each report, extract:**
   - Status: GREEN / YELLOW / RED
   - Key findings (bullet points)
   - Metrics (numbers, trends)
   - Action items (what needs fixing)
   - Carried items (persistent across multiple cycles)

4. **Synthesize across all reports:**
   - Cross-reference findings (e.g., coverage report flags X needs tests, code quality report flags X has lint issues -- group them).
   - Identify patterns (multiple agents flagging the same area).
   - Check shared-context.md recommendations against report findings.

5. **Draft the action plan:**

   Group action items by report. Include ALL items -- fix everything (Rule #58). For each item: what to do, which files, expected outcome.

   ```markdown
   ## Action Plan

   ### From [report-name] (STATUS)
   1. [Action item with specific files and expected outcome]
   2. [Action item...]

   ### From [report-name] (STATUS)
   3. [Action item...]

   ### Dependabot PRs (Step 5)
   - Auto-merge: PR #X (patch), PR #Y (minor)
   - Attempt-fix: PR #Z (snapshot drift)
   - Defer: PR #W (major bump)

   Total: N action items across M reports. K Dependabot PRs to process.
   ```

6. **Present the briefing and action plan to the user.**

**STOP.** Wait for the user to review and approve the action plan.

## Step 3: Execute

After user approval, implement all action items.

1. **Implement fixes** following TDD where applicable:
   - Test coverage gaps: write the tests.
   - Code quality issues: fix the code.
   - Security findings: apply the fix.
   - Dependency updates: update and verify.
   - Documentation gaps: update the docs.
   - Configuration issues: fix the config.

2. **Run verification sequentially:**

   ```bash
   $TEST_CMD; $TYPECHECK_CMD; $LINT_CMD
   ```

3. **Run `/simplify`** on all changed files.

4. **Run verification again** (in case `/simplify` introduced changes).

## Step 4: Commit & Push

Commit policy depends on repo visibility (Rule #70). Determine visibility before staging:

```bash
gh repo view --json visibility --jq '.visibility' 2>/dev/null
# PUBLIC -> commit code fixes only (reports gitignored)
# PRIVATE / INTERNAL -> commit code fixes AND reports
# (no remote / gh unavailable) -> treat as PUBLIC (fail-safe)
```

1. **Append triage entry to shared-context.md:**

   ```markdown
   <!-- ENTRY:START agent=triage timestamp=ISO -->
   ## Triage -- YYYY-MM-DD
   - **Reports processed**: N
   - **Action items resolved**: M
   - **Summary**: [1-line summary of what was fixed]
   **Cross-agent recommendations:**
   - [Agent]: recommendation based on triage findings
   <!-- ENTRY:END -->
   ```

2. **Commit changes:**

   On a **public repo** (or no remote), commit code fixes only:

   ```bash
   git add <changed-files>
   git commit -m "fix: resolve agent report findings [triage]"
   ```

   `docs/agents/`, `logs/`, and `scripts/agents/` are gitignored — do NOT `git add` anything in them.

   On a **private repo**, commit code fixes and reports together:

   ```bash
   git add <changed-files> docs/agents/ logs/ scripts/agents/
   git commit -m "fix: resolve agent report findings [triage]"
   ```

3. **Push to remote. Monitor CI:**

   ```bash
   git push
   gh run list --branch $(git branch --show-current) --limit 1 \
     --json databaseId,conclusion,status
   ```

4. **If CI fails:** diagnose and fix (same logic as `/fix-ci`, max 3 iterations).

5. **Touch the triage marker** (marks all current reports as processed):

   ```bash
   touch docs/agents/.last-triage
   ```

## Step 5: Process Dependabot PRs

After the triage commit is pushed and green, process the Dependabot PRs identified in Step 1.3 (Rule #72). These are independent commits from the triage code fixes -- handle them last so a flaky dependency PR can't block triage.

For each PR by disposition:

1. **auto-merge (patch + CI green, minor + CI green):**

   ```bash
   gh pr merge <num> --squash --auto --delete-branch
   ```

   `--auto` waits for required checks; `--delete-branch` keeps the remote tidy.

2. **attempt-fix (CI red, fix obvious — e.g., snapshot/lockfile drift, generated file out of date):**

   - Check out the PR locally: `gh pr checkout <num>`
   - Regenerate the affected file (run the project's update script, regenerate snapshots, etc.)
   - Push the fix to the PR branch
   - If CI goes green, queue the auto-merge as in step 1
   - One attempt only -- if it doesn't go green, defer

3. **defer (major, non-obvious CI failures, conflicts after rebase):**

   - Add a comment summarizing why it's deferred (e.g., "Major version bump -- requires human review of breaking changes")
   - Leave the PR open
   - Note in the triage report's deferred-PRs section

4. **Mergeable conflicts (before classifying as defer):**

   ```bash
   gh pr update-branch <num>
   ```

   If the rebase resolves the conflict and CI is green, proceed with auto-merge. Otherwise, defer.

Switch back to the triage branch (`main` or wherever the session started) before continuing to the report step.

## Step 6: Report

Generate a triage report at `docs/agents/triage-report.md`:

```markdown
# Triage Report
> Generated on [date] | [N] reports processed | [M] action items | [K] Dependabot PRs

## Agent Failures
| Agent | Error | Log File |
|-------|-------|----------|
(or "None -- all agents ran successfully")

## Reports Reviewed
| # | Report | Agent | Status | Action Items |
|---|--------|-------|--------|--------------|

## Overall Status: GREEN / YELLOW / RED

## Action Items Completed
| # | Item | Source Report | Tests Added | Status |
|---|------|--------------|-------------|--------|

## Dependabot PRs
| # | PR | Update Type | Disposition | Notes |
|---|----|----|----|----|
(or "None -- no open Dependabot PRs")

## Verification
- [ ] All tests passing
- [ ] Typecheck clean
- [ ] Lint clean
- [ ] CI green

## Carried Items (if any)
[Items that persist across multiple triage cycles -- track for escalation]
```

Present the report summary to the user.

## Rules

- **Exhaustive discovery.** Use timestamp-based scan (Rule #71). Never assume how many reports exist. Present the full count before processing.
- **Report commit policy is visibility-conditional (Rule #70).** Public repos: reports stay local, only code fixes are committed (`docs/agents/`, `logs/`, `scripts/agents/` gitignored). Private repos: reports are committed alongside code fixes as historical artifacts.
- **Process Dependabot PRs (Rule #72).** Triage scans for open Dependabot PRs and merges what it can: patch + minor with green CI auto-merge, majors defer for human review, obvious CI failures get one fix attempt. Dependabot processing happens last so it can't block triage code fixes.
- **Touch `.last-triage` after completion.** This marks all current reports as processed for the next triage run.
- **Check for agent failures.** Scan `logs/` BEFORE analyzing reports. A missing report might mean a failed agent, not "nothing to report."
- **Fix everything (Rule #58).** Categorize findings by severity, but implement 100% of action items. No deferring. No "nothing urgent."
- **Read every report completely.** No skimming, no summaries-of-summaries. Extract ALL action items from every report.
- **shared-context.md integration.** Read before analysis, append triage entry after completion.
- **CI accountability.** Push is not done until CI is green. Max 3 fix iterations.
- **Branch verification before every commit.** Run `git branch --show-current` first (Error #33).
- Run verification commands sequentially, never as parallel Bash calls.
