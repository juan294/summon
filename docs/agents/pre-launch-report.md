# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | Commit: `56f3c77` | 6 parallel specialists

## Verdict: CONDITIONAL

1 blocker (UX), 13 warnings across all domains. All automated checks pass: typecheck, lint, 312 tests, build (~47 KB across 6 chunks).

## Blockers (must fix before release)

| # | Issue | Found by | Location |
|---|-------|----------|----------|
| B1 | No-argument invocation dumps full 60+ line help to stderr instead of a brief usage hint | ux-reviewer | `src/index.ts:213` |

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | `launcher.ts` hand-rolls parseInt + range validation already provided by `parseIntInRange()` | Medium | architect | Code duplication, divergent behavior risk |
| W2 | `prompt()` in `launcher.ts` duplicates readline pattern from `setup.ts` | Low | architect | Dual maintenance |
| W3 | `setup.ts` non-TTY guard untested | Low | qa-lead | Safety net for non-interactive environments |
| W4 | `setup.ts` user-decline loop untested | Low | qa-lead | Important UX flow without coverage |
| W5 | `setup.ts` branch coverage at 78.82% (display paths) | Low | qa-lead | Regression risk for wizard output |
| W6 | `.summon` file can inject shell commands via argument positions | Low | security | Inherent to the design; documented in help text |
| W7 | `process.env.SHELL` used without validation | Low | security | Attacker with env control already has code execution |
| W8 | `--panes` and `--sidebar` lack short flags while peer flags have them | Low | ux-reviewer | Asymmetric CLI ergonomics |
| W9 | `--dry-run` output uses unresolved command names, not actual paths | Low | ux-reviewer | Debugging surprise |
| W10 | `numberedSelect` and `confirm` silently re-prompt on invalid input | Low | ux-reviewer | No feedback on bad input in wizard |
| W11 | Config key description for `server` says "toggle" but also accepts commands | Low | ux-reviewer | Inconsistent documentation |
| W12 | Dirty working tree (`.gitignore` has uncommitted change) | Medium | devops | Must be clean before release |
| W13 | `script.ts` sidebar-is-falsy branch not directly tested | Low | qa-lead | Minor gap in script generation coverage |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **312/312 tests passing** across 9 test files (~2.6s)
- **Typecheck**: zero errors
- **Lint**: zero warnings
- **Coverage**: 96.18% statements, 91.15% branches, 100% functions, 96.15% lines
- Critical paths (config, layout, script, launcher, utils, validation, completions) all at **100% statement/line coverage**
- `setup.ts` at 90.61% statements, 78.82% branches -- gaps are display-only paths and interactive flows
- `index.ts` tested via 65+ subprocess integration tests (not in v8 report due to subprocess boundary)

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: **0 vulnerabilities**
- **Zero runtime dependencies** -- all deps are devDependencies
- All licenses permissive (MIT, Apache-2.0, BSD-2/3-Clause, ISC, BlueOak-1.0.0)
- No hardcoded secrets found
- AppleScript injection defenses: `escapeAppleScript()` + `shellQuote()` tested with adversarial inputs
- `SAFE_COMMAND_RE` validates binary names before shell contact -- no bypass found
- `execFileSync` with argument arrays for install commands; osascript via stdin
- Config file permissions: 0o700 dir, 0o600 files
- `.summon` trust model is advisory (same as Makefile/direnv) -- documented in help text and README

### 3. Infrastructure (devops) -- YELLOW

- **Build**: PASS (6 ESM files, ~47 KB total)
- **CI**: recent runs on `develop` are green
- **Git**: `.gitignore` has uncommitted change
- **Dependencies**: all up to date (`pnpm outdated` shows nothing)
- **Package**: correctly configured (name `summon-ws`, version `0.3.2`, files `["dist"]`, os `["darwin"]`, engines `>=18`)
- **Branch protection on `main`**: CI required + 1 review, force push disabled
- **Shebang**: verified `#!/usr/bin/env node` as first line of `dist/index.js`
- **Version injection**: `__VERSION__` replaced at build time from `package.json`
- `enforce_admins` disabled on `main` (admins can bypass protections)

### 4. Architecture (architect) -- GREEN

- **Typecheck**: zero errors
- **No circular dependencies** -- clean DAG
- **No outdated dependencies**
- **Dead code**: `cyan()` in setup.ts (never called in production), `ParseIntResult` type (internal only), redundant re-exports from setup.ts (`resolveCommandPath`, `SAFE_COMMAND_RE`)
- Test-only exports (`resetConfigCache`, `getConfig`) annotated `@internal`, ~70 bytes in bundle
- Clean module separation: pure (layout, script, validation), side-effecting (config, launcher), entry (index), lazy (setup, completions)

### 5. Performance (performance-eng) -- GREEN

- **Bundle**: 47 KB across 6 files -- excellent for zero-dep CLI
- **Code splitting**: setup.ts (14.88 KB) and completions.ts (4.19 KB) correctly lazy-loaded via dynamic import
- **Shared chunks**: config (2.58 KB), layout (1.76 KB), utils (604 B) properly extracted
- **Startup path**: minimal -- `existsSync` + `parseArgs` + flag validation, no heavy I/O
- **Config reads**: exactly 2 per launch (`.summon` + machine config), no redundancy
- **Command resolution**: cached per binary via `resolvedCache` Map
- **Sync I/O**: appropriate for run-and-exit CLI pattern
- No performance anti-patterns found (no redundant computations, no unbounded structures, no hot-path bloat)

### 6. UX/CLI (ux-reviewer) -- YELLOW

- **Help text**: well-structured with usage, options, config keys, presets, examples, security note
- **Error messages**: clear and actionable with suggested commands
- **Flag consistency**: good overall -- short flags for common options, `--no-` prefix for negation
- **Exit codes**: consistent (0 success, 1 error)
- **Subcommand help**: all subcommands have per-subcommand `--help`
- **Setup wizard**: well-designed with tool detection, ASCII diagrams, confirm loop, validation
- **Blocker**: no-argument invocation dumps full help to stderr (should be brief usage hint)
- **Gaps**: missing short flags for `--panes`/`--sidebar`, silent re-prompt on invalid wizard input, `--dry-run` uses unresolved names

## Recommendations (not blocking)

| # | Finding | Found by |
|---|---------|----------|
| R1 | Document `NO_COLOR` env var support in help or README | devops |
| R2 | Enable `enforce_admins` on `main` branch protection | devops |
| R3 | Enable `dismiss_stale_reviews` on `main` branch protection | devops |
| R4 | Add context header/summary to `--dry-run` output | ux-reviewer |
| R5 | Extract Ghostty existence check to `isGhosttyInstalled()` in utils.ts | architect |
| R6 | Remove unused `cyan()` export from setup.ts | architect, performance-eng |
| R7 | Tests should import `SAFE_COMMAND_RE`/`resolveCommandPath` from utils.ts directly, not setup.ts re-exports | architect, performance-eng |
| R8 | Consider `.summon` file fingerprinting for change detection | security |
| R9 | Validate `process.env.SHELL` format before use in AppleScript | security |
| R10 | Cache `getPresetNames()` as module constant instead of `Object.keys()` on each call | performance-eng |

## Next Steps

- **B1 (UX blocker)**: Replace `console.error(HELP)` with a brief usage hint when no arguments provided
- **W1 (architect)**: Refactor `launcher.ts` parseInt validation to use `parseIntInRange()` from `validation.ts`
- **W12 (devops)**: Commit or revert `.gitignore` change before release
- Consider running `/simplify` to address architect and performance-eng findings (code duplication, dead exports)
