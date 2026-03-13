# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | Commit: `2ed5856` | 6 parallel specialists

## Verdict: CONDITIONAL

Uncommitted bug fixes (auto-resize + login shell wrapping) must be committed before release. No code-level blockers. All 117 tests pass, typecheck and lint clean, zero security vulnerabilities.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Uncommitted changes on `develop` (4 files: script.ts, launcher.ts, and their tests) | High | devops | Changes not in CI, not in release |
| W2 | Shell metacharacters in `targetDir` not escaped for shell context (`$()`, backticks) | Medium | security | Directory names with `$(cmd)` would execute in terminal via `input text` |
| W3 | Config file read 7 times per launch in `resolveConfig` (no caching) | Low | performance-eng | ~50ms unnecessary startup latency |
| W4 | Double command resolution via `execSync` (4 redundant shell spawns) | Low | performance-eng | ~40-80ms unnecessary startup latency |
| W5 | No per-subcommand `--help` flags | Low | ux-reviewer | `summon add --help` shows top-level help instead of targeted guidance |
| W6 | `--panes` validated at runtime not parse time | Low | ux-reviewer | `--panes foo` accepted then warned, not rejected |
| W7 | `ensureCommand` error always says `summon set editor` regardless of which config key | Low | ux-reviewer | Misleading if sidebar command is missing |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **117 tests across 5 files, 100% pass rate, 0 failures** (813ms)
- Typecheck: PASS | Lint: PASS
- Coverage by critical file:
  - `layout.ts`: 100% statements, 100% branches, 100% functions, 100% lines
  - `launcher.ts`: 98.37% stmts, 95.94% branches, 100% functions, 100% lines
  - `script.ts`: 98.92% stmts, 92.30% branches, 100% functions, 98.88% lines
  - `config.ts`: 97.72% stmts, 91.66% branches, 100% functions, 100% lines
  - `index.ts`: 0% direct (tested via integration tests in child process -- 11 tests cover CLI paths)
- Overall: 72.89% stmts, 65.28% branches, 92.68% functions, 73.82% lines
- Uncovered branches (all low-risk edge cases):
  - `config.ts:33` -- malformed KV line without `=`
  - `launcher.ts:59` -- command not found on PATH (graceful fallback)
  - `launcher.ts:188` -- autoResize set to non-"true" value
  - `launcher.ts:221` -- SHELL env var undefined (fallback to /bin/bash)
  - `script.ts:78` -- server-only right column with serverCommand set

### 2. Security (security-reviewer) -- YELLOW

- `pnpm audit`: zero known vulnerabilities
- No hardcoded secrets found
- All dependency licenses permissive (MIT, Apache-2.0)
- Command injection mitigated via `SAFE_COMMAND_RE` regex + `execFileSync` array form
- AppleScript injection mitigated via `escapeAppleScript` (correct escape order)
- `wrapForConfig` single-quote escaping (`'\\''`) is correct POSIX technique
- **W2**: `targetDir` passed to `sendCommand` as `cd "${targetDir}"` -- AppleScript-escaped but not shell-escaped for `$()` and backticks inside double quotes. Requires attacker to create a directory with shell metacharacters that passes `existsSync`. Low practical risk but worth hardening.

### 3. Infrastructure (devops) -- YELLOW

- Build: PASS (19.88 KB single file, ESM, shebang present, executable)
- CI: All 5 recent runs on develop passed (Release v0.2.0, CI, Dependency Review all green)
- **W1**: Git state NOT CLEAN -- 4 files with uncommitted changes (+72/-13 lines) from auto-resize fix and login shell wrapping
- Package.json: all fields correct (name, version, bin, engines, os, files, repository, license)
- `pnpm pack --dry-run`: 4 files (dist/index.js, package.json, LICENSE, README.md)
- Pre-commit hooks: proper (typecheck + lint + test via Husky)
- Claude agent guard hook: active (Error #33, #44, #48 protection)
- Env vars (`HOME`, `SHELL`): both standard POSIX with safe fallbacks, undocumented but standard

### 4. Architecture (architect) -- GREEN

- Typecheck: PASS (strict mode with `noUncheckedIndexedAccess`)
- No circular dependencies (clean DAG: index -> {config, launcher} -> {config, layout, script})
- No dead code -- all exports consumed by production code or tests
- `resetConfigCache` exported for test cleanup only (documented, acceptable)
- Dependencies: all dev-only, 3 minor bumps available (@types/node 25.5.0, vitest 4.1.0, @vitest/coverage-v8 4.1.0)
- No duplicate code patterns requiring extraction

### 5. Performance (performance-eng) -- GREEN

- Bundle: 19.88 KB raw (excellent for CLI)
- Zero runtime dependencies
- No unused exports in bundle (`resetConfigCache` correctly tree-shaken out)
- **W3**: `resolveConfig` calls `getConfig()` per key, each reading the config file from disk. 7 reads of the same tiny file. OS caches mitigate, but architecturally wasteful.
- **W4**: `ensureCommand` + `resolveFullPath` each call `resolveCommand` separately, spawning redundant `command -v` shells. 4 extra shell forks per launch.
- Sync I/O appropriate for CLI startup (one-shot tool, not a server)
- No module-load-time side effects beyond imports

### 6. UX/CLI (ux-reviewer) -- YELLOW

- Help text: clear and well-structured with examples
- Flag naming: consistent kebab-case, short flags for common options
- Exit codes: consistent (0 for success, 1 for errors across all paths)
- Error messages: clear and actionable with install hints and suggestions
- **W5**: `summon add --help` shows top-level help (global `--help` parsed before subcommand dispatch)
- **W6**: `--panes foo` accepted at parse time, warned at runtime with fallback to default
- **W7**: `ensureCommand` error message hardcodes "editor" in the `summon set` suggestion
- `--version`: works correctly, shows `0.2.0`
