# Pre-Launch Audit Report

> Generated on 2026-03-12 | Branch: `develop` | 6 parallel specialists

## Verdict: CONDITIONAL

One security blocker must be fixed before publishing. Otherwise the project is in excellent shape.

## Blockers (must fix before release)

| # | Issue | Found by | Fix |
|---|-------|----------|-----|
| B1 | **Command injection in `isCommandInstalled`** — user input from config/CLI interpolated directly into `execSync` template literal. A malicious `.summon` file in a cloned repo could execute arbitrary shell commands via `editor`, `sidebar`, `server`, or `secondaryEditor` values. | security-reviewer | Use `execFileSync("command", ["-v", cmd])` or validate `cmd` against `[a-zA-Z0-9_-]+` before shell interpolation. |

**Location:** `src/launcher.ts:34` — `execSync(\`command -v ${cmd}\`)`

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | Incomplete AppleScript escaping — newlines/CR not handled. User-supplied commands with `\n` could break out of AppleScript string literals. | Medium | security-reviewer | Low practical risk but defense-in-depth gap. |
| W2 | `cli` preset hardcodes `server: "npm login"` — confusing for a general-purpose preset name. | Medium | ux-reviewer | User confusion, poor first impression. |
| W3 | `index.ts` (CLI entry point, ~220 lines) has zero test coverage. Argument parsing, subcommand routing, and target resolution are untested. | Medium | qa-lead | Regressions in CLI behavior could slip through. |
| W4 | `execSync(installCmd)` at `launcher.ts:89` uses shell string instead of `execFileSync` with args. Currently safe (hardcoded map) but fragile. | Low | security-reviewer | No immediate risk; code hygiene. |
| W5 | `getConfig()` called 5x in `resolveConfig`, each re-reading config file + `ensureConfig` overhead (mkdirSync + 2x existsSync). | Low | performance-eng | Negligible for a run-once CLI; code quality issue. |
| W6 | Dead exports: `PresetName` (`layout.ts:41`), `ResolvedConfig` (`launcher.ts:105`) — exported but unused outside tests. | Low | architect | API surface clutter; no runtime impact. |
| W7 | No-argument invocation (`summon` with no target) exits with code 0. Could confuse scripts expecting non-zero for "no action taken." | Low | ux-reviewer | Design choice, not a bug. |
| W8 | No coverage thresholds configured in `vitest.config.ts`. Coverage can silently regress. | Low | qa-lead | Future-proofing concern. |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN

- **76/76 tests pass** (100%) in 149ms across 4 test files
- Typecheck: clean (tsc --noEmit)
- Lint: clean (eslint src/)
- Build: clean (16.53 KB bundle)
- Critical paths (config, layout, script, launcher) all well-tested
- Graceful degradation verified: missing config, invalid values, missing Ghostty, missing commands all handled
- **Gap:** `index.ts` entry point has no tests (W3)

### 2. Security (security-reviewer) — RED

- **BLOCKER: Command injection** at `launcher.ts:34` via `execSync(\`command -v ${cmd}\`)` (B1)
- AppleScript escaping misses newlines (W1)
- Install command execution uses shell string (W4)
- Zero runtime dependencies — excellent attack surface
- No hardcoded secrets found
- No `.env` files, no tokens, no SSH keys
- All dependency licenses are MIT/Apache-2.0 compatible
- `files: ["dist"]` correctly limits published package

### 3. Infrastructure (devops) — GREEN

- CI: 5/5 recent runs on `develop` all passing
- CI workflow covers: typecheck, lint, test, build on Node 18/20/22 (macos-latest)
- Additional workflows: CodeQL (weekly), dependency-review (on PRs)
- Git state: clean working tree, develop up-to-date with origin
- Pre-commit hooks: typecheck + lint + test via Husky
- Guard-bash hook: blocks dirty pulls, --tags, push to main
- Package publish config: all fields present and correct
- Shebang correctly injected by tsup
- Only env var: `process.env.HOME` with fallback (standard)

### 4. Architecture (architect) — GREEN

- Clean DAG: `index → launcher → {config, layout, script}`, no cycles
- TypeScript strict mode with `noUncheckedIndexedAccess`
- All exports consumed except two type exports (W6)
- Minimal code duplication (integer validation pattern repeated twice in `resolveConfig`)
- Well-factored separation: layout planning (pure) → script generation (pure) → execution

### 5. Performance (performance-eng) — GREEN

- Bundle: **16.53 KB** single ESM file — tiny
- Zero runtime dependencies bundled
- Startup: stdlib-only imports, `--help`/`--version` exit before any I/O
- String building: array + join pattern (correct)
- Early returns: properly applied throughout
- Stale `dist/index 2.js` was cleaned by tsup's `clean: true` on rebuild
- Redundant config reads in `resolveConfig` (W5) — negligible for CLI

### 6. UX/CLI (ux-reviewer) — YELLOW

- Help text: comprehensive, well-structured (usage, options, config keys, presets, examples, requirements)
- Version output: clean `0.1.0`
- Error messages: actionable throughout — every error tells what went wrong and how to fix it
- Exit codes: correct (0 for help/version, 1 for errors), except bare invocation exits 0 (W7)
- Flag naming: consistent kebab-case, standard short flags for `-h`, `-v`, `-l`
- **Issue:** `cli` preset defaults to `npm login` as server command (W2)
- No `--dry-run` flag (recommendation for a tool that executes AppleScript)

## Recommendations (nice to have, not blocking)

| # | Recommendation | Found by |
|---|----------------|----------|
| R1 | Add `--dry-run` flag to print generated AppleScript without executing | ux-reviewer |
| R2 | Add coverage thresholds to `vitest.config.ts` | qa-lead |
| R3 | Run `pnpm outdated` before release to verify dependency freshness | architect |
| R4 | Add `summon list` suggestion to `summon remove <nonexistent>` error | ux-reviewer |
| R5 | Improve help tagline to "Launch multi-pane Ghostty workspaces" for clarity | ux-reviewer |
| R6 | Add integration tests for `index.ts` CLI parsing | qa-lead |
| R7 | Extract `parseIntOption()` helper in `launcher.ts` to deduplicate validation | architect |
| R8 | Hoist regex literals in `escapeAppleScript` to module scope | performance-eng |

## Next Steps

1. **Fix B1** (command injection) — required before publish
2. **Fix W1** (AppleScript newline escaping) — strongly recommended
3. **Fix W2** (`cli` preset server command) — recommended for good UX
4. Consider running `/simplify` to address W4-W6 and R7-R8 (code quality findings)
5. Then proceed with the `docs/publishing.md` checklist: tarball test, manual Ghostty test, `npm publish`
