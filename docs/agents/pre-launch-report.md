# Pre-Launch Audit Report
> Generated on 2026-03-16 | Branch: `develop` | 6 parallel specialists | Post-v1.0.0 (Claude-optional refactor)

## Verdict: CONDITIONAL

One blocker (unpushed commits must go through CI before release). No code-level blockers.

## Blockers (must fix before release)

| # | Issue | Found by | Fix |
|---|-------|----------|-----|
| B1 | 2 unpushed commits on `develop` (`f495da2`, `befcde1`) — not yet verified by CI | devops | Push and verify CI passes |

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Flaky test under v8 coverage: `"accepts valid layout preset"` (index.test.ts:477) | Medium | qa-lead | May fail CI on slow runners |
| W2 | `setup.ts` below per-file coverage thresholds (94.56% stmts, 86.42% branches) | Low | qa-lead | Interactive wizard paths least tested |
| W3 | `launcher.ts` branch coverage 89.50% (below 90% per-file) | Low | qa-lead | Non-dry-run execution paths uncovered |
| W4 | `utils.ts` branch coverage 83.33% (below 90% per-file) | Low | qa-lead | Line 48 uncovered |
| W5 | `on-start` from CLI/machine config bypasses `confirmDangerousCommands` | Low | security | User-controlled source, low risk |
| W6 | `layout edit` uses `$EDITOR` without SAFE_COMMAND_RE validation | Low | security | Standard Unix behavior |
| W7 | CodeQL only runs on `main` and weekly schedule, not on `develop` | Low | devops | Security scanning delayed until production |
| W8 | `dependency-review.yml` uses `continue-on-error: true` | Low | devops | Vulnerable deps get green checks |
| W9 | `summon open` exits on invalid selection instead of re-prompting | Low | ux-reviewer | Minor UX inconsistency |
| W10 | `summon set editor ""` saves empty value (triggers wizard on next launch) | Low | ux-reviewer | Confusing footgun |
| W11 | Duplicate `SAFE_COMMAND_RE` check in launcher.ts `resolveCommand` wrapper | Low | architect | Defense-in-depth, not a bug |
| W12 | `setup.ts` async `resolveCommandAsync` parallels sync `resolveCommand` from utils.ts | Low | architect | Must update both if logic changes |
| W13 | Test-only exports inflate public API surface (4 `@internal` exports) | Low | architect/perf | Intentional, no runtime impact |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — YELLOW

- **829 tests, 100% pass rate** (standard mode)
- **Typecheck:** clean
- **Lint:** clean
- **Global coverage:** 96.86% stmts, 90.70% branches, 98.57% funcs, 97.51% lines — all thresholds met
- All 10 source files have co-located test files
- 1 flaky test under coverage mode (W1)
- Per-file branch coverage below 90% for setup.ts, launcher.ts, utils.ts (W2-W4)

### 2. Security (security-reviewer) — GREEN

- `pnpm audit`: zero vulnerabilities
- No hardcoded secrets found
- Strong command injection protections (SAFE_COMMAND_RE, SAFE_SHELL_RE, SHELL_META_RE, escapeAppleScript, shellQuote)
- osascript execution uses stdin piping, not string interpolation
- Config directory permissions correct (0o700/0o600)
- All dependency licenses permissive (MIT, Apache-2.0, BSD, ISC, 0BSD)
- Minor: `on-start` from CLI bypasses shell metacharacter check (W5)

### 3. Infrastructure (devops) — YELLOW

- Build succeeds (7 ESM chunks, ~67KB total)
- CI: all 5 recent runs on develop passed
- Git state clean (but 2 unpushed commits — B1)
- Package.json publish-ready (name, version, bin, files, os, engines all correct)
- Environment variables documented
- CI matrix solid (macOS, Node 18/20/22, frozen lockfile)

### 4. Architecture (architect) — GREEN

- Typecheck clean
- All dependencies current (`pnpm outdated` — none)
- No circular dependencies (11-module acyclic import graph)
- No truly dead production code (4 test-only exports are intentional)
- Minor duplication in command resolution (W11, W12)

### 5. Performance (performance-eng) — GREEN

- Build: 16ms, 67KB total (well under 100KB threshold)
- Code splitting effective: setup wizard and completions lazy-loaded
- Startup imports minimal — heavy modules loaded on demand
- Regexes pre-compiled at module level
- Filesystem reads appropriately cached
- No performance anti-patterns detected

### 6. UX/Accessibility (ux-reviewer) — GREEN

- Help text clear and comprehensive
- Error messages consistently suggest remediation actions
- Non-TTY handling thorough across all interactive paths
- NO_COLOR properly respected
- Dry-run output well-structured with metadata headers
- Shell completions comprehensive (bash + zsh)
- Minor: `summon open` doesn't re-prompt on invalid input (W9)
