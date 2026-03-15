# Pre-Launch Audit Report
> Generated on 2026-03-15 | Branch: `develop` | 6 parallel specialists

## Verdict: CONDITIONAL

No blockers. 6 warnings across 4 specialists. All are actionable and non-critical. The codebase is in excellent shape after the v1 code quality refactor — 705 tests, 98.53% statement coverage, zero vulnerabilities, 76KB bundle.

## Blockers (must fix before release)

None.

## Warnings

| # | Issue | Severity | Found by | Risk |
|---|-------|----------|----------|------|
| W1 | osascript failure message only suggests "Is Ghostty running?" — doesn't mention macOS Automation permissions (the #1 cause of AppleScript failures on first use) | MEDIUM | ux-reviewer | First-time users will hit this and not know how to fix it |
| W2 | No user feedback on successful workspace launch (silent execution) | MEDIUM | ux-reviewer | Users can't tell if the command worked, especially with slow Ghostty response |
| W3 | `on-start` uses `execSync` without command-name validation (unlike editor/sidebar/shell) | LOW | security | By design — `on-start` is a shell hook — but should be documented prominently |
| W4 | `.summon` files in untrusted repos can specify commands (mitigated by metacharacter detection + user prompt) | LOW | security | Well-known supply-chain pattern (like npm postinstall). Existing mitigations are reasonable |
| W5 | Layout validation + error message duplicated in index.ts (lines 271-280 and 399-408) | LOW | architect | Minor DRY violation, could diverge if a third validation point is added |
| W6 | `[Unreleased]` section in CHANGELOG is empty despite 9-phase refactor (+754/-424 lines) | LOW | devops | Handled by `/release` |

## Detailed Findings

### 1. Quality Assurance (qa-lead) — GREEN

- **Tests:** 705 passed, 0 failed, 100% pass rate
- **Typecheck:** PASS | **Lint:** PASS
- **Coverage:** 98.53% stmts / 92.15% branches / 98.80% funcs / 99.21% lines
- All source files have co-located test files. No untested production files.
- Uncovered branches are in interactive TUI rendering and live osascript execution — appropriate for manual testing per project philosophy.
- Edge cases well covered: boundary values, empty strings, NaN, negative numbers, shell injection vectors.
- Graceful degradation verified: missing Ghostty, missing config, unknown presets, invalid SHELL env.

### 2. Security (security-reviewer) — YELLOW

- **Dependency audit:** No vulnerabilities. Zero runtime deps. All dev dep licenses MIT-compatible.
- **Secrets:** None found in source or config.
- **Command injection:** Well-defended. `SAFE_COMMAND_RE` + `resolveCommand` gate all command names. `.summon` metacharacters trigger user confirmation via `confirmDangerousCommands`.
- **AppleScript injection:** Properly mitigated via `escapeAppleScript` + `shellQuote`. Script passed via stdin (not `-e` flag).
- **File permissions:** Correct (dirs 0o700, files 0o600).
- **Path traversal:** Blocked by `LAYOUT_NAME_RE` in layout names.
- **SHELL validation:** `SAFE_SHELL_RE` validates env var, falls back to `/bin/bash`.
- **Env var keys:** Validated with `ENV_KEY_RE`, values shell-quoted.
- **.gitignore:** Covers `.env`, `.npmrc`, `*.pem`, `*.key`, credentials.
- **W3:** `on-start` intentionally uses `execSync` for shell hooks — document prominently.
- **W4:** `.summon` trust model is well-documented in help text. Consider logging which `.summon` file is loaded.

### 3. Infrastructure (devops) — YELLOW

- **Build:** Success in 12ms, 76KB total (7 files, code-split).
- **CI:** Last 5 runs on develop all `completed/success`.
- **Git state:** Clean working tree, up to date with origin.
- **Package.json:** All fields correct — `bin`, `files`, `engines`, `os`, `exports`, `prepublishOnly`.
- **Hooks:** Husky pre-commit runs typecheck + lint + test. Guard-bash hook enforces git safety.
- **CI config:** Node 18/20/22 matrix on macOS, CodeQL, dependency review, Dependabot.
- **W6:** CHANGELOG `[Unreleased]` empty — handled by `/release`.
- **Minor:** `EDITOR` env var used in `summon layout edit` but not listed in README env var table.

### 4. Architecture (architect) — YELLOW

- **Typecheck:** PASS. **Dependencies:** All current (no outdated packages).
- **Circular deps:** None. Clean DAG with leaf modules (`utils`, `validation`, `layout`) at bottom.
- **Dead code:** Minor — `isValidPreset` exported but only used in tests; `getConfig`/`resetConfigCache`/`resetStarshipCache` intentionally test-only exports.
- **W5:** Layout validation + error message duplicated in two places in index.ts.
- **setup.ts (~1054 lines):** Largest file with multiple responsibilities (ANSI helpers, box-drawing, mascot, TUI input, tool detection, wizard, layout builder). Could benefit from extraction but not blocking.
- **index.ts (~757 lines):** Doctor/export subcommands could be extracted. Not urgent.
- **Architecture:** Clean separation of concerns, appropriate lazy loading, no abstraction leaks.

### 5. Performance (performance-eng) — GREEN

- **Bundle:** 76KB total. Main chunk 33.88KB. Setup (15.98KB) and completions (5.76KB) lazy-loaded.
- **Startup:** Excellent — heavy modules dynamically imported. `summon --help` avoids loading ~22KB.
- **Anti-patterns:** None. All regexes pre-compiled at module level. Config reads batched. Command resolution cached. AppleScript uses array-join pattern (not concatenation).
- **Tree algorithms:** O(n) parser and traversal. `collectLeaves` uses accumulator pattern.
- **Minor:** O(n²) in `launchTreeLayout` (collectLeaves + findPaneByName loop) — irrelevant at practical tree sizes (≤10 panes).

### 6. UX/Accessibility (ux-reviewer) — YELLOW

- **Help text:** Comprehensive, well-structured with sections. All flags documented. Examples provided.
- **Error messages:** Consistent "Error: ..." prefix. Most include "Run 'summon --help'" follow-up.
- **First-run wizard:** Intuitive step-by-step flow. Tool detection filters options. Layout preview with box-drawing. Confirm before save. Non-TTY handled gracefully.
- **Naming coherence:** Consistent terminology (pane/layout/workspace/sidebar/editor). Theme is present but not forced.
- **Exit codes:** Correct throughout (0=success, 1=error).
- **W1:** osascript failure message needs to mention Automation permissions.
- **W2:** Silent successful launch — consider brief feedback message.
- **Minor:** Layout builder defaults ("shell", "lazygit") invisible in prompts. `summon doctor` exits 1 for missing recommended (not required) settings. Version output is bare number.

## Recommendations (not blocking)

| # | Recommendation | Found by |
|---|---------------|----------|
| R1 | Add `summon v` prefix to version output | ux-reviewer |
| R2 | Show defaults in layout builder prompts: `[shell]`, `[lazygit]` | ux-reviewer |
| R3 | Add "Ctrl+C to cancel" hint in setup wizard | ux-reviewer |
| R4 | Log which `.summon` file is being loaded | security |
| R5 | Add CodeQL to run on `develop` branch (currently only `main` + weekly) | devops |
| R6 | Add `EDITOR` env var to README env var table | devops |
| R7 | Extract `isGhosttyInstalled()` shared utility (duplicated in launcher + setup) | architect |
| R8 | Doctor subcommand: use exit code 0 for advisory (missing recommended settings) | ux-reviewer |
| R9 | `summon open` invalid selection: show valid range in error message | ux-reviewer |
| R10 | Consider `--verbose` flag for config resolution debugging | ux-reviewer |

## Fix Priority

**Fix before release (W1-W2):** Improve osascript error message, add launch feedback — these affect first-time user experience.

**Document before release (W3-W4):** Add `on-start` shell execution note to README. Already well-mitigated.

**Handled by `/release` (W6):** CHANGELOG update.

**Optional cleanup (W5, R1-R10):** Minor DRY violation and polish items. Can be deferred.
