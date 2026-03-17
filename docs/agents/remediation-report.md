# Remediation Report
> Generated on 2026-03-17 | Branch: `develop` | 4 issues resolved
>
> Pre-launch report: `docs/agents/pre-launch-report.md`

## Summary
- Findings processed: 19 (8 warnings + 11 recommendations)
- Issues created: 4
- Issues resolved: 4
- Tests added: 13 (6 ENV_KEY_RE + 4 tree+CWD merge + 3 starship caching)
- Files modified: 12
- CI status: IN PROGRESS (pending)

## Issues Resolved
| # | Issue | Domain | Severity | Tests Added | Status |
|---|-------|--------|----------|-------------|--------|
| #184 | Extract ENV_KEY_RE + show config defaults | architecture, ux | low | 6 | Closed |
| #185 | Strengthen test assertions + cover tree+CWD merge | qa | low | 4 | Closed |
| #186 | @internal JSDoc tags + cache listStarshipPresets | architecture, performance | low | 3 | Closed |
| #187 | Harden branch protection on main | devops | low | 0 (config) | Closed |

## Findings Disposition
| Finding | Action | Details |
|---------|--------|---------|
| W1 | Resolved | Pushed with release |
| W2/R1 | Fixed (#184) | ENV_KEY_RE extracted to validation.ts |
| W3/R2 | Fixed (#185) | 8x .toBeTruthy() → .toBeTypeOf('string') |
| W4/R3 | Fixed (#185) | 4 tests for tree+CWD merge path |
| W5 | Skipped | By design (on-start uses shell intentionally) |
| W6/R9 | Fixed (#187) | enforce_admins + dismiss_stale_reviews enabled |
| W7/R10 | Skipped | False positive (adding to CLI_FLAGS breaks completions; subcommand-specific handling is correct) |
| W8 | Skipped | Cosmetic (Ghostty renders Unicode fine) |
| R4 | Skipped | Feature request (--yes flag for CI) — future release |
| R5 | Skipped | Security design decision (strict EDITOR validation) |
| R6 | Skipped | Already implemented (README Trust Model section exists) |
| R7 | Fixed (#186) | @internal tags added to GHOSTTY_PATHS, layoutPath |
| R8 | Fixed (#186) | listStarshipPresets() now cached |
| R11 | Fixed (#184) | `summon config` shows effective defaults |

## Final Verification
- [x] All tests passing (958)
- [x] Typecheck clean
- [x] Lint clean
- [x] Build succeeds (75KB, 14ms)
- [ ] CI green (pending)
- [x] /simplify final pass complete

## Remaining Items
None — all actionable findings resolved. Skipped items are by-design, false positives, or future feature requests.
