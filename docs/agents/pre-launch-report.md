# Pre-Launch Audit Report
> Generated on 2026-03-17 | Branch: `develop` | 6 parallel specialists | Pre-v1.2.1

## Verdict: CONDITIONAL

One expected warning (unpushed commit awaiting release). No blockers. All systems green.

## Blockers (must fix before release)
None.

## Warnings
| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | 1 unpushed commit on `develop` (theme removal hotfix) | medium | devops | Must push before release PR |
| W2 | Duplicated env-var-name regex in index.ts:422 vs launcher.ts ENV_KEY_RE | low | architect, performance-eng | Logic divergence risk |
| W3 | Weak `.toBeTruthy()` assertions in setup.test.ts (8 uses) | low | qa-lead | Won't catch type regressions |
| W4 | launcher.ts branch coverage 91.91% — tree layout + project CWD merge path untested | low | qa-lead | Uncovered runtime path |
| W5 | `on-start` uses `execSync` (shell mode) — by-design but worth noting | low | security-reviewer | Same trust model as Makefile |
| W6 | Branch protection `enforce_admins: false` on main | low | devops | Admins can bypass checks |
| W7 | `--fix` and `--vim` missing from CLI_FLAGS array | low | ux-reviewer | Bash completion gap (zsh OK) |
| W8 | Unicode arrow `→` in index.ts output without fallback | low | ux-reviewer | Cosmetic; Ghostty renders fine |

## Recommendations
| # | Suggestion | Found by |
|---|-----------|----------|
| R1 | Extract ENV_KEY_RE to shared constant in utils.ts or validation.ts | architect, performance-eng |
| R2 | Strengthen `.toBeTruthy()` to `.toBeTypeOf('string')` in setup.test.ts | qa-lead |
| R3 | Add test for tree layout + project CWD merge path (launcher.ts:441-443) | qa-lead |
| R4 | Consider `--yes`/`--no-confirm` flag for CI automation use cases | security-reviewer |
| R5 | Split EDITOR validation on first space to allow `code --wait` | security-reviewer |
| R6 | Document .summon trust model in dedicated README security section | security-reviewer |
| R7 | Mark all test-only exports with consistent `@internal` JSDoc tag | architect |
| R8 | Cache `listStarshipPresets()` result for repeated calls | performance-eng |
| R9 | Enable `enforce_admins` and `dismiss_stale_reviews` on main branch protection | devops |
| R10 | Add `--fix`/`--vim` to CLI_FLAGS for bash completion consistency | ux-reviewer |
| R11 | Show effective defaults in `summon config` when no machine config set | ux-reviewer |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN
- **945 tests**, all passing, 0 skipped
- **Typecheck:** clean, **Lint:** clean
- **Coverage:** 98.98% statements, 94.12% branches, 98.60% functions, 99.22% lines
- Critical files all at 98-100% coverage
- Uncovered: setup.ts SIGINT handler (interactive-only), tree.ts defensive throw, launcher.ts tree+CWD merge branch
- 8 weak `.toBeTruthy()` assertions in setup.test.ts

### 2. Security (security-reviewer) — GREEN
- `pnpm audit`: no known vulnerabilities, zero runtime deps
- No hardcoded secrets found
- osascript execution uses stdin (`execFileSync` with `input`), not shell args — safe
- AppleScript escaping (`escapeAppleScript`, `shellQuote`) correctly implemented
- `confirmDangerousCommands` catches shell metacharacters in `.summon` files
- `SAFE_COMMAND_RE`, `SAFE_SHELL_RE`, `ENV_KEY_RE` properly guard all injection vectors
- `layoutPath()` prevents path traversal with resolve+prefix check
- File permissions: config dir 0o700, files 0o600 — correct
- All dependency licenses permissive (MIT, Apache-2.0, ISC)

### 3. Infrastructure (devops) — YELLOW
- Build succeeds (14ms, 75KB total output)
- CI: all recent runs green on develop
- CI config: Node [18, 20, 22] matrix, CodeQL, dependency review — solid
- Package metadata: correct (name, version, bin, files, engines, os, license)
- Env vars: full parity between documented (5) and used (5)
- **1 unpushed commit** (theme removal) — expected, will push with release
- Branch protection on main: required checks + 1 review, but `enforce_admins: false`

### 4. Architecture (architect) — GREEN
- Typecheck: clean
- Dependencies: all up to date
- No circular dependencies — clean DAG
- No dead code (test-only exports properly annotated with `@internal`)
- Module boundaries clean: layout planning → script generation → execution
- Dynamic imports for heavy modules (setup, completions, keybindings)
- 1 duplicated regex (ENV_KEY_RE) — minor DRY violation

### 5. Performance (performance-eng) — GREEN
- Build: 14ms, 75KB total (12 chunks, code-split)
- Entry chunk: 35KB, setup lazy-loaded (22KB), completions lazy-loaded (6KB)
- All regexes compiled at module level (constants)
- String building uses array push + join — optimal
- Sync file I/O appropriate for one-shot CLI
- `resolveCommand` results cached in launcher
- Starship path cached, config dir ensured once
- No anti-patterns found

### 6. UX/Accessibility (ux-reviewer) — GREEN
- Help text: all 13 subcommands documented, consistent formatting, practical examples
- Error messages: consistent `Error: <description>` + actionable guidance pattern
- Exit codes: 0 (success), 1 (error), 2 (doctor issues), 130 (Ctrl+C) — all correct
- Setup wizard: handles no-Ghostty, Ctrl+C, invalid input, non-TTY, decline-and-retry
- NO_COLOR support via `useColor` flag, all ANSI output goes through `wrap()`
- True color detection with graceful fallback
- Screen reader compatible (no emoji-only messages)
- Tab completion: zsh fully working, bash minor gap for subcommand-specific flags
