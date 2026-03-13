# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `refactor/rename-server-to-shell` | Commit: `da6f625` | 6 parallel specialists

## Verdict: CONDITIONAL

0 blockers, 10 warnings across all domains. All automated checks pass: typecheck clean, lint clean, 377 tests passing, build succeeds (~52 KB across 6 chunks). The branch has not yet been merged to `develop`, and a LICENSE file is missing from the repo root.

## Blockers (must fix before release)

None found.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Missing LICENSE file at repo root despite `"license": "MIT"` in package.json | Medium | devops | npm audit flag, legal compliance tools will flag this |
| W2 | `.summon` project files can execute arbitrary commands without metacharacter prompt (e.g., `editor=rm -rf ~`) | Medium | security | Design-inherent trust boundary; mitigated by help text warning |
| W3 | Custom shell command in setup wizard not validated against `SAFE_COMMAND_RE` (unlike editor/sidebar) | Low | security | User is typing interactively; lower risk but inconsistent |
| W4 | `editorSize` fraction interpolated into AppleScript relies on upstream validation only | Low | security | No injection possible given current validation, but no defense-in-depth at script layer |
| W5 | `setup.ts` branch coverage at 87.09% (interactive display/re-prompt paths) | Low | qa-lead | Regression risk for wizard summary display |
| W6 | `script.ts:141` branch gap -- `hasShell` without `shellCommand` (plain shell pane) untested | Low | qa-lead | Low risk since code path is straightforward |
| W7 | `--help` flag short-circuited by first-run setup wizard (wizard runs before help is shown) | Low | ux-reviewer | `--version` works on first run but `--help` does not -- inconsistent |
| W8 | `summon set editor ""` silently stores empty string; validation only at launch time | Low | ux-reviewer | Confusing deferred error |
| W9 | Shebang `#!/usr/bin/env node` applied to all chunk files, not just entry point | Low | performance | Cosmetic; no runtime impact but technically incorrect |
| W10 | Current branch `refactor/rename-server-to-shell` not yet merged to `develop` | Medium | devops | Must merge before any release steps |

## Recommendations

1. **Add a root LICENSE file** matching the MIT declaration in package.json (devops)
2. **Add `"exports"` field to package.json** -- `{ ".": "./dist/index.js" }` for explicit module resolution (devops)
3. **Consolidate readline pattern in `setup.ts`** -- `numberedSelect()`, `confirm()`, and `selectToolFromCatalog()` each create readline interfaces independently; extract a shared helper (architect)
4. **Rename `COMMAND_KEYS`** in `index.ts` or `launcher.ts` to avoid naming overlap with different semantics (architect)
5. **Add tests for uncovered branches** -- `printSummary` with `shell="true"`, non-minimal layout `runSetup`, `askCustom` invalid input, `generateAppleScript` with `hasShell` + no `shellCommand` (qa-lead)
6. **Document `.summon` trust model more prominently** in README security section (security)
7. **Fix shebang banner** in tsup config to target only the entry file (performance)
8. **Consider enabling minification** -- could reduce 52 KB total to ~30-35 KB (performance)
9. **Add short flag for `--shell`** (e.g., `-S`) for ergonomic parity with other flags (ux-reviewer)
10. **Add config key type hints to `--help` output** (e.g., `panes <int>`, `auto-resize <bool>`) (ux-reviewer)
11. **Consider `treeshake: true`** in tsup config for tighter output (performance)
12. **Verify CHANGELOG.md `[Unreleased]` section** is correct before next release (devops)

## Detailed Findings

### 1. Architecture (architect) -- GREEN

- **Typecheck**: zero errors
- **Dependencies**: all up to date (`pnpm outdated` shows nothing)
- **No circular dependencies** -- clean DAG with leaf modules (`config.ts`, `layout.ts`, `utils.ts`, `validation.ts`) having zero internal imports
- **No dead code**: every export consumed by at least one production module. Two test-only exports (`resetConfigCache`, `getConfig`) properly annotated `@internal`
- **Near-duplication noted**: `COMMAND_KEYS` defined in both `index.ts:79` (array, for display) and `launcher.ts:27` (Set, for security validation) -- different semantics justify separate definitions but naming overlap could cause confusion
- **Readline boilerplate** repeated 3 times in `setup.ts` (`numberedSelect`, `confirm`, `selectToolFromCatalog`) -- consolidation opportunity
- Clean module separation: pure (layout, script, validation), side-effecting (config, launcher), entry (index), lazy (setup, completions)

### 2. Quality Assurance (qa-lead) -- GREEN

- **377/377 tests passing** across 9 test files
- **Typecheck**: zero errors
- **Lint**: zero warnings
- **Coverage**: 98.95% statements, 94.73% branches, 100% functions, 99.07% lines
- Critical paths (config, layout, launcher, utils, validation, completions) all at **100% coverage**
- `script.ts` at 100% statements / 97.43% branches -- gap is `hasShell` without `shellCommand` at line 141
- `setup.ts` at 97.41% statements / 87.09% branches -- gaps are interactive display paths (lines 484-489, 569, 573, 663)
- Error handling comprehensive: every `process.exit(1)` preceded by meaningful stderr message
- No unguarded error paths found

### 3. Security (security-reviewer) -- GREEN

- `pnpm audit`: **0 vulnerabilities**
- **Zero runtime dependencies** -- eliminates supply chain risk
- All devDependency licenses permissive (MIT, Apache-2.0) -- no conflicts
- No hardcoded secrets found anywhere in source tree
- **Positive findings**:
  - `executeScript` passes AppleScript via stdin (not `-e` flag) -- prevents shell interpolation
  - `resolveCommand` uses `execFileSync` with argument array + `$1` positional parameter
  - `SAFE_COMMAND_RE` is sound: anchored, no bypasses found, comprehensive test coverage
  - `SAFE_SHELL_RE` validates `process.env.SHELL` with strict regex, falls back to `/bin/bash`
  - `escapeAppleScript()` and `shellQuote()` well-implemented, tested with adversarial inputs
  - Config file permissions: 0o700 directory, 0o600 files
  - No `eval()` usage anywhere in codebase
  - `KNOWN_INSTALL_COMMANDS` limited to hardcoded allowlist (npm/brew)
  - `writeKV` strips `\n` and `\r` preventing KV line injection
- `.summon` trust model follows Makefile/direnv pattern -- documented in help text

### 4. Performance (performance-eng) -- GREEN

- **Bundle**: 52 KB across 6 files -- excellent for zero-dep CLI
  - `dist/index.js`: 24.43 KB (main entry)
  - `dist/setup-KLZXQUIG.js`: 17.05 KB (lazy-loaded)
  - `dist/completions-QI5LEGKR.js`: 4.14 KB (lazy-loaded)
  - Shared chunks: config (2.59 KB), layout (1.74 KB), utils (932 B)
- **Code splitting working correctly**: setup (17 KB) only loads on first-run/`summon setup`, completions (4 KB) only on `summon completions`
- **Startup path**: most invocations load ~31 KB (index + 3 shared chunks)
- **Sync I/O appropriate**: small config files (~100 bytes), `configEnsured` flag prevents redundant calls
- **Command resolution cached**: `resolvedCache` Map deduplicates lookups
- **String building efficient**: `lines.join("\n")` pattern (not repeated concatenation)
- **Tree-shaking effective**: test-only exports (`resetConfigCache`, `getConfig`) stripped from dist
- No performance anti-patterns detected

### 5. UX/CLI (ux-reviewer) -- GREEN

- **Help text**: well-structured with usage, options, config keys, presets, examples, security note
- **Error messages**: consistent `Error: <message>` format to stderr with actionable hints
- **Exit codes**: consistent (0 success, 1 error)
- **Per-subcommand help**: all subcommands support `--help`
- **NO_COLOR support**: setup wizard respects `NO_COLOR` environment variable
- **TTY detection**: setup wizard checks `process.stdin.isTTY` with clear fallback message
- **Security UX**: `.summon` dangerous command prompt defaults to deny `[y/N]` -- safe default
- **Setup wizard**: save confirmation defaults to accept `[Y/n]` -- appropriate for settings
- **Progressive disclosure**: brief usage on no-args vs full `--help`
- **Shell completions**: both zsh and bash are comprehensive, context-aware, dynamically read project names
- **Validation at set time**: `summon set panes abc` rejected immediately
- **Positive**: 10 items of good UX practice documented by reviewer

### 6. Infrastructure (devops) -- GREEN

- **Build**: PASS -- 6 ESM chunks, ~52 KB total, 10ms build time
- **CI**: last 5 runs on `develop` all green (most recent: 46s, 2026-03-13)
- **Git**: clean working tree, no uncommitted changes
- **Package.json**: correctly configured -- `summon-ws` v0.4.0, `files: ["dist"]`, `os: ["darwin"]`, `engines: >=18`, `bin`, `prepublishOnly`
- **.gitignore**: comprehensive -- covers `node_modules`, `dist`, `.env*`, `.DS_Store`, `*.tgz`, `coverage`, `.npmrc`, `*.pem`, `*.key`, `.vscode`, `.worktrees`, `.claude/*` (with whitelisted exceptions)
- **Environment variables**: `process.env.NO_COLOR` and `process.env.SHELL` both documented and validated
- **Workflows**: CI (macos-latest, Node 18/20/22 matrix), CodeQL (weekly + push), Dependency Review (PRs)
- **Gap**: missing LICENSE file, missing `exports` field in package.json

## Next Steps

1. **W1 (devops)**: Add MIT LICENSE file to repo root before npm publish
2. **W10 (devops)**: Merge `refactor/rename-server-to-shell` branch to `develop`
3. **W7 (ux)**: Move `--help` check before first-run wizard gate in `index.ts`
4. Consider running `/simplify` to address architect recommendations (readline consolidation, naming clarity)
5. Consider adding the 4 test cases recommended by qa-lead to close branch coverage gaps
