# Remediation Report

> Generated on 2026-03-20 | Branch: `develop` | 10 issues resolved
>
> Pre-launch report: `docs/agents/pre-launch-report.md`

## Summary

- Findings processed: 31 (11 warnings + 20 recommendations)
- Issues created: 10
- Issues resolved: 10
- Tests added: ~39
- Files modified: 16
- CI status: IN PROGRESS

## Issues Resolved

| # | Issue | Domain | Severity | Tests Added | Status |
|---|-------|--------|----------|-------------|--------|
| #190 | Extend metacharacter check to tree pane.* commands & launcher UX | security, ux | WARNING | 17 | Resolved |
| #191 | Expand summon doctor & improve CLI help text | ux | WARNING | 12 | Resolved |
| #192 | Bash completion portability & freeze/export completions | ux | WARNING | 5 | Resolved |
| #193 | Fix flatted prototype pollution in dev dependency | security | WARNING | 0 | Resolved |
| #194 | Add STARSHIP_CONFIG to README env var table | docs | WARNING | 0 | Resolved |
| #195 | Add main branch to CodeQL PR trigger | infra | WARNING | 0 | Resolved |
| #196 | Reduce accessibility check timeout from 5s to 2s | perf | WARNING | 1 | Resolved |
| #197 | Skip comment lines in readKVFile parser | arch | RECOMMENDATION | 2 | Resolved |
| #198 | Setup.ts cleanup: dead code removal & preview dedup | arch | RECOMMENDATION | 1 | Resolved |
| #199 | Tree parser coverage for unexpected end-of-input guard | qa | RECOMMENDATION | 1 | Resolved |

## Changes by File

| File | Changes |
|------|---------|
| `src/launcher.ts` | W1: pane.* metachar check, W9: install prompt default, R19: on-start error, R24: on-start stderr |
| `src/launcher.test.ts` | 17 new tests, SUMMON_WORKSPACE env leak fix in metachar describe |
| `src/index.ts` | W7: doctor editor/sidebar checks, W10: cancel hint, R13-R25: help/formatting |
| `src/index.test.ts` | 12 new tests |
| `src/completions.ts` | W8: _init_completion fallback, R23: freeze/export completions |
| `src/completions.test.ts` | 5 new tests |
| `src/utils.ts` | W11: timeout 5000 → 2000 |
| `src/utils.test.ts` | 1 test updated |
| `src/config.ts` | R11: skip # comment lines |
| `src/config.test.ts` | 2 new tests |
| `src/setup.ts` | R8: use buildFocusGrid in runGridBuilder, R9: extract box-drawing helpers |
| `src/setup.test.ts` | 1 new test (grid edge case) |
| `src/tree.test.ts` | 1 new test (end-of-input paths) |
| `package.json` | W2: pnpm.overrides for flatted >=3.4.2 |
| `README.md` | W5: STARSHIP_CONFIG env var |
| `.github/workflows/codeql.yml` | W6: main in PR trigger |

## Final Verification

- [x] All tests passing (1000/1000)
- [x] Typecheck clean
- [x] Lint clean
- [x] Build succeeds
- [ ] CI green (in progress)
- [x] Worktrees cleaned up
- [x] All remediation branches deleted
- [x] All 10 issues closed

## Deferred Items

| Item | Reason |
|------|--------|
| R10: Split setup.ts into tui.ts + setup.ts | Major structural refactor; warrants its own feature branch |
| R12: Extract doctor to src/doctor.ts | Major structural refactor; warrants its own feature branch |
| W3: on-start execSync | Accepted risk; mitigated by prompt + non-TTY refusal |
| R2: SIGINT handler coverage | Inherently untestable in-process |
| R6: pane cwd traversal | Accepted; equivalent to user typing `cd` in terminal |
