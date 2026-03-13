# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | Commit: `15fc8cb` + uncommitted | 6 parallel specialists

## Verdict: CONDITIONAL

1 blocker (UX), 16 warnings across all domains, no security or architecture blockers.

## Blockers (must fix before release)

| # | Issue | Found by | Fix |
|---|-------|----------|-----|
| B1 | `summon set <key> "0"` removes key instead of storing value — `if (value)` treats `"0"` as falsy | ux-reviewer | Change `index.ts:228` from `if (value)` to `if (value !== undefined)` |

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | `config` subcommand shows "(plain shell)" for non-command keys | Medium | ux-reviewer | Confusing output |
| W2 | `config` subcommand has no empty-state message | Medium | ux-reviewer | UX gap |
| W3 | `--layout` not validated at parse time (unlike `--panes`/`--editor-size`) | Medium | ux-reviewer | Inconsistent error behavior |
| W4 | Uncommitted changes on `develop` (6 files, 95 insertions) | Medium | devops | Risk of loss |
| W5 | `index.ts` reports 0% coverage (integration tests only) | Medium | qa-lead | Coverage gap |
| W6 | Config dir created without explicit permission mode | Low | security | World-readable on shared machines |
| W7 | `command -v` via `execSync` string (mitigated by SAFE_COMMAND_RE) | Low | security | Defense-in-depth |
| W8 | Top-level `readline` import loaded on every invocation | Low | performance-eng | ~2-5ms wasted on non-launch paths |
| W9 | Outdated dev deps: vitest 4.0.18→4.1.0, @types/node 25.4.0→25.5.0 | Low | architect | Minor bumps |
| W10 | `getConfig()` has no production caller after #31 refactor | Low | architect | Dead code |
| W11 | Integration tests use real `~/.config/summon/` directory | Low | qa-lead | Non-hermetic |
| W12 | `set server` accepts any string without validation | Low | ux-reviewer | Surprising behavior |
| W13 | No branch protection on `develop` | Low | devops | Collaboration risk |
| W14 | `dismiss_stale_reviews` disabled on `main` | Low | devops | Review bypass |
| W15 | Uncovered branches in launcher.ts:194,207,226 and script.ts:102 | Low | qa-lead | Minor coverage gaps |
| W16 | Duplicate panes/editor-size validation in index.ts and launcher.ts | Low | architect, ux-reviewer | Maintenance surface |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **159/159 tests passing** across 5 test files (1.36s)
- Typecheck: clean. Lint: clean.
- Coverage: 69.8% stmts, 57.3% branches, 93.2% functions, 70.4% lines (all above thresholds)
- Critical paths (config, layout, script, launcher) all have 98-100% coverage
- `index.ts` at 0% unit coverage is the main gap — exercised by 31 integration tests via `spawnSync`
- Error handling is consistently actionable with suggested next steps

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: 0 vulnerabilities
- Zero runtime dependencies — all deps are devDependencies
- All licenses permissive (MIT, Apache-2.0, ISC, BlueOak-1.0.0)
- No hardcoded secrets found
- AppleScript escaping (`escapeAppleScript`, `shellQuote`) thoroughly tested including adversarial inputs
- `SAFE_COMMAND_RE` gates shell-interpolated `command -v` calls
- `execFileSync` with argument arrays used for installs
- osascript receives script via stdin (not CLI args)
- Defense-in-depth concerns only — no exploitable vulnerabilities

### 3. Infrastructure (devops) -- YELLOW

- Build: PASS (22.04 KB, 7ms)
- CI: all recent runs on `develop` are green
- Git: 6 uncommitted files (the bug fix from this session)
- Package: correctly configured (name, version, files, os, engines, license, prepublishOnly)
- Already published as `summon-ws@0.3.0` on npm
- Branch protection on `main`: CI required + 1 review, force push disabled
- `develop` has no branch protection (local hooks only)

### 4. Architecture (architect) -- GREEN

- Typecheck: zero errors
- No circular dependencies — clean DAG
- Dead code: `resetConfigCache` (test-only, documented), `getConfig` (orphaned after #31 refactor)
- Duplicate code: panes/editor-size validation in two places (intentionally different behavior)
- Dev deps have minor updates available (non-blocking)
- `files` field in package.json correctly restricts to `dist/` only

### 5. Performance (performance-eng) -- GREEN

- Bundle: 22.04 KB single ESM file, zero runtime deps
- Tree-shaking works: test-only exports (`resetConfigCache`, `getConfig`) eliminated
- Startup: fast exit paths for `--help`/`--version` before any I/O
- Config reads: exactly 2 per launch, no redundancy
- Command resolution: deduplicated per binary
- Only concern: top-level `readline` import (~2-5ms) on non-launch paths

### 6. UX/CLI (ux-reviewer) -- YELLOW

- Help text: clear, well-structured, covers all subcommands
- Error messages: actionable with suggested commands
- Flag consistency: short flags for common options, kebab-case longs, `--no-auto-resize` variant
- Exit codes: consistent (0 success, 1 error)
- **Blocker:** `if (value)` truthiness bug in `set` command — `"0"` treated as falsy
- **Gap:** `--layout` validated differently than `--panes`/`--editor-size` (warn vs error)
- **Gap:** `config` empty-state and non-command key labels
