# Pre-Launch Audit

Run a comprehensive multi-agent audit before any production release.

## Instructions

Spawn 6 parallel specialist agents — all read-only. Each investigates their domain and reports findings categorized as blockers, warnings, or recommendations.

### The Team

Launch all 6 as parallel background Task agents:

1. **architect** — Run `$TYPECHECK_CMD`, check for outdated/conflicting dependencies (`$PKG_MANAGER outdated`), circular dependencies, dead code detection, duplicate code patterns.

2. **qa-lead** — Run `$TEST_CMD && $TYPECHECK_CMD && $LINT_CMD`. Report total test count, pass rate, failures. Check coverage for critical paths. Verify graceful degradation. Identify high-risk untested files.

3. **security-reviewer** — Run `$PKG_MANAGER audit`. Search for hardcoded secrets (API keys, tokens, passwords). Verify auth implementation. Check for injection vectors (XSS, SQL). Verify no secrets in client-visible env vars. Check CORS configuration. Check dependency licenses.

4. **performance-eng** — Run `$BUILD_CMD` and parse output for bundle/artifact sizes. Flag oversized artifacts. Check for unused exports bloating the bundle. Assess code splitting. Check for performance anti-patterns.

5. **ux-reviewer** — Check heading hierarchy, ARIA labels, focus indicators, `prefers-reduced-motion` support, alt text, keyboard navigation, error/empty/loading states, design consistency.

6. **devops** — Verify build succeeds, check CI status on develop (`gh run list --branch develop --limit 5`), audit env var documentation vs actual usage, check error pages exist, verify git state is clean.

### Synthesis

After all 6 complete, collect results into a single report at `docs/agents/pre-launch-report.md`:

```markdown
# Pre-Launch Audit Report
> Generated on [date] | Branch: `develop` | 6 parallel specialists

## Verdict: READY / CONDITIONAL / NOT READY

## Blockers (must fix before release)
[List with severity, found-by, and fix description]

## Warnings
[Table: #, Issue, Severity, Found by, Risk]

## Detailed Findings
### 1. Quality Assurance (qa-lead) — GREEN/YELLOW/RED
### 2. Security (security-reviewer) — GREEN/YELLOW/RED
### 3. Infrastructure (devops) — GREEN/YELLOW/RED
### 4. Architecture (architect) — GREEN/YELLOW/RED
### 5. Performance (performance-eng) — GREEN/YELLOW/RED
### 6. UX/Accessibility (ux-reviewer) — GREEN/YELLOW/RED
```

### After the Audit

Run `/remediate` to resolve all findings. It creates GitHub issues for every finding, spawns
parallel TDD agents in worktrees, merges sequentially, verifies CI, and runs `/simplify`
twice (per-agent and final).

`/remediate` handles the full spectrum — code quality findings that `/simplify` alone can fix
AND domain-specific findings (security, infrastructure, accessibility) that require targeted
implementation.

### Rules

- **Read-only.** No specialist modifies files — they audit and report.
- **Parallel.** All 6 run simultaneously.
- **Do NOT auto-fix during the audit.** Specialists are read-only — present the full audit to the user. The user decides what to fix and what to accept as risk. After review, `/simplify` may be used as a first fix step (see "After the Audit" above).
- **Verdict thresholds:** Any blocker = NOT READY. Warnings only = CONDITIONAL. Clean = READY.
