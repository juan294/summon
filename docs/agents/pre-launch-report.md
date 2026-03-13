# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | 6 parallel specialists

## Verdict: CONDITIONAL

Uncommitted `auto-resize` feature changes must be committed or reverted before release. No code-level blockers. All 100 tests pass, typecheck and lint clean, zero security vulnerabilities.

## Blockers (must fix before release)

| # | Issue | Severity | Found by | Fix |
|---|-------|----------|----------|-----|
| B1 | Uncommitted changes on `develop` (6 files for auto-resize feature) | High | devops | Commit to develop or stash/revert |
| B2 | `--auto-resize` missing from README CLI Flags and Config Keys tables | High | ux-reviewer, devops | Update README.md |
| B3 | `summon set` persists unknown config keys despite warning | Medium | ux-reviewer | Reject unknown keys with exit 1, or require `--force` |
| B4 | No error handling for `osascript` execution failure -- raw stack trace shown | Medium | ux-reviewer, qa-lead | Wrap `executeScript` in try/catch with user-friendly message |
| B5 | CHANGELOG.md has no `[0.1.0]` section (everything under `[Unreleased]`) | Medium | devops | Cut changelog entry for v0.1.0 |

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | `resolveConfig` exported from launcher.ts but only used in tests | Low | architect | API surface bloat |
| W2 | `execSync` for osascript has no timeout -- hangs if Ghostty unresponsive | Medium | architect, qa-lead | Process hangs indefinitely |
| W3 | Coverage thresholds conservative (60% stmts, 55% branches) | Low | architect, qa-lead | Regressions may slip through |
| W4 | Config file read 6+ times per launch (no caching in ensureConfig) | Low | performance-eng | ~200ms unnecessary startup latency |
| W5 | Sequential `execSync("command -v ...")` calls (4+ per launch) | Low | performance-eng | ~200-400ms unnecessary startup latency |
| W6 | Newline injection possible in `writeKV` config writes | Medium | security | Config file corruption via programmatic callers |
| W7 | No `unset` command for config keys | Low | ux-reviewer | Users can't remove bad keys without editing file |
| W8 | `summon add` doesn't validate path exists | Low | ux-reviewer | Error deferred to launch time |
| W9 | Uncovered branches in script.ts: server-only right column, multi-pane right column | Low | qa-lead | Untested AppleScript paths for cli preset and 4+ panes |
| W10 | `node:` prefix stripped from imports in build output | Low | performance-eng | Future ambiguity with npm packages shadowing builtins |
| W11 | `.summon` file loaded without user notification | Low | security | Malicious project config not surfaced |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **100 tests across 5 files, 100% pass rate, 0 failures**
- Typecheck: PASS | Lint: PASS
- Coverage: 68.9% stmts, 62.8% branches, 92.3% functions, 69.6% lines (all above thresholds)
- `index.ts` has 0% direct unit test coverage (mitigated by integration tests in `index.test.ts`)
- Untested branches: server-only right column (script.ts:69-74), multi-pane right column (script.ts:97-104), lazygit without brew (launcher.ts:76)
- Error handling tested for: missing Ghostty, nonexistent dir, unknown project, invalid flags, missing commands, user declining install, install failures, shell injection

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: zero known vulnerabilities
- No hardcoded secrets found
- Shell injection properly mitigated via `SAFE_COMMAND_RE` regex
- AppleScript injection mitigated via `escapeAppleScript` (correct escape order: backslash-first)
- Script passed to osascript via stdin (not shell args) -- correct
- All dependency licenses permissive (MIT, Apache-2.0, BSD, ISC)
- `.summon` file trust model matches industry convention (same as Makefile, .envrc)
- Minor: null bytes not stripped in escapeAppleScript (defense-in-depth opportunity)

### 3. Infrastructure (devops) -- YELLOW

- Build: PASS (19.23 KB single file)
- CI: All 5 recent runs on develop passed
- Git state: NOT CLEAN (6 uncommitted files for auto-resize feature)
- Package.json metadata: correct (bin, engines, os, files all verified)
- `npm pack --dry-run`: 4 files, 8.8 KB (dist/index.js, package.json, LICENSE, README.md)
- `v0.1.0` tag exists at HEAD but doesn't include uncommitted changes
- No open PR to `main` for release

### 4. Architecture (architect) -- GREEN

- Typecheck: PASS (strict mode with noUncheckedIndexedAccess)
- No circular dependencies (clean DAG: index -> config, launcher; launcher -> config, layout, script)
- No dead production exports (resolveConfig export is intentional for test visibility)
- Dependencies: all dev-only, minor bumps available (@types/node 25.5.0, vitest 4.1.0)
- Minor duplication: `console.error(); process.exit(1)` pattern (12+ occurrences) could use `fatal()` helper

### 5. Performance (performance-eng) -- GREEN

- Bundle: 19.23 KB raw, ~5.6 KB gzipped (excellent for a CLI tool)
- Zero runtime dependencies
- No unused exports in bundle
- No code splitting needed (single-entry CLI, ~400 lines app code)
- Main optimization opportunities: cache `ensureConfig` (6 redundant file reads), cache `resolveCommand` (duplicate subprocess spawns), enable `minify: true` in tsup

### 6. UX/CLI (ux-reviewer) -- YELLOW

- Help text: clear and well-structured
- Flag naming: consistent kebab-case, short flags for common options
- Exit codes: consistent (0 for success, 1 for errors)
- `summon set` persists unknown keys despite warning (should reject)
- No `unset` command for config cleanup
- `summon add` silently ignores extra args, doesn't validate path exists
- `osascript` failures show raw stack traces
- `--server` description could clarify that `true` means "plain shell"
- README missing `--auto-resize` documentation
