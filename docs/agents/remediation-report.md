# Remediation Report
> Generated on 2026-03-16 | Branch: `develop` | 24 findings resolved
>
> Pre-launch report: `docs/agents/pre-launch-report.md`

## Summary
- Findings processed: 32 (5 warnings + 27 recommendations)
- Issues created: 7 (#175-#181)
- Issues resolved: 7
- Tests added: ~25
- Files modified: 14
- CI status: PASSING

## Issues Resolved

| # | Issue | Domain | Severity | Tests Added | Status |
|---|-------|--------|----------|-------------|--------|
| #175 | launcher/utils/setup refactors | architecture, qa | WARNING | 10 | Closed |
| #176 | setup.test.ts test infrastructure | qa | WARNING | 0 (infra fix) | Closed |
| #177 | index.ts UX fixes | ux | WARNING | 7 | Closed |
| #178 | completions.ts subcommand flags | ux | RECOMMENDATION | 4 | Closed |
| #179 | config.ts path traversal hardening | security | WARNING | 2 | Closed |
| #180 | test coverage gaps (script + tree) | qa | RECOMMENDATION | 2 | Closed |
| #181 | package.json metadata + deps | devops | RECOMMENDATION | 0 (config) | Closed |

## Findings Addressed (24)

| Finding | Work Unit | Fix |
|---------|-----------|-----|
| W1 | #175 | optsToConfigMap unit tests added |
| W2 | #176 | waitForHandler assertion on failure |
| W3 | #176 | setTimeout(0) patterns documented |
| W4 | #177 | env var key validation in `summon set` |
| W5 | #179 | layoutPath helper with resolve+prefix check |
| R1 | #175 | optsToConfigMap branch coverage |
| R2 | #176 | waitForHandler throw on timeout |
| R3 | #180 | 4-pane secondary editor test |
| R4 | #180 | parser truncated input test |
| R7 | #181 | package.json main field added |
| R8 | #181 | publishConfig access: public |
| R9 | #175 | Removed trivial resolveCommand wrapper |
| R10 | #175 | Extracted isGhosttyInstalled to utils.ts |
| R11 | #181 | typescript-eslint updated to 8.57.1 |
| R17 | #177 | freeze usage consistency |
| R18 | #177 | btop description fixed |
| R19 | #177 | layoutNotFoundOrExit Error: prefix |
| R20 | #177 | doctor exit code 2 on issues |
| R21 | #177 | export includes env.* keys |
| R22 | #178 | doctor --fix / keybindings --vim completions |
| R24 | #177 | config unknown key removal hint |
| R25 | #177 | export header timestamp |
| R26 | #175 | Ctrl+C exit code 130 |
| R27 | #175 | Nested warning "messy" wording |

## Informational (no code change needed)
- R5: export 0o644 permissions appropriate for project files
- R6: env var values properly escaped, not exploitable

## Deferred Items
- R12: Split setup.ts (~1700 lines) — major refactor, separate task
- R13/R14: Test-only exports (~200 bytes) — cosmetic
- R15: Doctor subcommand split — marginal savings (<2 KB)
- R16: Monitor index.js size — informational
- R23: --fix/--vim global parse scope — parseArgs architectural limitation

## Final Verification
- [x] All 955 tests passing
- [x] Typecheck clean
- [x] Lint clean
- [x] Build succeeds (75 KB total)
- [x] CI green
- [x] All worktrees removed
- [x] All issues closed
