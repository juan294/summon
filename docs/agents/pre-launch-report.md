# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | Commit: `54217cb` + uncommitted lazygit fix | 6 parallel specialists

## Verdict: CONDITIONAL

No blockers. 2 uncommitted files (lazygit working-directory fix). All checks pass: typecheck, lint, 197 tests, build (24.11 KB).

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Uncommitted changes on `develop` (lazygit fix: `script.ts`, `script.test.ts`) | High | devops | Must commit before release |
| W2 | `config` subcommand: `if (value)` treats `"0"` as falsy in display | Low | ux-reviewer | Cosmetic — `"0"` is not valid for any config key |
| W3 | `summon set server` hint triggers for valid single-word commands | Low | ux-reviewer | Slightly misleading hint |
| W4 | `summon set panes`/`editor-size`/`layout` accept invalid values | Low | ux-reviewer | Error deferred to launch time |
| W5 | `executeScript` swallows osascript error details | Low | ux-reviewer | Harder to debug AppleScript failures |
| W6 | `.summon` trust model is advisory only (no confirmation prompt) | Low | security | Documented tradeoff (like Makefiles) |
| W7 | `command -v` via `execSync` string (mitigated by SAFE_COMMAND_RE) | Low | security | Defense-in-depth |
| W8 | Coverage thresholds conservative (branches: 55%) | Low | qa-lead | Acceptable given index.ts exclusion |
| W9 | All modules loaded eagerly for `--version`/`--help` | Low | performance | ~few ms, negligible for CLI |
| W10 | `getConfig()` has no production caller after #31 refactor | Low | architect | Dead code (test-only) |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **197/197 tests passing** across 6 test files (1.93s)
- **Typecheck**: zero errors
- **Lint**: zero warnings
- **Build**: 24.11 KB, 7ms
- Coverage thresholds met: statements 60%, branches 55%, functions 85%, lines 60%
- Critical paths (config, layout, script, launcher) all have high coverage
- `index.ts` excluded from v8 coverage — tested via 47 subprocess integration tests
- Minor untested branches: empty KV file content, lines without `=`, `..` target resolution, `expandHome` in `add` subcommand

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: **0 vulnerabilities**
- **Zero runtime dependencies** — all deps are devDependencies
- All licenses permissive (MIT, Apache-2.0, BSD-2/3-Clause, ISC, BlueOak-1.0.0)
- No hardcoded secrets found anywhere in `src/`
- `.gitignore` excludes `.env`, `.env.*`, `.npmrc`, `*.pem`, `*.key`
- AppleScript injection defenses: `escapeAppleScript()` + `shellQuote()` thoroughly tested with adversarial inputs (`$()`, backticks, `$(rm -rf /)`, single quotes, newline injection)
- `SAFE_COMMAND_RE` validates binary names before `execSync` interpolation
- `execFileSync` with argument arrays used for install commands
- osascript receives script via stdin (not CLI args)
- Config file newline injection prevented by `writeKV` sanitization
- File permissions: 0o700 for config dir, 0o600 for config files

### 3. Infrastructure (devops) -- YELLOW

- **Build**: PASS (24.11 KB single ESM file, 7ms)
- **CI**: all 5 recent runs on `develop` are green (completed successfully)
- **Git**: 2 uncommitted files — the lazygit working-directory fix (`script.ts`, `script.test.ts`)
- **Dependencies**: all up to date (`pnpm outdated` shows nothing)
- **Package**: correctly configured (name, version, files, os, engines, license, prepublishOnly)
- **Branch protection on `main`**: CI required + 1 review, force push disabled
- `develop` has no branch protection (local hooks only — pre-commit: typecheck + lint + test)

### 4. Architecture (architect) -- GREEN

- **Typecheck**: zero errors
- **No circular dependencies** — clean DAG (layout.ts and script.ts are pure with no project imports)
- **No outdated dependencies**
- **Dead code**: `resetConfigCache` (test-only, documented), `getConfig` (orphaned after #31 refactor — test-only)
- **Bundle**: correctly restricted to `dist/` only via `files` field in package.json
- **Module structure**: clean separation — pure functions (layout, script, validation), side-effecting modules (config, launcher), CLI entry point (index)
- 2 test-only exports (`resetConfigCache`, `getConfig`) included in bundle but combined ~100 bytes — negligible

### 5. Performance (performance-eng) -- GREEN

- **Bundle**: 24.11 KB single ESM file, zero runtime dependencies — excellent for CLI
- **Build time**: 7ms (tsup/esbuild)
- **String building**: efficient array-push + join pattern in `generateAppleScript`
- **Config reads**: exactly 2 per launch, no redundancy
- **Command resolution**: deduplicated per binary via cache
- **`prompt()` uses dynamic import** — `readline` only loaded when needed (missing command prompt)
- Eager module loading for `--version`/`--help` is the only optimization opportunity (~few ms, not worth the complexity)
- `shellQuote(targetDir)` hoisted to avoid recomputation in closures (applied via /simplify)

### 6. UX/CLI (ux-reviewer) -- GREEN

- **Help text**: well-structured with clear sections (Usage, Options, Config keys, Presets, Per-project config, Requirements, Examples)
- **Security note**: `.summon` trust warning in help text
- **Error messages**: actionable with suggested commands (e.g., "Register it with: summon add")
- **Flag consistency**: short flags for common options (`-l`, `-e`, `-n`, `-h`, `-v`), kebab-case longs, `--no-auto-resize` boolean variant
- **Exit codes**: consistent (0 success, 1 error), `--help`/`--version` exit 0, no-args exits 1
- **Subcommand help**: all 5 subcommands have per-subcommand `--help`
- **`--no-auto-resize` wins** when both `--auto-resize` and `--no-auto-resize` given (with warning)
- **`--dry-run` output goes to stdout** (correct for piping)
- Minor gaps: `set` doesn't validate values at write time (deferred to launch), server hint triggers for valid single-word commands
