# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | Commit: `916ca84` (HEAD) | 6 parallel specialists

## Verdict: CONDITIONAL

Uncommitted changes (auto-resize default + resize repositioning) must be committed before release. No code-level blockers. All 137 tests pass, typecheck and lint clean, zero security vulnerabilities, zero runtime dependencies.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Uncommitted changes on `develop` (4 files: index.ts, layout.ts, script.ts, script.test.ts) | High | devops | Changes not in CI, not in release |
| W2 | `--auto-resize` flag is a no-op (defaults to true, flag only sets true, no `--no-auto-resize`) | Medium | ux-reviewer | Documented flag does nothing useful |
| W3 | Relative paths (e.g. `./myproject`) silently treated as project names | Medium | ux-reviewer | Confusing "Unknown project" error for valid paths |
| W4 | Root pane editor command lacks shell-level escaping for arguments | Low | security | Mitigated by SAFE_COMMAND_RE on first word; arguments after first word bypass |
| W5 | `summon set <key>` empty-value message says "will open plain shell" for all keys | Low | ux-reviewer | Misleading for numeric/boolean keys like `panes`, `auto-resize` |
| W6 | Publishing docs reference stale version 0.1.0 (current: 0.2.1) | Low | devops | Confusion during first publish |
| W7 | Duplicate validation logic for `--panes`/`--editor-size` in index.ts and launcher.ts | Low | architect | Maintainability concern, not a bug |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **137 tests across 5 files, 100% pass rate, 0 failures** (~1.15s)
- Typecheck: PASS | Lint: PASS
- Coverage by critical file:
  - `layout.ts`: 100% statements, 100% branches, 100% functions, 100% lines
  - `launcher.ts`: 99.12% stmts, 96.87% branches, 100% functions, 100% lines
  - `script.ts`: 98.92% stmts, 91.89% branches, 100% functions, 98.88% lines
  - `config.ts`: 97.72% stmts, 91.66% branches, 100% functions, 100% lines
  - `index.ts`: 0% direct (22 integration tests via child process -- v8 can't trace into subprocess)
- Overall: 69.41% stmts, 58.08% branches, 92.85% functions, 70% lines
- Uncovered branches (all low-risk):
  - `config.ts:33` -- malformed KV line without `=`
  - `script.ts:102` -- server-only right column without editor panes
- Error handling is thorough and consistent across all layers

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: zero known vulnerabilities
- Zero runtime dependencies -- excellent attack surface posture
- No hardcoded secrets found
- All dependency licenses permissive (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, BlueOak-1.0.0)
- Command injection mitigated: `SAFE_COMMAND_RE` regex + `execFileSync` array form for installs
- AppleScript injection mitigated: `escapeAppleScript` handles `\`, `"`, `\n`, `\r`
- Shell injection mitigated: `shellQuote` uses correct POSIX `'\''` technique
- `targetDir` properly protected at both layers: AppleScript escaping + `shellQuote` for cd command
- Config-launched commands go through `wrapForConfig` with `shellQuote` -- properly protected
- Script passed to `osascript` via stdin (not command-line interpolation) -- correct approach
- **W4**: Root pane editor sent via `input text` with `escapeAppleScript` only; command arguments after first word bypass `SAFE_COMMAND_RE`. Practical risk low (simulates keystrokes, not shell execution).
- String interpolation in `resolveCommand` (`execSync(\`command -v ${cmd}\`)`) mitigated by prior `SAFE_COMMAND_RE` guard -- no bypass path exists.

### 3. Infrastructure (devops) -- YELLOW

- Build: PASS (20.91 KB single ESM file, shebang present)
- CI: All 5 recent runs on `develop` passed (Release v0.2.1 and prior)
- **W1**: Git state NOT CLEAN -- 4 files with uncommitted changes (+47/-26 lines) from auto-resize default change and resize repositioning
- Package.json: all fields correct (name: summon-ws, version: 0.2.1, bin, engines >=18, os darwin, files: dist)
- `.gitignore`: covers `.env`, `*.pem`, `*.key`, `.npmrc`, `node_modules/`, `dist/`, `coverage/`, `settings.local.json`
- CI matrix: Node 18/20/22 on macos-latest, CodeQL, dependency review
- Pre-commit hooks: typecheck + lint + test via Husky
- Guard hook: active (Error #33, #44, #48 protection)
- Env vars: `HOME` and `SHELL` only, both standard POSIX with safe fallbacks
- **W6**: `docs/publishing.md` references version 0.1.0 in examples

### 4. Architecture (architect) -- GREEN

- Typecheck: PASS (strict mode with `noUncheckedIndexedAccess`)
- No circular dependencies (clean DAG: index -> {config, launcher} -> {config, layout, script})
- Import graph is strictly acyclic
- `getConfig` exported but unused in production (test-only) -- tree-shaken out of bundle
- Dependencies: all dev-only, 3 minor bumps available (routine, no security concern)
- **W7**: Validation for `panes`/`editor-size` duplicated in index.ts (hard exit) and launcher.ts (soft warning with fallback). Both serve a purpose -- index.ts guards CLI input, launcher.ts guards config file values -- but the range constants are hardcoded in both locations.
- `ResolvedConfig` interface wraps a single `{ opts }` field -- could be simplified but not a concern.

### 5. Performance (performance-eng) -- GREEN

- Bundle: 20.91 KB (excellent for CLI)
- Zero runtime dependencies confirmed
- Tree-shaking effective: `getConfig`, `resetConfigCache` absent from bundle despite being exported
- All 4 production modules properly inlined into single output file
- Sync I/O appropriate for run-once CLI (tiny config files, OS-cached)
- `ensureConfig` cache prevents redundant `mkdirSync` calls
- Command deduplication (PR #32) ensures each binary resolved exactly once
- Startup path optimal: `--version`/`--help` exit with no I/O; launch path does minimum necessary work
- Build config (tsup) is minimal and correct: single entry, ESM, node18 target, `__VERSION__` injected at build time
- No performance anti-patterns found

### 6. UX/CLI (ux-reviewer) -- YELLOW

- Help text: clear, well-structured with examples, requirements note
- Flag naming: consistent kebab-case, short flags for common options
- Exit codes: consistent (0 success, 1 error across all paths)
- Error messages: clear and actionable with install hints and suggestions
- Subcommand help: all 5 subcommands have targeted help text accessible via `--help`
- **W2**: `--auto-resize` is type boolean, defaults to true. Flag only sets `"true"` (line 271). No `--no-auto-resize` negation exists. Effectively a no-op.
- **W3**: Only targets starting with `/` or `~` recognized as paths. `./myproject` or `../other` fall through to project-name lookup and fail with confusing "Unknown project" error.
- **W5**: `summon set panes` (empty value) prints "will open plain shell" -- misleading for non-command keys.
- Minor: Options section says `(default: on)` for auto-resize while Config keys says `(default: true)`.

## Previous Audit Comparison

Warnings resolved since last audit (2026-03-13, commit `2ed5856`):
- **W2 (old)**: Shell metacharacters in `targetDir` -- FIXED (now uses `shellQuote` for cd command)
- **W3 (old)**: Config file read 7 times per launch -- FIXED (PR #31 caching)
- **W4 (old)**: Double command resolution -- FIXED (PR #32 deduplication)
- **W5 (old)**: No per-subcommand `--help` -- FIXED (subcommand help added)
- **W6 (old)**: `--panes` validated at runtime -- FIXED (PR #34 parse-time validation)
- **W7 (old)**: `ensureCommand` error hardcodes "editor" -- FIXED (PR #35)

Test count: 117 -> 137 (+20 tests added for auto-resize, shell escaping, multi-pane layouts)
