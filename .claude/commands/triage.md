# Triage Agent Reports

Model tier: **sonnet** — Sonnet 4.6 (1M context) session.

Process all overnight agent reports, GitHub Security & Quality Alerts, and the Dependabot PR queue. Discovers every report using timestamp-based discovery, checks for agent failures, scans open Dependabot PRs (Rule #72), synthesizes findings, proposes an action plan, implements all fixes, and merges the Dependabot PRs that are safe to auto-merge. Report commit policy depends on repo visibility: public repos keep reports local, private repos commit them as historical artifacts (Rule #70).

## Input

If `$ARGUMENTS` is provided, process only the specified report path(s). Otherwise, auto-discover all new/modified reports in `docs/agents/`. If no reports found and no agent failures detected, report "all clear" and **STOP.**

## Step 1: Discovery

Find EVERY report, agent failure, and GitHub security/quality alert. No assumptions about which agents ran, how many reports exist, or whether GitHub has alerts. Discovery uses file timestamps, not git status (Rule #71).

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

4. **Check GitHub Security & Quality Alerts (critical):**

   Determine the repository identifier first:

   ```bash
   REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
   ```

   Query GitHub alert surfaces every triage run. These checks are mandatory
   and independent from local agent reports:

   ```bash
   gh api --paginate "repos/$REPO/code-scanning/alerts?state=open"      --jq ".[] | {number, state, tool: .tool.name, rule: .rule.id, severity: (.rule.security_severity_level // .rule.severity), description: .rule.description, html_url, path: .most_recent_instance.location.path, line: .most_recent_instance.location.start_line}"

   gh api --paginate "repos/$REPO/dependabot/alerts?state=open"      --jq ".[] | {number, state, severity: .security_advisory.severity, package: .dependency.package.name, ecosystem: .dependency.package.ecosystem, manifest: .dependency.manifest_path, advisory: .security_advisory.ghsa_id, summary: .security_advisory.summary, html_url}"

   gh api --paginate "repos/$REPO/secret-scanning/alerts?state=open"      --jq ".[] | {number, state, secret_type, secret_type_display_name, resolution, html_url, created_at}"
   ```

   Treat all open alerts as triage findings:
   - **Code scanning / CodeQL alerts:** include every open alert, security or
     quality, from every tool. Do not filter out low/medium quality warnings.
   - **Dependabot security alerts:** include every open dependency alert,
     whether or not a Dependabot PR already exists.
   - **Secret scanning alerts:** include every open alert; redact secret values.
   - **API/query failure:** if any GitHub alert query fails, returns 403/404,
     or appears disabled despite the repo being expected to have alerts
     enabled, include a discovery failure in the briefing and action plan.

5. **Classify files:**
   - New/modified reports (newer than `.last-triage`): primary triage targets.
   - `shared-context.md`: read for cross-agent intelligence, not a report itself.
   - Unchanged reports (older than `.last-triage`): skip -- already processed.

6. **Present discovery results:**

   Agent Failures (if any):

   | Agent | Status | Error Log | Last Line |
   |-------|--------|-----------|-----------|

   Reports to Process:

   | # | Report File | Modified | Size |
   |---|-------------|----------|------|

   GitHub Security & Quality Alerts (if any):

   | # | Type | Severity | Tool/Package | Rule/Advisory | Location | Status |
   |---|------|----------|--------------|---------------|----------|--------|

   Dependabot PRs (if any):

   | # | PR | Update Type | CI | Disposition |
   |---|----|----|----|----|

   Total: N reports to process, M agent failures detected, G GitHub security/quality alerts found, K Dependabot PRs (auto-merge: A, attempt-fix: F, defer: D).

   Do NOT stop here -- proceed directly to analysis unless there are ZERO reports, ZERO failures, ZERO GitHub security/quality alerts, ZERO GitHub alert query failures, AND ZERO Dependabot PRs (in which case report "all clear" and **STOP**).

## Step 2: Analyze

Read-only. Do not modify any files.

1. **Read `shared-context.md`** for cross-agent intelligence and patterns.

2. **Read EVERY report** from the discovery list. Completely. No skimming.

3. **Leanness report handling:** If a discovered report is
   `leanness-report.md`, read it completely and treat its recommendations
   as actionable triage items. Extract every concrete `shrink`, `delete`,
   `yagni`, duplication, dead-code, or efficiency finding as an action item.
   If the report says "review individually" or "do not bulk-apply", satisfy
   that requirement by listing each leanness recommendation separately in the
   action plan with its target files, expected line/complexity reduction, test
   coverage expectation, and any breaking-change caution. Do not treat the
   entire leanness report as one bulk refactor.

   Leanness items still follow Rule #58 after user approval: fix all extracted
   action items. During execution, preserve public APIs unless the action item
   explicitly identifies a dead export or unused surface; for any possible
   breaking change, verify importers first and document the compatibility
   judgment in the report.

4. **For each report, extract:**
   - Status: GREEN / YELLOW / RED
   - Key findings (bullet points)
   - Metrics (numbers, trends)
   - Action items (what needs fixing)
   - Carried items (persistent across multiple cycles)

5. **Analyze EVERY GitHub security and quality alert** from discovery:
   - Determine status: GREEN / YELLOW / RED.
   - RED: open critical/high security alert, active secret scanning alert, or any alert with known exploit/public exposure.
   - YELLOW: open medium/low security alert, CodeQL/code-scanning quality alert, or query failure that prevents alert visibility.
   - GREEN: no open alerts and all alert queries succeeded.
   - Extract action items: fix vulnerable dependency, remediate CodeQL/code-scanning finding, rotate/revoke exposed secret, enable/fix GitHub alert scanning, or document that the alert is already resolved but awaiting GitHub rescan.
   - Cross-reference Dependabot security alerts with Dependabot PRs, but do not treat a PR as sufficient unless it is merged or queued for merge with green checks.

6. **Synthesize across all reports and GitHub alerts:**
   - Cross-reference findings (e.g., coverage report flags X needs tests, code quality report flags X has lint issues -- group them).
   - Identify patterns (multiple agents flagging the same area).
   - Check shared-context.md recommendations against report findings.
   - Cross-reference GitHub alerts with report findings, Dependabot PRs, and carried items so GitHub-native warnings cannot be hidden by GREEN local reports.

7. **Draft the action plan:**

   Group action items by report. Include ALL extracted items from every
   report -- fix everything (Rule #58). For each item: what to do, which
   files, expected outcome.

   For `leanness-report.md`, include a dedicated "Leanness Recommendations"
   section and list each recommendation as its own numbered item. Include:
   target files, action type (`shrink`, `delete`, `yagni`, etc.), expected
   reduction or simplification, test strategy, and compatibility risk.

   ```markdown
   ## Action Plan

   ### From [report-name] (STATUS)
   1. [Action item with specific files and expected outcome]
   2. [Action item...]

   ### From [report-name] (STATUS)
   3. [Action item...]

   ### GitHub Security & Quality Alerts
   - Alert #X (code scanning / CodeQL): [rule, severity, file:line, action]
   - Alert #Y (Dependabot security): [package, advisory, manifest, action]
   - Alert #Z (secret scanning): [secret type, action without secret value]

   ### Dependabot PRs (Step 5)
   - Auto-merge: PR #X (patch), PR #Y (minor)
   - Attempt-fix: PR #Z (snapshot drift)
   - Defer: PR #W (major bump)

   Total: N action items across M reports and G GitHub alerts. K Dependabot PRs to process.
   ```

8. **Present the briefing and action plan to the user.**

**STOP.** Wait for the user to review and approve the action plan.

## Step 3: Execute

After user approval, implement all action items.

1. **Implement fixes** following TDD where applicable:
   - Test coverage gaps: write the tests.
   - Code quality issues: fix the code.
   - Security findings: apply the fix.
   - GitHub security/quality alerts: fix the underlying dependency, code, configuration, or secret exposure; reference the GitHub alert number and verify the alert is closed or waiting for GitHub rescan.
   - Dependency updates: update and verify.
   - Documentation gaps: update the docs.
   - Configuration issues: fix the config.
   - Leanness findings: make the smallest behavior-preserving refactor or
     deletion that resolves the specific finding; use existing coverage for
     pure refactors when sufficient, and add or update tests when behavior,
     public API, or compatibility could change.

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

## GitHub Security & Quality Alerts
| # | Type | Severity | Tool/Package | Rule/Advisory | Location | Status | Notes |
|---|------|----------|--------------|---------------|----------|--------|-------|
(or "None -- no open GitHub security or quality alerts")

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
- **GitHub alert coverage is mandatory.** Every triage run must query and report GitHub code scanning alerts (including CodeQL and quality warnings), Dependabot security alerts, and secret scanning alerts. Do not rely only on local agent reports. If a query fails or alerts appear disabled unexpectedly, report that as a YELLOW/RED triage finding and action item.
- **Process Dependabot PRs (Rule #72).** Triage scans for open Dependabot PRs and merges what it can: patch + minor with green CI auto-merge, majors defer for human review, obvious CI failures get one fix attempt. Dependabot processing happens last so it can't block triage code fixes.
- **Touch `.last-triage` after completion.** This marks all current reports as processed for the next triage run.
- **Check for agent failures.** Scan `logs/` BEFORE analyzing reports. A missing report might mean a failed agent, not "nothing to report."
- **Fix everything (Rule #58).** Categorize findings by severity, but implement 100% of action items. No deferring. No "nothing urgent." `leanness-report.md` is actionable: extract and implement every concrete recommendation after the user approves the action plan.
- **Leanness safety.** Leanness recommendations are not bulk-applied as an undifferentiated cleanup. Review each item individually, keep edits scoped to the files named by the report, preserve behavior, verify importer/public API impact before deleting exports, and rely on or add tests according to the risk.
- **Read every report completely.** No skimming, no summaries-of-summaries. Extract ALL action items from every report, including `leanness-report.md`.
- **shared-context.md integration.** Read before analysis, append triage entry after completion.
- **CI accountability.** Push is not done until CI is green. Max 3 fix iterations.
- **Branch verification before every commit.** Run `git branch --show-current` first (Error #33).
- Run verification commands sequentially, never as parallel Bash calls.
