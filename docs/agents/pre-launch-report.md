# Pre-Launch Audit Report
> Generated on 2026-03-15 | Branch: `develop` | 6 parallel specialists

## Verdict: CONDITIONAL

One blocker (unpushed commit — must push and verify CI). No code-level blockers. 10 warnings across 5 specialists, all non-critical.

## Blockers (must fix before release)

| # | Issue | Found by | Fix |
|---|-------|----------|-----|
| 1 | Unpushed commit `9eac136` on develop (+1328 lines) — CI has not run on this code | DevOps | `git push` and verify CI passes |

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| 1 | CHANGELOG `[Unreleased]` missing visual layout builder feature | Medium | DevOps | Release notes incomplete |
| 2 | `execSync` for `on-start` — shell-interpreted user input | Medium | Security | Mitigated by `confirmDangerousCommands` prompt |
| 3 | `.summon` file auto-loading enables `on-start` execution in untrusted dirs | Medium | Security | Mitigated by help text warning + dangerous command prompt |
| 4 | Grid builder `Shift+Tab` for backward navigation not wired up | Low | UX | `prevFocus` exists but no keybinding |
| 5 | `doctor` exits 1 for missing recommendations (not errors) | Low | UX | Scripts may misinterpret as failure |
| 6 | `doctor` checks key presence not value correctness | Low | UX | Could report misconfigured settings as OK |
| 7 | Grid builder Escape cancels silently (no feedback message) | Low | UX | User sees gallery again without explanation |
| 8 | `isValidPreset` exported but only used in tests | Low | Architect | Dead export (tree-shaken from bundle) |
| 9 | `setup.ts` lowest coverage: 93.65% stmts, 85.19% branches | Low | QA | TUI wizard paths hard to test |
| 10 | `waitForHandler()` polling pattern in tests (flaky risk) | Low | QA | 500ms ceiling, low risk in practice |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN

- **796 tests, 100% pass rate**
- **Coverage:** 96.48% stmts, 90.22% branches, 98.53% functions, 96.96% lines
- All configured thresholds met
- Critical files: config.ts (100%), script.ts (100%/97.67%), launcher.ts (97.62%/89.23%), layout.ts (100%)
- `setup.ts` at 93.65%/85.19% — acceptable for interactive TUI module
- No `.skip`, `.only`, or `.todo` tests
- Typecheck: PASS | Lint: PASS

### 2. Security (security-reviewer) — YELLOW

- **pnpm audit:** 0 vulnerabilities (zero runtime deps)
- **Hardcoded secrets:** None found
- **Command injection:** Well-protected — `execFileSync` used everywhere except `on-start` (which uses `execSync` with shell). `SAFE_COMMAND_RE` validated. AppleScript properly escaped via `escapeAppleScript()` + `shellQuote()`
- **Path traversal:** Protected — `LAYOUT_NAME_RE` prevents `../` in layout names
- **Licenses:** All MIT/Apache-2.0/BSD/ISC — no copyleft
- **File permissions:** Config files 0o600, dirs 0o700
- Two warnings: `execSync` for `on-start` and `.summon` auto-load trust model (both mitigated)

### 3. Infrastructure (devops) — YELLOW

- **Build:** PASS (6 ESM chunks, ~67 KB total)
- **CI:** Last 5 runs on develop all passed (pre-push commit)
- **Git:** Clean working tree, 1 unpushed commit (BLOCKER)
- **package.json:** All fields correct (name, version, bin, engines, os, exports, files)
- **CHANGELOG:** Exists, follows Keep a Changelog — missing new feature entry
- **.gitignore:** Comprehensive (dist, node_modules, .env, *.pem, *.key, .npmrc)
- **npm publish readiness:** PASS (prepublishOnly runs build)

### 4. Architecture (architect) — GREEN

- **Typecheck:** PASS
- **Outdated deps:** None
- **Circular deps:** None — clean DAG
- **Dead code:** 3 minor unused exports (1 warning, 2 recommendations) — all tree-shaken from bundle
- **Duplicate patterns:** 3 minor (leaf collector in tree/script, parseFloat pattern in launcher, redundant dynamic import in index) — all recommendations

### 5. Performance (performance-eng) — GREEN

- **Startup:** 38ms (direct node invocation)
- **Bundle:** 66.7 KB total (minified, zero runtime deps)
- **Code splitting:** Effective — setup (22 KB) and completions (5.7 KB) lazy-loaded
- **Hot path:** No sync I/O on --help/--version paths
- **Tree-shaking:** Test-only exports correctly eliminated from production bundle
- **Dynamic imports:** Used appropriately for readline, setup, completions

### 6. UX/Accessibility (ux-reviewer) — GREEN

- **Help text:** Comprehensive with examples, subcommand docs, config key reference
- **Error messages:** Actionable — "Error: what" + "how to fix" + "Run summon --help"
- **Exit codes:** Correct throughout (1=error, 0=success) — `doctor` caveat noted
- **NO_COLOR:** Respected per spec
- **Non-TTY:** Properly guarded at all interactive entry points
- **Ctrl+C:** Clean exit at every prompt
- **Visual consistency:** Template gallery, grid builder, previews consistent with existing wizard UI
- **Grid builder hints:** Properly dim unavailable actions

## Recommendations (not blocking)

| # | Recommendation | Found by |
|---|---------------|----------|
| R1 | Show defaults in layout builder prompts: `[shell]`, `[lazygit]` | UX |
| R2 | Add `[Esc] cancel` to grid builder hints | UX |
| R3 | Guard against very narrow terminals in template gallery | UX |
| R4 | `summon open` invalid selection: show valid range and re-prompt | UX |
| R5 | Add `--help` for `layout` sub-actions | UX |
| R6 | Consolidate `collectLeaves`/`collectLeavesWithCommands` in tree.ts | Architect |
| R7 | Extract shared `parsePositiveFloat` helper for launcher.ts | Architect |
| R8 | Remove redundant dynamic `node:path` import in doctor subcommand | Architect |
| R9 | Unexport `ParseIntResult` type (unused externally) | Architect |
| R10 | Unexport `TreePlanOptions` interface (unused externally) | Architect |

## Fix Priority

1. **Push and verify CI** (BLOCKER) — `git push` then monitor
2. **Update CHANGELOG** (W1) — add visual layout builder feature entry
3. **Wire Shift+Tab** (W4) — quick fix, map `shift+tab` to `prevFocus`
4. **Add Escape hint** (R2) — add `[Esc] cancel` to grid builder hints
5. **Remaining warnings/recommendations** — defer to post-launch or next release cycle
