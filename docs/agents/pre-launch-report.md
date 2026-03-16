# Pre-Launch Audit Report
> Generated on 2026-03-16 | Branch: `develop` | 6 parallel specialists

## Verdict: CONDITIONAL

No code-level blockers. 3 unpushed commits must be pushed so CI validates the final code before release.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | 3 unpushed commits on develop (sidebar removal, grid limits, ANSI fix) | Medium | devops | CI hasn't validated final code |
| W2 | `on-start` config uses `execSync` with user-supplied command | Low | security | By design; `.summon` files gated by confirmation prompt |
| W3 | `.summon` files with simple command names execute without warning in untrusted dirs | Low | security | Mitigated by help text warning and SAFE_COMMAND_RE |
| W4 | `--auto-resize`/`--no-auto-resize` conflict uses `console.error` instead of `console.warn` | Low | ux-reviewer | Cosmetic inconsistency |
| W5 | Minor "preset" vs "layout preset" terminology inconsistency in completions | Low | ux-reviewer | Cosmetic |
| W6 | `isValidPreset` exported but only used in tests (not marked `@internal`) | Low | architect | No bundle impact (tree-shaken) |
| W7 | `resolveCommand` spawns shell per command lookup (mitigated by cache) | Low | performance | 2 spawns minimum on launch; cached |

## Detailed Findings

### 1. Quality Assurance (qa-lead) -- GREEN

- **795/795 tests pass** (11 test files, 5.48s)
- **Typecheck:** Clean
- **Lint:** Clean
- **Coverage:** 96.36% stmts, 90.23% branches, 98.53% functions
- All source files have co-located tests
- Lowest coverage: `setup.ts` at 93%/85% (interactive TUI paths -- requires manual testing)
- Graceful degradation verified for: missing Ghostty, missing config, missing commands, unsafe SHELL, dangerous `.summon` files, nested workspaces, non-TTY, Ctrl+C/EOF

### 2. Security (security-reviewer) -- GREEN

- `pnpm audit`: No vulnerabilities
- No hardcoded secrets
- Command injection: Well-defended (`SAFE_COMMAND_RE`, `escapeAppleScript`, `shellQuote`, `SAFE_SHELL_RE`)
- osascript: Script passed via stdin (not shell arg)
- Path traversal: Layout names validated by strict regex
- File permissions: Config `0o600`, dirs `0o700`
- Dependencies: All permissive licenses (MIT, ISC, Apache-2.0, BSD)
- `.gitignore`: Properly excludes `.env`, `.npmrc`, `*.pem`, `*.key`

### 3. Infrastructure (devops) -- GREEN

- Build succeeds (7 ESM files, ~68 KB total)
- CI: Last 5 runs on develop all pass
- Git: Clean working tree, 3 unpushed commits
- package.json: Correct name (`summon-ws`), version (`0.8.0`), bin, exports, os, engines, files
- Shebang present, dist files executable
- CHANGELOG up to date with `[Unreleased]` section
- All 5 env vars (`EDITOR`, `NO_COLOR`, `COLORTERM`, `SHELL`, `SUMMON_WORKSPACE`) documented in README
- Version bump needed before publish (currently `0.8.0`)

### 4. Architecture (architect) -- GREEN

- Typecheck: Clean
- Dependencies: All current (`pnpm outdated` -- no results)
- Circular dependencies: None (clean DAG)
- Dead code: 4 test-only exports (`isValidPreset`, `resetStarshipCache`, `resetConfigCache`, `getConfig`) -- 3 already marked `@internal`
- Minor duplicate patterns: inline `parseFloat` validation in launcher.ts, re-exports in setup.ts for test convenience

### 5. Performance (performance-eng) -- GREEN

- Bundle: 34 KB entry point, 84 KB total -- excellent for zero-dep CLI
- Code splitting: Setup wizard (21.5 KB) and completions (5.8 KB) lazy-loaded
- Startup path: Minimal top-level imports, early exits for `--help`/`--version`
- Command resolution: Cached via `resolvedCache` Map (2 spawns minimum)
- Sync I/O: Appropriate for CLI context
- No redundant computations on hot paths

### 6. UX/Accessibility (ux-reviewer) -- GREEN

- Help text: Clear and comprehensive
- Error messages: All actionable with corrective hints
- Exit codes: Correct (0 success, 1 error)
- Setup wizard: Well-designed flow with tool detection, layout diagrams, confirm-or-redo loop
- Grid builder: Intuitive key bindings (arrows, Tab, Enter, Esc), dimmed unavailable actions
- Visual previews: Well-formatted, responsive to terminal width
- Empty states: All handled with helpful hints
- Recommendations: `doctor` exit code for recommendations (not errors), truncation indicator for long commands, layout name prompt examples

## Recommendations (not blocking)

| # | Recommendation | Found by |
|---|---------------|----------|
| R1 | `doctor` exits 1 for missing recommendations -- consider exit 0 for informational output | ux-reviewer |
| R2 | Add truncation indicator (ellipsis) for long commands in layout preview | ux-reviewer |
| R3 | Add example to custom layout name prompt: `(e.g., mysetup)` | ux-reviewer |
| R4 | `summon layout show pair` gives confusing "reserved name" error -- suggest preset help | ux-reviewer |
| R5 | Mark `isValidPreset` as `@internal` to match other test-only exports | architect |
| R6 | Extract shared `parsePositiveFloat` helper for launcher.ts | architect |
| R7 | Annotate test-only re-exports in setup.ts | architect |
| R8 | `detectTools()` does serial shell spawns -- consider parallelizing if catalogs grow | performance |

## Fix Priority

1. **Push and verify CI** (W1) -- `git push` then monitor
2. **Version bump** -- bump to v1.0.0 for release
3. **Remaining warnings** -- all low severity, acceptable for v1.0.0
4. **Recommendations** -- defer to post-launch
