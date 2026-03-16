# Remediation Report
> Generated on 2026-03-16 | Branch: `develop` | 14 findings resolved
>
> Pre-launch report: `docs/agents/pre-launch-report.md`

## Summary
- Findings processed: 14 (1 blocker + 13 warnings)
- Issues created: 8 (#166-#173)
- Issues resolved: 8/8
- Tests added: 46 (829 → 875)
- Files modified: 11
- CI status: PASSING

## Issues Resolved

| # | Issue | Domain | Severity | Tests Added | Status |
|---|-------|--------|----------|-------------|--------|
| B1 | Push & verify CI | devops | blocker | 0 | Resolved (CI green) |
| #166 | Fix flaky coverage test | qa | medium | 0 (stabilized existing) | Closed |
| #167 | Increase setup.ts coverage | qa | low | 18 | Closed |
| #168 | Increase launcher+utils coverage | qa | low | 15 | Closed |
| #169 | Validate on-start + remove dup regex | security/arch | low | 8 | Closed |
| #170 | EDITOR validation + UX fixes | security/ux | low | 9 | Closed |
| #171 | CI hardening (CodeQL + dep-review) | devops | low | 0 (CI config) | Closed |
| #172 | Unify resolveCommand async/sync | arch | low | 0 (pure refactor) | Closed |
| #173 | Document test-only exports | arch | low | 0 (JSDoc only) | Closed |

## What Changed

### Security
- `on-start` from CLI/machine config now checked for shell metacharacters (W5)
- `layout edit` validates `$EDITOR` against SAFE_COMMAND_RE (W6)
- Duplicate SAFE_COMMAND_RE check removed from launcher.ts wrapper (W11)

### UX
- `summon open` re-prompts on invalid selection instead of exiting (W9)
- `summon set editor ""` now refuses empty string for command keys (W10)

### CI/CD
- CodeQL runs on `develop` pushes and PRs (W7)
- `dependency-review.yml` no longer uses `continue-on-error` (W8)

### Architecture
- `setup.ts` reuses `resolveCommand` from utils.ts instead of duplicating (W12)
- All 4 test-only exports have consistent `@internal` JSDoc (W13)

### Test Coverage
- Flaky coverage test stabilized with timeout + retry (W1)
- setup.ts: 94.56% → 98.74% stmts, 86.42% → 92.38% branches (W2)
- launcher.ts: 89.50% → 92.50% branch coverage (W3)
- utils.ts: 83.33% → 100% branch coverage (W4)

## Final Verification
- [x] All 875 tests passing
- [x] Typecheck clean
- [x] Lint clean
- [x] Build succeeds (67KB, 14ms)
- [x] Pushed to origin/develop
- [x] All worktrees and branches cleaned up
- [x] All 8 issues closed

## Remaining Items
None — all 14 findings resolved.
