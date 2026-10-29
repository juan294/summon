---
name: "rpi-triage"
description: "Discover every relevant operational report and existing GitHub security or dependency finding, resolve authorized actionable items locally and record complete disposition."
---

# Triage Agent Reports

Process all overnight agent reports, GitHub Security & Quality Alerts, and the Dependabot PR queue. Discovers every report using timestamp-based discovery, checks for agent failures, scans open Dependabot PRs (Rule #84), synthesizes findings, proposes an action plan, implements all fixes, and integrates applicable dependency updates locally. Report commit policy depends on repo visibility: public repos keep reports local, private repos commit them as historical artifacts (Rule #70).

## Input

If the request specifies report paths, process only the specified report path(s). Otherwise, auto-discover all new/modified reports in `docs/agents/`. Do not report all clear until report, failure, alert-query and dependency-PR
inventories are all accounted for in Step 1.

## Step 1: Discovery

Find EVERY report, agent failure, and GitHub security/quality alert. No assumptions about which agents ran, how many reports exist, or whether GitHub has alerts. Discovery uses file timestamps, not git status (Rule #71).

1. **Capture a durable scan before reading reports:**

   Resolve `scripts/rpi-triage-state.py` relative to this installed skill. Run
   its `scan --root <absolute-project-root>` command and save the JSON output to
   a task-owned local handoff file. For explicit scope, add one `--report` per
   path relative to `docs/agents/`. Read the [checkpoint contract](references/triage-state.md).

   The helper captures scan-start time, inventories every `*-report.md`, and
   combines modification timestamps with prior content hashes/dispositions.
   Process every `selected` report and account for every `issues`/`missing_retry`
   entry. Unknown backdated reports and old failed/unprocessed reports remain
   eligible. An unchanged report is skipped only with a matching processed
   record. Explicit partial scans never advance the global marker.

   Cross-reference other Markdown files in `docs/agents/` and the prior
   [durable handoff](references/handoff.md); `shared-context.md` is context,
   not a report. `.last-triage` alone cannot prove that a report was processed.

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

3. **Check for open Dependabot PRs (Rule #84):**

   ```bash
   gh pr list --author "app/dependabot" \
     --json number,title,headRefName,mergeable,mergeStateStatus,statusCheckRollup,labels
   ```

   For each PR, classify the update type from the title (e.g., `Bump foo from 1.2.3 to 1.2.4` -> patch; `1.2.x -> 1.3.0` -> minor; `1.x -> 9.0.0` -> major) and the CI status:

   - **patch + CI green** -> ready for local batch verification
   - **minor + CI green** -> ready for local batch verification
   - **major** -> defer, human review required (regardless of CI)
   - **CI red, fix looks obvious** (e.g., snapshot/lockfile drift) -> attempt-fix
   - **CI red, not obvious** -> defer, note in report
   - **Mergeable conflict** -> resolve in the local dependency batch; if still conflicting, record the blocker

4. **Check GitHub Security & Quality Alerts (critical):**

   Determine the repository identifier first:

   ```bash
   gh repo view --json nameWithOwner --jq .nameWithOwner
   ```

   Query GitHub alert surfaces every triage run. These checks are mandatory
   and independent from local agent reports:

   ```bash
   gh api --paginate "repos/{owner}/{repo}/code-scanning/alerts?state=open"      --jq ".[] | {number, state, tool: .tool.name, rule: .rule.id, severity: (.rule.security_severity_level // .rule.severity), description: .rule.description, html_url, path: .most_recent_instance.location.path, line: .most_recent_instance.location.start_line}"

   gh api --paginate "repos/{owner}/{repo}/dependabot/alerts?state=open"      --jq ".[] | {number, state, severity: .security_advisory.severity, package: .dependency.package.name, ecosystem: .dependency.package.ecosystem, manifest: .dependency.manifest_path, advisory: .security_advisory.ghsa_id, summary: .security_advisory.summary, html_url}"

   gh api --paginate "repos/{owner}/{repo}/secret-scanning/alerts?state=open"      --jq ".[] | {number, state, secret_type, secret_type_display_name, resolution, html_url, created_at}"
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
   - New/modified reports and all helper-selected retries: primary triage targets.
   - `shared-context.md`: read for cross-agent intelligence, not a report itself.
   - Unchanged reports (older than `.last-triage`): skip only when their prior
     disposition proves they were processed; always retry failed/unprocessed
     records retained in the durable handoff.

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

   Total: N reports to process, M agent failures detected, G GitHub security/quality alerts found, K Dependabot PRs (local batch: A, attempt-fix: F, defer: D).

   Proceed directly to analysis unless all six inventories completed and there are zero selected reports, discovery gaps, agent failures, open alerts and dependency PRs. In that case report "all clear", record completed reporting, and run the same final checkpoint procedure before stopping.

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

   Leanness items still follow Rule #58 within the authorized triage scope: fix
   all extracted action items. During execution, preserve public APIs unless the action item
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
   - Cross-reference Dependabot security alerts with Dependabot PRs, but do not treat a PR alone as resolution; require the fix to be integrated
     locally with verification, and distinguish remote alert rescan status.

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
   - Local batch: PR #X (patch), PR #Y (minor)
   - Attempt-fix: PR #Z (snapshot drift)
   - Defer: PR #W (major bump)

   Total: N action items across M reports and G GitHub alerts. K Dependabot PRs to process.
   ```

8. **Present the briefing and action plan to the user.**

Present the concrete action plan and execute within the approved triage request.
Preserve real scope/architecture and external-action boundaries; do not insert a
second approval for routine fixes already authorized.

## Step 3: Execute

Implement all action items within the authorized triage scope.

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

2. **Obtain independent review and repair:**

   Have a reviewer other than the implementation author inspect the actual diff,
   findings and applicable tests. Missing or failed review remains an acceptance
   gap. Verify recommendations against evidence, repair confirmed actionable
   defects, and record false-positive rejections with supporting evidence. A new
   architectural decision needs an explicit disposition and owner decision;
   never silently discard it or create external issues without authorization.

3. **Run verification sequentially:**

   Discover and run the applicable tests, typechecks and lint sequentially,
   preserving each status. Complete all applicable local gates before acceptance.

4. **Run the harness-native simplify pass (or the Codex simplify helper), reviewing reuse, quality and efficiency** on all changed files.

5. **Rerun affected verification** if the simplify pass introduced changes.

## Step 4: Commit Locally

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

3. Keep the working branch local. Integrate the completed fixes and dependency
   batch locally and run the complete applicable CI-equivalent gate before any
   single authorized integration push. Inspect workflow/deployment triggers;
   never create Vercel Previews or publish working branches/PRs.

4. After an authorized push, inspect every expected workflow for the exact commit.
   Diagnose failures from existing logs and repair locally; do not rerun hosted
   jobs or re-push as a debugging loop.

5. Defer checkpointing until dependency processing and final reporting in
   Steps 5-6 complete. Record each processed report's path, content hash and
   disposition, retaining failed/unprocessed records for the next run regardless
   of modification time. If any discovery query/inventory failed, leave
   `.last-triage` unchanged. Otherwise set its timestamp to the captured
   scan-start boundary, never the completion time. Reports created or changed
   during execution must remain eligible for the next scan. Confirm this
   invariant before reporting a successful checkpoint.

## Step 5: Process Dependabot PRs

Process the discovered dependency updates in a local batch before final local
integration and publication (Rule #84). Existing PRs are read-only inputs.

1. Patch/minor candidates: inspect each change, apply relevant updates to one
   task-owned local branch/worktree, and verify their combined behavior.
2. Obvious failures: reproduce locally, fix the actual cause and rerun local
   checks. Do not push to the Dependabot branch or request a hosted rebase.
3. Major or unresolved updates: record the compatibility decision/blocker in
   the local triage report. Preserve every finding; do not silently drop one.
4. Integrate the verified batch locally, simplify, and run the complete local
   gate. Include it with the completed triage change in the single authorized
   integration push. Never merge dependency PRs directly into production.
5. Keep PR comments, closing and external issue creation pending authorization;
   do not use them as part of a remote experimentation loop.

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
- [ ] Full applicable local gate green; remote publication status recorded

## Carried Items (if any)
[Items that persist across multiple triage cycles -- track for escalation]
```

Present the report summary to the user. Then run the bundled helper's `checkpoint`
with the original scan JSON and a completion JSON recording every report outcome,
all six inventory statuses and `reported: true`. Follow the
[checkpoint contract](references/triage-state.md); missing outcomes remain
unprocessed, failures remain retryable, and incomplete or partial discovery leaves
the global marker unchanged. Inspect the helper result before claiming a successful
checkpoint. A stale-scan rejection requires a fresh scan, never overwriting state.

## Rules

- **Exhaustive discovery.** Use timestamp-based scan (Rule #71). Never assume how many reports exist. Present the full count before processing.
- **Report commit policy is visibility-conditional (Rule #70).** Public repos: reports stay local, only code fixes are committed (`docs/agents/`, `logs/`, `scripts/agents/` gitignored). Private repos: reports are committed alongside code fixes as historical artifacts.
- **GitHub alert coverage is mandatory.** Every triage run must query and report GitHub code scanning alerts (including CodeQL and quality warnings), Dependabot security alerts, and secret scanning alerts. Do not rely only on local agent reports. If a query fails or alerts appear disabled unexpectedly, report that as a YELLOW/RED triage finding and action item.
- **Process Dependabot PRs (Rule #84).** Triage reads open PRs, batches applicable dependency updates locally, and verifies the combined result before the single authorized integration push. No remote rebase, auto-merge, or dependency-branch push loop.
- **Checkpoint at the scan-start boundary.** Only after completed reporting and
  successful discovery, advance `.last-triage` no later than the captured
  scan-start time. Never use a completion-time touch. Retain failed/unprocessed
  report records independently of timestamps so no report is silently skipped.
- **Check for agent failures.** Scan `logs/` BEFORE analyzing reports. A missing report might mean a failed agent, not "nothing to report."
- **Fix everything (Rule #58).** Categorize findings by severity and resolve every confirmed actionable item within scope before acceptance. Record evidence-backed false positives and explicit architectural decisions; do not use severity as a blanket deferral. `leanness-report.md` is actionable: extract and implement every concrete recommendation within the authorized triage scope.
- **Leanness safety.** Leanness recommendations are not bulk-applied as an undifferentiated cleanup. Review each item individually, keep edits scoped to the files named by the report, preserve behavior, verify importer/public API impact before deleting exports, and rely on or add tests according to the risk.
- **Read every report completely.** No skimming, no summaries-of-summaries. Extract ALL action items from every report, including `leanness-report.md`.
- **shared-context.md integration.** Read before analysis, append triage entry after completion.
- **CI accountability.** Inspect expected runs after an authorized push; diagnose failures from existing logs and repair locally without rerun/re-push loops.
- **Branch verification before every commit.** Run `git branch --show-current` first (Error #33).
- Run verification commands sequentially, never as parallel Bash calls.

## Execution and acceptance

Use the scope and authorization already supplied in the request. Resolve routine
implementation choices from repository evidence. Complete authorized local work,
review, repair and applicable verification before its acceptance gate. An explicit
instruction can authorize continuation across phases; otherwise stop at the stated
phase boundary. Production, publication, destructive actions and new scope retain
their actual authorization requirements. Preserve durable artifacts before cleanup.
