# Pre-Launch Audit Report

> Generated on 2026-03-20 | Branch: `develop` | Commit: `269a016` | 6 parallel specialists

## Verdict: CONDITIONAL

No blockers found. 9 warnings across 4 domains. Ready to ship with awareness of the warnings.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | `on-start` runs arbitrary shell commands via `execSync` | WARNING | security | Mitigated by metacharacter warning + non-TTY refusal. CLI input inherently trusted. |
| W2 | `quoteCommand()` splits on spaces — mangles quoted-space args | WARNING | security | Not an injection vector (fragments are shell-quoted), but correctness issue for edge cases like `grep "hello world"`. |
| W3 | CHANGELOG `[Unreleased]` empty with 42 pending commits | WARNING | devops | Must populate before next version bump. |
| W4 | Inconsistent `Error:` prefix on error messages | WARNING | ux | Some errors prefixed, some not. Affects CLI polish. |
| W5 | Inconsistent usage hint after errors | WARNING | ux | Some error paths include `Run 'summon --help'...`, some don't. |
| W6 | `--font-size -5` shows confusing parseArgs ambiguity error | WARNING | ux | `--font-size=-5` works correctly; the space-separated form hits a parseArgs limitation. |
| W7 | `warnIfNested` exits 0 on user abort vs `Aborted.` exits 1 | WARNING | ux | Inconsistent exit code for user-declined operations. |
| W8 | `summon doctor` exit code 2 message has leading whitespace | WARNING | ux | Minor formatting inconsistency. |
| W9 | `test:coverage` script doesn't rebuild first — stale build flake | WARNING | qa | CI unaffected (builds first), but local `pnpm test:coverage` can fail after code changes. |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **993 tests, 100% pass rate**
- Typecheck: clean. Lint: clean.
- Coverage: 99.45% statements, 95.12% branches, 98.64% functions, 99.54% lines
- All 12 source files have co-located tests, all above 95% coverage
- Critical paths (script.ts, launcher.ts, tree.ts, config.ts) thoroughly covered
- Comprehensive error handling with graceful degradation throughout
- One warning: `test:coverage` should depend on `build` to avoid stale-chunk flakes

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: zero vulnerabilities
- No hardcoded secrets
- Command injection defenses: `escapeAppleScript`, `shellQuote`, `SAFE_COMMAND_RE`, `SHELL_META_RE` all sound
- Path traversal protection: `layoutPath()` uses `resolve().startsWith()` guard
- Env var keys validated at all 3 input layers (machine, project, CLI)
- Config files created with 0o600/0o700 permissions
- All dependencies are devDependencies with permissive licenses (MIT, Apache-2.0, BSD, ISC)
- Two warnings: `on-start` execSync (mitigated), `quoteCommand` space splitting (correctness, not injection)
- Two recommendations: add traversal guard to starship preset path, add first-run `.summon` trust warning

### 3. Infrastructure (devops) -- GREEN

- Build succeeds, CI green (5/5 recent runs)
- All env vars documented in README match actual `process.env` usage
- Git state clean, package.json complete (bin, engines, os, files all correct)
- .gitignore covers dist/, node_modules/, .env, credentials
- CI tests Node 18/20/22 on macOS with full verification suite
- CHANGELOG exists and well-structured
- One warning: `[Unreleased]` section empty despite 42 commits since v1.2.1
- Two recommendations: add automated publish workflow, add `credentials*.json` to .gitignore

### 4. Architecture (architect) -- GREEN

- Typecheck: zero errors
- Dependencies: all current, zero runtime deps, no conflicts
- Import graph: clean DAG, no circular dependencies
- Dead code: no dead production exports (test-only exports properly annotated with `@internal`)
- Three recommendations: consolidate accessibility messaging assembly, reduce `process.exit(1)` density in index.ts, unify layout name validation error messages

### 5. Performance (performance-eng) -- GREEN

- Bundle: ~45KB total across 12 chunks, no file over 50KB
- Startup: lazy loading well-implemented for setup, completions, keybindings
- String building: array + join pattern (optimal)
- Caching: command resolution cache, starship cache both effective
- AppleScript generation: efficient, no anti-patterns
- Two warnings: static import of launcher.ts for all subcommands (loads child_process even for --help), `detectTools` wraps sync calls in faux-async Promise.all
- Two recommendations: lazy-import launcher.ts for non-launch commands, collect tree titles during traversal

### 6. UX/Accessibility (ux-reviewer) -- YELLOW

- Help text: comprehensive, well-organized with examples and security note
- Setup wizard: solid non-TTY handling, tool detection, visual previews
- Doctor subcommand: checks Ghostty config, accessibility, configured commands
- Shell completions: thorough (zsh + bash), context-sensitive
- Color support: follows NO_COLOR standard
- Five warnings: inconsistent Error: prefix (W4), inconsistent usage hints (W5), --font-size ambiguity (W6), exit code inconsistency (W7), doctor formatting (W8)
- Notable recommendations: add version to help output, add --quiet flag, expand doctor checks (Ghostty version, config dir permissions), fix "on"/"true" default inconsistency in help text
