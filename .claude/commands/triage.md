# Triage Agent Reports

Process all overnight agent reports. Discovers every report exhaustively, checks for agent failures, synthesizes findings, proposes an action plan, implements all fixes, and commits reports for historical record.

## Input

If `$ARGUMENTS` is provided, process only the specified report path(s). Otherwise, auto-discover all new/modified reports in `docs/agents/`. If no reports found and no agent failures detected, report "all clear" and **STOP.**

## Step 1: Discovery

Find EVERY report and agent failure. No assumptions about which agents ran or how many reports exist.

1. **Three-layer scan:**

   a. Git status -- captures all uncommitted new/modified files:

      ```bash
      git status --short -- docs/agents/
      ```

   b. Glob scan -- complete inventory of all report files:

      ```
      Glob docs/agents/*.md
      ```

   c. Cross-reference both lists. Flag any discrepancies:
      - Files in git status but not in glob (shouldn't happen -- defensive)
      - Untracked files in `docs/agents/` (new agent started running?)

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

3. **Classify files:**
   - New/modified reports (from git status): primary triage targets.
   - `shared-context.md`: read for cross-agent intelligence, not a report itself.
   - Unchanged reports (in glob but not in git status): skip -- already processed.

4. **Present discovery results:**

   Agent Failures (if any):

   | Agent | Status | Error Log | Last Line |
   |-------|--------|-----------|-----------|

   Reports to Process:

   | # | Report File | Modified | Size |
   |---|-------------|----------|------|

   Total: N reports to process, M agent failures detected.

   Do NOT stop here -- proceed directly to analysis unless there are ZERO reports and ZERO failures (in which case report "all clear" and **STOP**).

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

   Total: N action items across M reports. All will be implemented.
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

1. **First commit -- reports for historical record** (untouched, as agents wrote them):

   ```bash
   git add docs/agents/*-report.md docs/agents/shared-context.md
   git commit -m "chore: commit overnight agent reports [YYYY-MM-DD]"
   ```

2. **Append triage entry to shared-context.md:**

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

3. **Second commit -- code fixes + shared-context update** (if any fixes were made):

   ```bash
   git add <changed-files> docs/agents/shared-context.md
   git commit -m "fix: resolve agent report findings [triage]"
   ```

4. **Push to remote. Monitor CI:**

   ```bash
   git push
   gh run list --branch $(git branch --show-current) --limit 1 \
     --json databaseId,conclusion,status
   ```

6. **If CI fails:** diagnose and fix (same logic as `/fix-ci`, max 3 iterations).

## Step 5: Report

Generate a triage report at `docs/agents/triage-report.md`:

```markdown
# Triage Report
> Generated on [date] | [N] reports processed | [M] action items

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

- **Exhaustive discovery.** Use all three scan layers (git status, Glob, cross-reference). Never assume how many reports exist. Present the full count before processing.
- **Check for agent failures.** Scan `logs/` BEFORE analyzing reports. A missing report might mean a failed agent, not "nothing to report."
- **Fix everything (Rule #58).** Categorize findings by severity, but implement 100% of action items. No deferring. No "nothing urgent."
- **Read every report completely.** No skimming, no summaries-of-summaries. Extract ALL action items from every report.
- **Two-commit strategy.** First commit: reports as-written (historical record). Second commit: code fixes. Never mix them.
- **shared-context.md integration.** Read before analysis, append triage entry after completion.
- **CI accountability.** Push is not done until CI is green. Max 3 fix iterations.
- **Branch verification before every commit.** Run `git branch --show-current` first (Error #33).
- Run verification commands sequentially, never as parallel Bash calls.
