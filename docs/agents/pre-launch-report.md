# Pre-Launch Audit Report
> Generated on 2026-03-13 | Branch: `develop` | Commit: `8167248` | 6 parallel specialists

## Verdict: CONDITIONAL

0 blockers, 3 warnings across all domains. All automated checks pass: typecheck clean, lint clean, 391 tests passing (100%), build succeeds (~33.5 KB across 6 chunks). Git state is clean.

## Blockers (must fix before release)

None found.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | `CLI_FLAGS` in `config.ts:109-114` missing short flags `-h`, `-v`, `-e`, `-l`, `-n` for bash completions | Low | ux-reviewer | Bash users won't discover short flags via tab completion |
| W2 | `printBanner` exported from `setup.ts:115` but never called in production code | Low | architect | Dead code; tree-shaking keeps it in lazy setup chunk (~200 bytes) |
| W3 | `SHELL` and `NO_COLOR` env vars not documented in README | Low | devops | Users won't know what influences summon's behavior |

## Recommendations

1. **Add missing short flags to `CLI_FLAGS`** in config.ts for bash completion parity with zsh (ux-reviewer)
2. **Remove or wire up `printBanner`** -- currently exported but unused in production (architect)
3. **Add "Environment Variables" section to README** documenting `SHELL` and `NO_COLOR` (devops)
4. **Consolidate validation logic** in index.ts -- CLI flag validation (lines 158-183) and `set` subcommand validation (lines 270-294) duplicate the same rules (architect)
5. **Add `develop` branch to CodeQL workflow triggers** for earlier security scanning (devops)
6. **Standardize error message prefix** -- some `console.error` + `exit(1)` paths in launcher.ts lack the `Error:` prefix used elsewhere (ux-reviewer)
7. **Soften "Unsafe SHELL" wording** to "Invalid SHELL" in launcher.ts:37 (ux-reviewer)
8. **Clarify btop layout description** in help text -- btop replaces an editor pane, not a separate pane (ux-reviewer)

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **391/391 tests passing** across 9 test files (2.80s)
- **Typecheck**: zero errors
- **Lint**: zero warnings
- **Coverage by module**:
  - `script.ts`: 38 tests -- all presets, escaping, resize, titles, edge cases
  - `layout.ts`: 33 tests -- defaults, pane distribution, presets, overrides
  - `config.ts`: 25 tests -- CRUD, permissions, injection prevention, caching
  - `launcher.ts`: ~70 tests -- config resolution, command resolution, metacharacter confirmation, SHELL validation
  - `index.ts`: ~70 integration tests -- all subcommands, flag validation, path resolution
  - `setup.ts`: ~40 tests -- wizard flow, tool detection, ANSI helpers, banner
  - `completions.ts`: 14 tests -- zsh/bash generation, subcommands, flags
  - `validation.ts`: 10 tests -- boundaries, NaN, floats
  - `utils.ts`: 26 tests -- SAFE_COMMAND_RE, resolveCommand, promptUser
- Error handling comprehensive across all modules
- No blockers or warnings

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: **0 vulnerabilities**
- **Zero runtime dependencies** -- eliminates supply chain risk
- All devDependency licenses permissive (MIT, Apache-2.0)
- No hardcoded secrets found
- **Injection analysis** (all PASS):
  - `escapeAppleScript()`: correctly escapes `\`, `"`, `\n`, `\r` for AppleScript string contexts
  - `shellQuote()`: standard POSIX single-quote escaping
  - `resolveCommand()`: uses `execFileSync` with `$1` positional parameter (no injection)
  - `executeScript()`: passes script via stdin (not `-e` flag)
  - `SAFE_COMMAND_RE`: anchored regex, comprehensive test coverage
  - `SAFE_SHELL_RE`: validates absolute paths, falls back to `/bin/bash`
  - Config file permissions: 0o700 directory, 0o600 files
  - `writeKV` strips `\n`/`\r` preventing line injection
  - `.summon` metacharacter confirmation: TTY prompt with deny-default, non-TTY refusal
- No `eval()` usage anywhere
- No blockers or warnings

### 3. Infrastructure (devops) -- GREEN

- **Build**: PASS -- 6 ESM chunks, ~33.5 KB total
- **CI**: last 5 runs on `develop` all green
- **Git**: clean working tree, up to date with `origin/develop`
- **package.json**: correctly configured -- `summon-ws` v0.4.1, `bin`, `files: ["dist"]`, `os: ["darwin"]`, `engines: >=18`, `exports`, `prepublishOnly`
- **Workflows**: CI (macos-latest, Node 18/20/22), CodeQL (weekly + main push), Dependency Review (PRs)
- `.gitignore`: comprehensive -- covers `.env*`, `.npmrc`, `*.pem`, `*.key`, sensitive paths
- WARNING: `SHELL` and `NO_COLOR` env vars undocumented in README

### 4. Architecture (architect) -- GREEN

- **Typecheck**: zero errors
- **Dependencies**: all up to date (`pnpm outdated` clean)
- **No circular dependencies** -- clean DAG
- **Module separation**: pure (layout, script, validation), side-effecting (config, launcher), entry (index), lazy (setup, completions)
- WARNING: `printBanner` exported but never called in production
- RECOMMENDATION: Validation logic duplicated between CLI flags and `set` subcommand in index.ts
- RECOMMENDATION: `SAFE_COMMAND_RE` and `resolveCommandPath` re-exported from setup.ts for test convenience

### 5. Performance (performance-eng) -- GREEN

- **Bundle**: ~33.5 KB total -- excellent for zero-dep CLI
  - `dist/index.js`: 16.05 KB (main entry)
  - `dist/setup-*.js`: 10.75 KB (lazy-loaded on first-run/`summon setup`)
  - `dist/completions-*.js`: 3.83 KB (lazy-loaded on `summon completions`)
  - Shared chunks: config (1.29 KB), layout (974 B), utils (590 B)
- **Code splitting well-executed**: setup/completions lazy-loaded, `node:readline` lazy
- **Startup path**: ~18.9 KB for common code path, no heavy I/O at module load
- **Command resolution cached**: `resolvedCache` deduplicates `resolveCommand` lookups (2-4 subprocess spawns max)
- **Tree-shaking effective**: test-only exports stripped from dist
- No performance anti-patterns detected

### 6. UX/CLI (ux-reviewer) -- GREEN

- **Help text**: well-structured with usage, options, config keys, presets, examples, security note
- **Error messages**: consistent format to stderr with actionable hints
- **Exit codes**: consistent (0 success, 1 error)
- **Per-subcommand help**: all 7 subcommands support `--help`
- **NO_COLOR support**: setup wizard respects standard
- **TTY detection**: setup wizard checks `process.stdin.isTTY` with clear fallback
- **Security UX**: `.summon` dangerous command prompt defaults to deny `[y/N]`
- **Setup wizard**: polished with tool detection, ASCII diagrams, install hints
- **Shell completions**: zsh and bash comprehensive, context-aware
- WARNING: bash completions missing 5 short flags (`-h`, `-v`, `-e`, `-l`, `-n`)

## Next Steps

1. Fix W1-W3 warnings if desired before release (all low severity)
2. `/simplify` is not needed -- code quality findings from the last `/simplify` pass were clean
3. Manual verification remaining: `summon . --dry-run` and `summon .` in Ghostty 1.3.1 for pane title visual check
