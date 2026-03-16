# Pre-Launch Audit Report
> Generated on 2026-03-16 | Branch: `develop` | 6 parallel specialists | Pre-v1.2.0

## Verdict: CONDITIONAL

No blockers. 5 warnings across QA, Security, and UX. 27 recommendations.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | launcher.ts branch coverage at 79.59% (optsToConfigMap untested) | WARNING | qa-lead | Low |
| W2 | Polling-based test sync in setup.test.ts waitForHandler() | WARNING | qa-lead | Low |
| W3 | setTimeout(0) for keypress simulation in setup tests | WARNING | qa-lead | Low |
| W4 | `summon set env.INVALID` silently accepts invalid env var key names | WARNING | ux-reviewer | Medium |
| W5 | Layout name path traversal prevented by regex only | WARNING | security-reviewer | Low |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN
- **930 tests**, 100% pass rate, 12 test files
- **97.26% stmt / 90.29% branch / 98.13% func / 98.19% line** coverage
- All configured thresholds met (95/90/95/95)
- Typecheck: PASS | Lint: PASS

| # | Finding | Severity |
|---|---------|----------|
| W1 | launcher.ts branch coverage 79.59% — optsToConfigMap 28 uncovered branches | WARNING |
| W2 | waitForHandler() polling without assertion on failure | WARNING |
| W3 | setTimeout(0) keypress simulation pattern | WARNING |
| R1 | Add direct unit tests for optsToConfigMap() | RECOMMENDATION |
| R2 | Add assertion in waitForHandler() if handler never captured | RECOMMENDATION |
| R3 | script.ts line 294 uncovered (3+ right-column editors edge case) | RECOMMENDATION |
| R4 | tree.ts line 124 uncovered (parser advance() defensive error) | RECOMMENDATION |

### 2. Security (security-reviewer) — GREEN
- Zero vulnerable dependencies, zero runtime deps
- No hardcoded secrets
- Command injection guarded (execFileSync arrays, SAFE_COMMAND_RE)
- AppleScript injection prevented (escapeAppleScript on all user input)
- File permissions correct (0o600/0o700)

| # | Finding | Severity |
|---|---------|----------|
| W5 | Layout name path traversal prevented by regex only (no secondary resolve+prefix check) | WARNING |
| R5 | export command writes .summon with 0o644 — appropriate but document distinction | RECOMMENDATION |
| R6 | Env var values not checked by confirmDangerousCommands (properly escaped) | RECOMMENDATION |

### 3. Infrastructure (devops) — GREEN
- Build succeeds, CI green (4/4 completed runs)
- Node 18/20/22 matrix, CodeQL, dependency review
- Working tree clean, npm pack clean

| # | Finding | Severity |
|---|---------|----------|
| R7 | Add `main` field to package.json for legacy tooling compat | RECOMMENDATION |
| R8 | Consider `publishConfig: {"access": "public"}` | RECOMMENDATION |

### 4. Architecture (architect) — GREEN
- Typecheck passes, no circular deps, no dead exports

| # | Finding | Severity |
|---|---------|----------|
| R9 | Remove trivial resolveCommand wrapper in launcher.ts | RECOMMENDATION |
| R10 | Extract shared isGhosttyInstalled() helper | RECOMMENDATION |
| R11 | Update typescript-eslint 8.57.0 → 8.57.1 | RECOMMENDATION |
| R12 | Consider splitting setup.ts (~1700 lines) | RECOMMENDATION |

### 5. Performance (performance-eng) — GREEN
- Total build: ~75 KB across 12 chunks
- Largest: index.js (35.37 KB) — under 50 KB threshold
- Code splitting effective, no hot-path bloat

| # | Finding | Severity |
|---|---------|----------|
| R13 | Test-only exports inflate bundle marginally (~200 bytes) | RECOMMENDATION |
| R14 | setup.ts exports ~50 symbols, most test-only | RECOMMENDATION |
| R15 | doctor subcommand could be split out (<2 KB savings) | RECOMMENDATION |
| R16 | Monitor index.js size as features grow | RECOMMENDATION |

### 6. UX/Accessibility (ux-reviewer) — GREEN
- Help text comprehensive, error messages actionable
- NO_COLOR respected, non-TTY handled

| # | Finding | Severity |
|---|---------|----------|
| W4 | `summon set env.*` accepts invalid env var key names | WARNING |
| R17 | freeze usage `<layout-name>` vs help `<name>` inconsistent | RECOMMENDATION |
| R18 | btop preset description hard-codes "lazygit sidebar" | RECOMMENDATION |
| R19 | layoutNotFoundOrExit lacks `Error:` prefix | RECOMMENDATION |
| R20 | `summon doctor` exits 0 even when issues found | RECOMMENDATION |
| R21 | `summon export` drops env.* keys | RECOMMENDATION |
| R22 | Shell completions don't complete `doctor --fix` / `keybindings --vim` | RECOMMENDATION |
| R23 | `--fix`/`--vim` are global parse options but subcommand-specific | RECOMMENDATION |
| R24 | config unknown key message doesn't suggest removal | RECOMMENDATION |
| R25 | export header lacks timestamp | RECOMMENDATION |
| R26 | Ctrl+C exits with code 0 instead of 130 | RECOMMENDATION |
| R27 | Nested workspace warning "too scary" could be clearer | RECOMMENDATION |
