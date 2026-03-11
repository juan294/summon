# Pre-Launch Audit

Run a comprehensive multi-agent audit before any production release.

## Instructions

Spawn 6 parallel specialist agents -- all read-only. Each investigates their domain and reports findings categorized as blockers, warnings, or recommendations.

### The Team

Launch all 6 as parallel background Task agents:

1. **architect** -- Run `pnpm typecheck`, check for outdated/conflicting dependencies (`pnpm outdated`), circular dependencies, dead code detection, duplicate code patterns.

2. **qa-lead** -- Run `pnpm test && pnpm typecheck && pnpm lint`. Report total test count, pass rate, failures. Check coverage for critical paths. Verify graceful degradation. Identify high-risk untested files.

3. **security-reviewer** -- Run `pnpm audit`. Search for hardcoded secrets (API keys, tokens, passwords). Check for injection vectors. Check dependency licenses.

4. **performance-eng** -- Run `pnpm build` and parse output for bundle/artifact sizes. Flag oversized artifacts. Check for unused exports bloating the bundle. Assess code splitting. Check for performance anti-patterns.

5. **ux-reviewer** -- Check CLI help text quality, error messages, flag consistency, --help output for all commands, exit codes.

6. **devops** -- Verify build succeeds, check CI status on develop (`gh run list --branch develop --limit 5`), audit env var documentation vs actual usage, check error pages exist, verify git state is clean.

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
### 1. Quality Assurance (qa-lead) -- GREEN/YELLOW/RED
### 2. Security (security-reviewer) -- GREEN/YELLOW/RED
### 3. Infrastructure (devops) -- GREEN/YELLOW/RED
### 4. Architecture (architect) -- GREEN/YELLOW/RED
### 5. Performance (performance-eng) -- GREEN/YELLOW/RED
### 6. UX/CLI (ux-reviewer) -- GREEN/YELLOW/RED
```

### After the Audit

If the verdict is CONDITIONAL or NOT READY with code quality findings (dead code, duplicates,
inefficiencies, reuse opportunities), recommend running `/simplify` as the first fix action.
`/simplify` spawns 3 specialized agents (code reuse, code quality, efficiency) and applies
fixes automatically -- it handles the bulk of architect and performance-eng findings in one pass.

For findings that `/simplify` can't address (security, infrastructure, accessibility), those
require manual implementation or a targeted `/implement` cycle.

### Rules

- **Read-only.** No specialist modifies files -- they audit and report.
- **Parallel.** All 6 run simultaneously.
- **Do NOT auto-fix during the audit.** Specialists are read-only -- present the full audit to the user. The user decides what to fix and what to accept as risk. After review, `/simplify` may be used as a first fix step (see "After the Audit" above).
- **Verdict thresholds:** Any blocker = NOT READY. Warnings only = CONDITIONAL. Clean = READY.
