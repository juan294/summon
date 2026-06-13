# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-06-10

### Added

- Fish shell completions: `summon completions fish` is now fully supported alongside zsh and bash. Add `summon completions fish | source` to `~/.config/fish/config.fish`.
- zsh completions now include `--no-project-config` flag and path-completion for the `trust` subcommand.
- Progress line `"Launching <target>…"` is now printed to stderr before the workspace opens, so the terminal no longer appears to hang during a multi-second launch.
- Exit codes are now documented in the user manual: 0 (success), 1 (usage/config error), 2 (pre-launch guard failure), 130 (cancelled). Unexpected errors hint at `SUMMON_DEBUG=1` for full diagnostics.

### Changed

- **Dangerous-command confirmation now defaults to no.** Pressing Enter at the `Continue? [y/N/s(kip pane)]` prompt aborts the launch. Previously, Enter accepted the command (default yes). Any scripts or workflows that relied on enter-to-confirm must now send explicit `y`.
- Doctor diagnostics and launcher progress messages are now written to stderr. Stdout is reserved for machine-readable output (`export`, `status --once`). Pipelines like `summon export > .summon` are no longer polluted with human-facing chatter.
- Empty-state "no projects registered" messages unified across `list`, `open`, `status`, and the TUI monitor.
- Error message prefixes standardized to `summon: error:` across all commands.
- `on-start` command string is no longer echoed to stdout at launch; it is written to the debug log only when `SUMMON_DEBUG=1` is set.

### Fixed

- `summon session --all` no longer silently builds a project's workspace on top of the previous project's tab. New-tab and new-window creation now anchor the target window, verify the tab/window actually opened (retrying a dropped keystroke up to 2 times and polling for up to 0.6s per attempt), and a project whose tab cannot be opened is reported and skipped instead of disappearing. A 200ms inter-launch delay is added between projects to reduce cross-process keystroke contention.
- `--new-window` and `--new-tab` are now caught as conflicting flags at parse time and produce a clean usage error instead of an unhandled stack trace from deep inside the layout engine.
- `atomicWrite` now uses a `pid + randomBytes(6)` temp-file suffix instead of a fixed `.tmp` suffix, eliminating a concurrent-write race that could corrupt `trust.json` during `session --all`.
- Config values containing ` # ` (inline comment syntax) are no longer silently truncated on read. `on-start = build # release` now round-trips correctly.
- Snapshot and session commands now validate input at parse time. Path-traversal inputs (e.g. `../etc/passwd`) produce a clean error instead of an uncaught stack trace.
- Monitor help overlay color legend corrected: green = active, yellow = active >4h, dim = stopped. The previous legend was factually wrong.
- Monitor table columns and `truncateLine` in `ui/ansi.ts` are now display-width-aware for CJK characters and emoji. Wide characters no longer break table alignment.
- `--new-tab` is restored to the main `--help` Options list. Help text now wraps gracefully on narrow terminals instead of truncating with `…`.
- Symbol vocabulary (`✓` / `⚠`) unified: `project.ts`, `setup.ts`, and `snapshot.ts` now use the canonical glyphs from `ui/symbols.ts` instead of hardcoded alternatives.
- `snapshot.ts` color helpers deduplicated — `dim`/`green` now imported from `ui/ansi.ts`.
- `secondaryEditor` now round-trips through config: `freeze` no longer silently drops it.
- Module-global `scriptCache` removed from `script.ts` — `generateAppleScript` is now a pure stateless function (the cache never hit in production).
- `trust.ts` now imports `TRUST_FILE` and `CONFIG_DIR` from `paths.ts` instead of re-deriving them, preventing silent drift if the config directory is ever relocated.
- Cleanup log directory (`~/.config/summon/logs/`) is now created with `mode: 0o700`, matching the permissions of other summon state directories.
- `colorSwatch` in `ui/ansi.ts` returns a 256-color block on non-truecolor terminals so the Starship preset picker renders correctly on common terminal emulators.
- Layout presets in `--help` deduplicated: the hardcoded "Layout presets:" block is removed; only the single `LAYOUT_INFO`-generated "Layouts:" block remains.
- `PreviewRenderer` in the setup wizard now computes physical row counts (wrap-aware) for cursor-up redraws, preventing smeared output on narrow terminals.
- Setup wizard grid builder now documents Shift+Tab reverse navigation in the on-screen hints.

### Internal

- Publish workflow: added idempotency guard — a rerun after a transient failure skips the `npm publish` step if the version is already live, allowing the smoke-matrix to complete cleanly.
- npm tarball verification now asserts `README.md` and `LICENSE` are present in the published package.
- CHANGELOG/version/tag consistency check moved to the first step of the publish job (before `pnpm install`) to fail fast on mismatches.
- Added `SUMMON_E2E=1` job to CI that runs the AppleScript syntax E2E suite on `macos-latest`.

### Fixed

- `summon session --all` no longer silently builds a project's workspace on top of the previous project's tab. New-tab and new-window creation now anchor the target window, verify the tab/window actually opened (retrying a dropped keystroke up to 2 times and polling for up to 0.6s per attempt), and a project whose tab cannot be opened is reported and skipped instead of disappearing. A 200ms inter-launch delay is added between projects to reduce cross-process keystroke contention.

## [1.6.0] - 2026-06-04

### Added

- **Fish shell completions** — `summon completions fish` is now fully wired through the completions dispatcher. Fish users get the same project-name, layout, and config-key completions as zsh/bash.
- **`summon doctor --verbose`** — prints version, Node.js version, config directory, Ghostty binary path, and trust DB summary alongside the usual health checks.
- **Ghostty-specific accessibility messages** — the setup wizard and doctor now show Ghostty-tailored guidance for granting Automation and Accessibility permissions instead of generic macOS instructions.
- **Layout builder quick-pick** — the template gallery can now be navigated by typing a number directly at the quick-pick prompt in addition to scrolling.
- **Diagnostic info via `SUMMON_DEBUG`** — `SUMMON_DEBUG=1` now emits richer diagnostic output including config resolution trace and trust-check results.

### Fixed

- **Trust: symlink normalization** — `assertTrusted` now resolves symlinks before hashing, so projects accessed via symlinked paths trust-check the canonical real path (#471).
- **Trust: `.summon` reads in `ports`** — `ports.ts` now verifies trust before reading any `.summon` file; untrusted files are silently skipped (#472).
- **Performance: lazy launcher graph** — the full launcher graph (launcher, script, tree, etc.) is now loaded via dynamic `import()`. Normal subcommands (`list`, `status`, `doctor`, etc.) no longer pay the startup cost of loading the entire launch subsystem (#473).
- **UX: `summon open` cancel affordance** — the open picker now shows `(0 to cancel)` and exits cleanly when `0` is entered instead of re-prompting on out-of-range input (#475).
- **UX: post-wizard auto-launch** — after completing the first-run setup wizard, summon now continues to launch the target workspace instead of exiting (#476).
- **UI: unified color detection** — `supportsColor()` is now a single canonical implementation checked at call time; the three divergent inline copies have been removed (#477).
- **UI: canonical glyph vocabulary** — `✓`, `⚠`, `✗`, `·`, `•` exported from `ui/symbols.ts` and used consistently across all commands; mixed glyph sets replaced (#478, #479).
- **UI: TUI help color legend** — the `?` overlay in `summon status` now includes "Colors: yellow = active  dim = stopped" (#481).
- **UX: wizard back-navigation** — step 1 no longer shows a misleading "press b to go back" hint; Editor and Sidebar steps now correctly support `b` back-navigation (#482, #483).
- **UX: confirm prompt polarity** — dangerous command prompt changed from `[y/N/s]` to `[Y/n/s]` so pressing Enter accepts (matches the rest of the CLI) (#484).
- **Security: shell-escape lint gate expanded** — the static analysis test now covers `sendCommand(…)` and `setInitialInput(…)` helper calls in addition to raw template literals (#485).
- **CI: sourcemaps excluded from npm tarball** — source maps are no longer published; package size reduced from ~613 KB to ~156 KB (#488).
- **CI: tarball guard hardened** — the release workflow now verifies `dist/index.js` + at least one `chunk-*.js` exist in the tarball (#489).
- **CI: OIDC trusted publisher** — removed the now-redundant `NODE_AUTH_TOKEN`; `npm publish --provenance` authenticates via the OIDC trusted publisher already registered on npmjs.com (#490).
- **Backend: atomic file writes** — `status.json`, `snapshot.json`, `trust.json`, and config files are now written to a temp file then renamed (POSIX-atomic), preventing torn writes on crash (#491, #492).
- **Backend: forward-compatible schema readers** — `readWorkspaceStatus` and `readSnapshot` return `null` for records with `version > 1` instead of hard-rejecting with an error (#491).
- **Backend: corrupt trust DB warning** — `loadTrustDb` now emits a `SUMMON_DEBUG` warning on corrupt JSON instead of silently swallowing the error (#493).
- **Backend: config comment preservation** — inline comments in `.summon` and machine config files are preserved across `setConfig` / `writeKV` calls (#494).
- **Backend: trust fail-closed** — `assertTrusted` now rethrows non-ENOENT IO errors (e.g. permission denied) instead of silently bypassing the trust gate (#495).
- **Backend: `clean` prelude scoped** — `emitClosePrelude` now targets only the active workspace window, not all open Ghostty panes (#496).
- **UX: CJK/emoji widths in layout previews** — characters in the double-width Unicode ranges (CJK, Hangul, emoji) now occupy two terminal columns in layout diagrams (#505).
- **UX: terminal-width wrapping** — `--help` output, the help/ports table, and layout previews now wrap at the current terminal width instead of overflowing (#506, #507).
- **UX: TUI launch failure recovery** — a launch error inside `summon status` now shows an in-TUI error overlay and resumes the dashboard instead of dropping back to the shell (#508).
- **UX: consistent empty states** — `summon open`, `summon list`, and `summon status` all show the same actionable "No projects found — run `summon add …`" message (#509).
- **UX: pane-layout legend in `--help`** — the built-in layout preset diagrams are now included in `summon --help` output (#510).
- **UX: clean Ctrl+C exit** — `PromptCancelled` is caught at the top level so Ctrl+C prints nothing instead of a Node.js stack trace.
- **UX: `doctor --fix` stale-read** — `--fix` now re-reads the Ghostty config after writing, so checks pass immediately after applying a fix.

### Infrastructure

- Release smoke tests now cover Node 20.19.0 (minimum floor) and Node 24 (latest), in addition to Node 22 (#502).
- `pnpm build` added to the Husky pre-commit hook so the build is verified before every commit (#503).

## [1.5.2] - 2026-05-19

### Fixed

- **`summon session --all` no longer aborts on the first untrusted project.**
  Encountering an untrusted `.summon` file used to terminate the whole session
  via `process.exit(1)` from inside `launch()`, with the spinner swallowing the
  error so the user saw only a few tabs open and no clear reason. The trust
  gate now rethrows `SummonError`, and `session` catches it per-project: prints
  a warning with the exact `summon trust <path>` hint, continues with the
  remaining projects, and reports `N launched, M skipped (untrusted)` at the
  end. Direct `summon <project>` launches still exit cleanly on untrusted
  files via a top-level catch in the CLI entry.

## [1.5.1] - 2026-05-19

### Fixed

- **Empty pane commands are valid again.** A blank pane definition (e.g. `pane.shell=`)
  opens a plain shell — the over-strict guard added in 1.5.0 incorrectly rejected this,
  breaking `summon session --all` for any layout that included an empty pane (notably
  the `standard-rpi` template).

## [1.5.0] - 2026-05-11

### Added

- **`summon session`** — multi-project tab orchestration: launch a saved set of projects
  as separate Ghostty tabs in one command. Subcommands: `add`, `remove`, `list`, `show`,
  `--all` (launch every registered project). Sessions stored in `~/.config/summon/sessions/`.
- **Auto-clear restored panes** — stale panes from a prior Ghostty session are now cleaned
  up automatically on workspace launch (controlled by the `clean` config key; see Changed).
- Workspace monitoring subcommands: `briefing`, `monitor`, `ports`, `snapshot`, `status`
  (introduced as part of the workspace management suite).

### Changed

- **Trust gate is now fail-closed by default.** Projects with a `.summon` file are blocked
  until the user explicitly runs `summon trust <dir>`. The file's SHA-256 hash is stored and
  re-verified on every launch; a changed file requires re-trusting.
- **`--clean` / `clean` config key defaults to `off`.** Auto-close of restored panes must
  now be explicitly enabled via `--clean` or `clean=true` in config. Previously defaulted on.
- `summon doctor` output now shows `✔` / `✖` indicators with a pass/fail count summary
  and auto-fixable count (`--fix`).
- `summon open` uses the monitor TUI picker instead of a plain numbered list.
- Setup wizard gains back-navigation, preview re-enable after validation errors, and a
  legend for layout preview labels.
- Monitor TUI: branch names truncated with `…` on narrow terminals; stopped workspaces
  display their directory path instead of an em dash.
- CLI help text colorized (bold section headers, cyan command names, dim descriptions).
- Unknown commands suggest `summon --help`; bare `summon` with no projects shows an
  actionable empty-state hint.
- Config key validation now rejects keys containing `=`, newlines, or a `#` prefix.
- `summon trust` displays the SHA-256 hash of the trusted file for verification.

### Fixed

- Security: single-read `.summon` validation eliminates TOCTOU race between hash check
  and config parse.
- Security: `PROJECT_NAME_RE` hardened — rejects names with shell metacharacters
  (`;`, `|`, backticks) that could reach AppleScript or shell contexts.
- Config: inline `# comment` stripping in KV files; CRLF normalization; mtime-based
  memoization for repeated reads within a session.
- Trust: path normalization for symlinks and relative paths before hashing; fail-closed
  on IO errors (permission denied no longer silently bypasses trust).
- Launcher: non-empty pane commands validated before AppleScript generation; rollback
  skips `closeWorkspaceWindow` on accessibility errors.
- Monitor: async git branch reads; `NO_COLOR` respected for INVERT escape; narrow-terminal
  floor at 60 columns.
- Port detection: regex hardened to avoid false positives inside string literals and
  unrelated process args.
- Completions: dynamic layout list generated at shell completion time rather than hardcoded.
- Snapshot: negative `formatTimeSince` diffs clamped to `0`.
- Code splitting re-enabled (`splitting: true`) to un-nullify dynamic import pattern;
  all chunks included in published tarball via `files: ["dist"]`.

### Infrastructure

- Node 24 added to CI matrix; `timeout-minutes: 15` added to build jobs.
- pnpm store caching in CI for faster installs.
- SECURITY.md expanded with vulnerability reporting process.
- E2E AppleScript syntax test guarded with Ghostty presence check
  (`/Applications/Ghostty.app`) — skips automatically on machines without Ghostty.

## [1.4.2] - 2026-05-10

### Fixed

- `summon trust .` now stores the absolute project path so trust persists across
  launches. Previously the literal `"."` was recorded, never matching the resolved
  target dir on subsequent runs.
- Pane cleanup on launch no longer requires the front tab title to contain the
  project marker. Re-launching a project from any tab clears the existing panes
  and renders the fresh layout. `--no-clean` and `--new-window` remain the
  escape hatches.

### Added

- `--no-project-config` flag — skips reading and trust-checking the `.summon`
  file. The flag was previously advertised in the trust error message but never
  wired into the parser.

## [1.4.1] - 2026-05-09

### Fixed

- Build: disabled tsup code splitting so `dist/index.js` is self-contained.
  The default ESM splitting generated chunk files excluded from the npm tarball,
  causing `ERR_MODULE_NOT_FOUND` on install.

## [1.4.0] - 2026-05-09

### Added

- `summon trust <dir>` — direnv-style trust gate for `.summon` files. SHA-256
  hashes recorded in `~/.config/summon/trust`; trust revoked on content change.
- `SUMMON_DEBUG=1` — enables timestamped debug output to stderr and
  `~/.config/summon/logs/`.
- Fish shell completions (`summon completions fish`).
- Wizard back-navigation — press `b` at any setup step to return to previous.
- Skip-pane option in dangerous command prompt — `[y/N/s(kip pane)]`; `s`
  skips that pane and continues launching.
- Rollback on launch failure — `closeWorkspaceWindow()` called if osascript
  fails mid-launch.
- `launch-guards.ts` — `ensureGhostty`, `ensureAccessibility`,
  `confirmDangerousCommands` extracted from `launcher.ts`.
- `paths.ts` — canonical path constants (`CONFIG_DIR`, `STATUS_DIR`,
  `SNAPSHOTS_DIR`, `LAYOUTS_DIR`, `LOGS_DIR`, `TRUST_FILE`).
- `shell-escape.ts` — `escapeAppleScript`, `shellQuote`, `shellDoubleQuote`
  extracted from `script.ts`. Load-bearing lint test (`shell-escape.lint.test.ts`)
  statically enforces no raw template literal interpolates user values into
  AppleScript/shell contexts.
- `command-spec.ts` — `analyzeCommand`, `commandHasShellMeta`,
  `commandExecutable` extracted into a shared module.
- `generateAppleScript` options-object overload (`GenerateAppleScriptOptions`);
  positional signature preserved for backward compat.
- `src/commands/` — command handlers extracted from `src/index.ts`;
  `index.ts` reduced from ~1,006 to ~134 lines.
- `src/cli/parse.ts` — CLI argument parsing extracted from `index.ts`.
- `src/ui/ansi.ts`, `src/ui/layout-preview.ts` — ANSI color helpers and
  layout preview renderer extracted from `setup.ts`.
- `src/setup-gallery.ts` — template gallery data extracted from `setup.ts`.
- `gitSafeEnv()` — strips inherited `GIT_DIR`/`GIT_WORK_TREE`/
  `GIT_INDEX_FILE` to prevent hook-context git pollution.
- `PromptCancelled` error class — `promptUser` now throws instead of calling
  `process.exit(130)` on Ctrl+C/EOF.
- `--once` flag validation warning when used with non-launch subcommands.
- mtime-based KV file memoization in `config.ts`.
- Unknown config key warnings in `listConfig()`.
- `formatTimeSince` negative diffs clamped to `0s`.
- Path traversal guard for layout file paths and tree DSL `cwd` values.
- Tree DSL max nesting depth of 32 enforced.
- CRLF line ending normalization in config file reads.
- `addProject` path validation: absolute path stored, name rejects `=`,
  spaces, and path separators.
- E2E test scaffold (`src/e2e/applescript-syntax.test.ts`) — validates
  generated AppleScript via `osacompile` (gated on `SUMMON_E2E=1`).
- `AGENTS.md` — Codex/GPT compatibility manifest.
- Auto-detect and clear restored Ghostty panes on launch (`--clean` /
  `--no-clean` / `clean` config key, default `true`).
- **Workspace management subcommands:** `summon briefing`, `summon status`,
  `summon switch`, `summon ports`, `summon snapshot <save|show|clear>`.
- `on-stop` config key for post-workspace hook commands.
- `generateFocusScript()` in `script.ts` for workspace switching.
- Workspace status tracking — each launch writes JSON status + active marker.
- Shell completions for all new subcommands.

### Changed

- **Breaking:** Node.js engine requirement bumped from `>=18` to `>=20.19`.
- TypeScript bumped to `6.0.2+`.
- Vitest bumped to `4.1.5`. Vite 8 in devDependencies.
- Build: minification enabled, external sourcemaps, `files` narrowed to
  `dist/index.js`.
- CI matrix: `macos-13` runner added. Dependabot groups added.
- `resolveCommand` now uses `/usr/bin/which` directly (no shell spawn).
- `selectLayout()` return type extended to
  `Promise<string | typeof WIZARD_BACK>`.
- Status files created with `0o600` permissions.
- pnpm overrides: `picomatch >=4.0.4`, `brace-expansion >=5.0.5` (CVEs).
- Removed internal agent reports and scripts from git tracking.
- Replaced setup wizard static screenshot with animated GIF in README.
- Bumped vitest 4.1.0 → 4.1.1, typescript-eslint 8.57.1 → 8.57.2,
  eslint 10.0.3 → 10.1.0.

### Fixed

- Cache git branch queries in monitor refresh with TTL-based cache (10s) (#222)
- Cache git queries in briefing data collection with session Map cache (#223)
- Skip `runMonitor` TUI tests on Node 18 (CI hang).
- Isolate CLI tests from project-level `.summon` config.
- npm publish CI fixes: `NODE_AUTH_TOKEN`, `--access public`.

### Tests

- 5 new test files: briefing, monitor, ports, snapshot, status.
- ~1,818 new test assertions with mocked git spawns and TUI functions.
- Additional tests for launcher, focus script, CLI dispatch, completions.

## [1.3.0] - 2026-03-20

### Added

- `summon layout list` now renders ASCII box-drawing diagrams showing each command in its actual pane position, replacing the dense key=value dump
- Pre-flight macOS Accessibility permission check before workspace launch — clear error with actionable guidance instead of cryptic osascript failures
- Path traversal guard on Starship preset config paths (defense in depth)
- Trust advisory when `.summon` project files are detected in a directory
- Automated npm publish workflow via GitHub Releases
- Version number shown in `--help` output header

### Changed

- Pane commands now use Ghostty's `initial input` surface config instead of shell-wrapping `set command of cfg` — panes survive command exit (TUI quit drops to a shell prompt), error output is visible, and behavior is consistent across bash, zsh, fish, and ksh
- Accessibility permission check timeout reduced from 5 s to 2 s for faster launch feedback
- Auto-install prompt for missing commands now defaults to No (`[y/N]`) instead of Yes
- All CLI error messages now use consistent `Error:` prefix and usage hints
- Nested workspace abort now exits with code 1 (was 0)

### Fixed

- Shell metacharacter confirmation now covers tree-layout pane commands (previously only checked grid-layout commands)
- Config parser (`readKVFile`) now skips comment lines instead of treating them as malformed keys
- Bash shell completions use a portability fallback for shells without `compopt`, and `freeze`/`export` subcommands now appear in completion results
- Resolved `flatted` prototype pollution vulnerability in dev dependencies
- On-start hook failure message now includes the underlying error; status message writes to stderr
- `summon doctor` exit code 2 message formatting cleaned up
- `--auto-resize` default description consistent between options and config keys sections
- Double space in `summon set editor` reset hint removed

## [1.2.1] - 2026-03-17

### Removed

- `--theme` flag and `theme` config key — Ghostty's AppleScript API does not support per-surface themes (error -10006). Set themes globally in `~/.config/ghostty/config` instead.
- `window-save-state` from `doctor` recommendations — Ghostty restores split layouts but not pane commands, creating stale splits that conflict with summon's layout management.

### Fixed

- `ENV_KEY_RE` extracted to shared constant in `validation.ts` (was duplicated in index.ts and launcher.ts)
- `summon config` now shows effective defaults when no machine config is set

### Changed

- `@internal` JSDoc tags added to all test-only exports for consistency
- `listStarshipPresets()` results are now cached (avoids repeated shell-outs)
- Branch protection on `main` hardened: `enforce_admins` and `dismiss_stale_reviews` enabled

### Tests

- 958 total tests (was 955 in v1.2.0)
- 8 weak `.toBeTruthy()` assertions replaced with `.toBeTypeOf('string')`
- 4 new tests covering tree layout + project CWD merge path
- 3 new tests for starship preset caching
- 6 new tests for `ENV_KEY_RE` validation

## [1.2.0] - 2026-03-16

### Added

- `--theme <name>` flag and `theme` config key — set Ghostty theme per workspace
- `summon doctor --fix` — auto-add missing recommended Ghostty settings (backs up config first)
- `summon freeze <name>` — snapshot current resolved config as a reusable custom layout
- `summon keybindings [--vim]` — generate Ghostty key table config for pane navigation
- Per-pane working directories via `pane.<name>.cwd` config keys in tree layouts
- macOS Accessibility permission detection in setup wizard and doctor
- Shell completions for `doctor --fix` and `keybindings --vim` subcommand flags
- Path traversal hardening: `layoutPath()` validates resolved paths stay within layouts directory
- `isGhosttyInstalled()` shared helper extracted to utils.ts

### Changed

- `summon doctor` now exits code 2 when issues are detected (was 0)
- `summon export` now includes `env.*` keys and adds a generation timestamp
- `summon config` shows removal hint for unknown keys
- `summon set env.<KEY>` now validates env var key format
- Ctrl+C during prompts exits with code 130 (was 0)
- Nested workspace warning: "messy" instead of "too scary"
- btop preset description no longer hard-codes "lazygit"
- `layoutNotFoundOrExit` now includes "Error:" prefix
- `resolveCommand` wrapper removed from launcher.ts (callers use `resolveCommandPath` directly)
- `optsToConfigMap()` and `appendDryRunExtras()` extracted as shared helpers

### Infrastructure

- Added `main` field and `publishConfig` to package.json
- Updated `typescript-eslint` to 8.57.1

### Tests

- 955 total tests (was 930 in v1.1.0)
- New test file: `keybindings.test.ts`
- Coverage improvements: optsToConfigMap, path traversal, parser edge cases, multi-pane layouts

## [1.1.0] - 2026-03-16

### Changed

- Claude CLI is no longer the default editor — setup wizard runs on first launch when no editor is configured, letting users choose any editor (vim, nvim, emacs, copilot, etc.)
- Editor catalog reordered: vim and nano (ship with macOS) listed first, Claude moved to end
- `on-start` commands from CLI flags and machine config are now checked for shell metacharacters (previously only `.summon` project files were checked)
- `layout edit` validates `$EDITOR` environment variable against `SAFE_COMMAND_RE` before use
- `summon open` re-prompts on invalid selection instead of exiting with an error
- `summon set editor ""` (and other command keys) now refuses empty string values
- `ensureCommand` messaging improved: "is not installed" instead of "is required but not installed"
- `resolveCommandAsync` in setup.ts replaced with shared `resolveCommand` from utils.ts

### Fixed

- Flaky test under v8 coverage stabilized with timeout and retry
- Duplicate `SAFE_COMMAND_RE` check removed from launcher.ts `resolveCommand` wrapper

### Tests

- 875 total tests (was 829 in v1.0.0)
- setup.ts coverage: 94.56% → 98.74% statements, 86.42% → 92.38% branches
- launcher.ts branch coverage: 89.50% → 92.50%
- utils.ts branch coverage: 83.33% → 100%

### Infrastructure

- CodeQL now runs on `develop` branch pushes and PRs (was only `main` + weekly)
- `dependency-review.yml` strict mode — vulnerable deps now fail the check
- Standardized `@internal` JSDoc on all 4 test-only exports

## [1.0.0] - 2026-03-16

### Added

- Visual template gallery in layout builder — pick grid shapes from side-by-side mini diagrams instead of specifying column/pane counts numerically
- In-place live preview in layout builder — layout diagram redraws in the same screen region as commands are filled in, using ANSI cursor control
- Arrow-key grid builder — interactive raw-mode builder for custom grid shapes (←→ columns, ↑↓ panes, Tab/Shift+Tab focus, Enter confirm, Esc cancel)
- Command validation with typo detection in layout builder — Levenshtein-distance fuzzy matching suggests closest tool name
- Truncation indicator (`…`) for long commands in layout preview
- Layout name prompt now shows example hint `(e.g., mysetup)`
- `exitWithUsageHint` shared helper for consistent CLI error messaging
- `parsePositiveFloat` validation helper

### Changed

- Custom layout builder no longer forces a mandatory sidebar — total design freedom for workspace layouts
- Grid builder has no column/pane limits — build as many splits as your screen fits
- `detectTools` runs shell lookups in parallel via `Promise.all` for faster wizard startup
- `summon doctor` exits 0 for missing recommendations (reserved exit 1 for actual errors)
- `summon layout show <preset>` gives a helpful message for built-in presets instead of a generic "reserved name" error
- ANSI-aware text centering in layout previews — correctly measures visible width excluding escape codes
- Empty custom shell command in setup wizard now re-prompts instead of accepting
- Standardized "plain shell" terminology throughout setup wizard
- Improved error messages: `summon open` shows valid range, editor failure suggests checking EDITOR env var
- `--auto-resize`/`--no-auto-resize` conflict now uses `console.warn` instead of `console.error`
- Safe error handling: replaced unsafe `(err as Error)` casts with `getErrorMessage()` utility
- Decomposed large functions in launcher.ts and script.ts into focused helpers
- `readKVFile` optimized to single syscall (try/catch instead of existsSync + readFileSync)
- `collectLeaves` result cached in `TreeLayoutPlan` to avoid redundant tree traversals

### Fixed

- `--new-window` with custom/tree layouts on Ghostty 1.3.x — unified new-window creation to use Cmd+N via System Events instead of `make new window` which returns unusable tab-group references

### Tests

- 828 total tests (was 677 in v0.8.0), 97%+ statement coverage, script.ts at 100% branch coverage
- New tests for: centerLabel truncation, visibleLength, async detectTools, parsePositiveFloat, doctor exit codes, layout show error messages, grid builder unlimited columns/panes, tree.ts parser guards, script.ts layout branches, readKVFile error propagation, empty shell rejection

## [0.8.0] - 2026-03-14

### Added

- Custom layout builder with tree DSL for arbitrary Ghostty split configurations (e.g., `editor | shell / logs`)
- Interactive layout builder wizard via `summon layout create <name>` with live grid preview
- Layout CRUD commands: `summon layout create`, `save`, `list`, `show`, `delete`, `edit`
- Shell completions for `layout` subcommand and actions (zsh + bash)
- Custom layout names accepted by `--layout` flag and `summon set layout`
- Nested workspace detection: `SUMMON_WORKSPACE=1` env var set in all panes, warns when launching inside an existing workspace
- No-args invocation now shows full help text instead of terse error

### Fixed

- Ghostty AppleScript `make new window` bug workaround — uses Cmd+N via System Events instead of `make new window` which returns unusable tab-group references
- CLI `--env` key names now validated against `ENV_KEY_RE` — invalid keys (spaces, leading digits) are warned and skipped
- Layout name validation added to `layout show`, `layout delete`, `layout edit` — defense-in-depth against path traversal
- Path traversal guard in `resolveConfig()` — layout names from `.summon` files validated against regex before `isCustomLayout()`

### Changed

- Setup wizard now shows only detected/available tools instead of dimming unavailable ones
- Extracted 9 shared AppleScript generation helpers (`emitAutoResize`, `emitSurfaceConfig`, `emitRootPaneEnvExports`, etc.) reducing ~200 lines of duplication
- Extracted `validateLayoutNameOrExit()` and `layoutNotFoundOrExit()` helpers in CLI entry point
- Removed unreachable dead code in tree DSL parser

### Tests

- 677 total tests (was 523 in v0.7.0), 98.47% statement coverage
- Comprehensive coverage for `runLayoutBuilder`, `findPaneByName`, tree DSL parser, layout completions, env key validation, layout name validation

## [0.7.0] - 2026-03-14

### Added

- Window management flags: `--new-window`, `--fullscreen`, `--maximize`, `--float` for controlling workspace window behavior
- Per-workspace environment variables via `--env KEY=VALUE` (repeatable) and `summon set env.<KEY> <VALUE>`
- Font size override via `--font-size <n>` flag and `font-size` config key
- Pre-launch hook via `--on-start <cmd>` to run a command before workspace creation
- `summon doctor` subcommand to check Ghostty config for recommended settings
- `summon open` subcommand for interactive project selection and launch
- `summon export [path]` subcommand to export resolved config as a `.summon` file
- Environment variables and font size now set via Ghostty's `surface configuration` for automatic propagation to all panes

### Fixed

- Shell-quote env var values in root pane exports to prevent injection (#118)
- `SHELL_META_RE` now catches `${...}` parameter expansion patterns (#119)
- Env var key names validated against `[a-zA-Z_][a-zA-Z0-9_]*` pattern (#120)
- Help text column alignment for config keys and window flags (#121)
- Ambiguous flag hint: suggests `--flag=-value` syntax for values starting with `-` (#122)
- Warning on empty command values in `summon set` (#123)
- `summon doctor` exits with status 1 when issues found (#124)
- Plural mismatch in dry-run output: "1 editor panes" → "1 editor pane" (#125)

### Changed

- Documentation updated: README, user manual, and architecture docs refreshed for all new features, subcommands, and config keys
- Synced with cc-rpi blueprint v1.8.0 (added `/release`, `/update-docs`, `/detach` commands)

## [0.6.2] - 2026-03-14

### Added

- Interactive shell panes now receive a `clear` command after setup, removing the "Last login" message and any `export` commands from view

## [0.6.1] - 2026-03-14

### Fixed

- Starship `STARSHIP_CONFIG` env var injection now works correctly in Ghostty surface configurations. Previously used shell env-prefix syntax (`VAR=val cmd`) which Ghostty's `login`/`exec` mechanism doesn't interpret — now embeds `export STARSHIP_CONFIG=...` inside the login shell's `-lc` argument.

## [0.6.0] - 2026-03-14

### Added

- Per-workspace Starship prompt theming via `starship-preset` config key and `--starship-preset` CLI flag. Each workspace launches with `STARSHIP_CONFIG` pointing to a cached preset TOML, giving projects distinct prompt themes without modifying the global `~/.config/starship.toml`
- Starship preset selector in the setup wizard with true-color palette swatches for the 4 color-rich presets (pastel-powerline, tokyo-night, gruvbox-rainbow, catppuccin-powerline)
- "Random (surprise me!)" option in the Starship preset selector
- Shell tab completion for `--starship-preset` and `summon set starship-preset` with dynamic preset listing
- `COLORTERM` environment variable documentation in README

### Fixed

- Starship preset TOML files now use explicit `0o600` permissions, matching other config files (#97)
- Added "Aborted." message when user declines dangerous command confirmation (#98)

## [0.5.0] - 2026-03-13

### Added

- Pane titles: each pane now displays a human-readable title (`role · command`) via Ghostty 1.3.1's `set_surface_title` action
- Tab title: set to the project directory basename on launch via `set_tab_title`
- Environment Variables section in README and user manual documenting `SHELL` and `NO_COLOR`

### Fixed

- Bash completions now include all short flags (`-h`, `-v`, `-l`, `-e`, `-n`) — previously only `-p` and `-s` were completable (#93)
- Removed unused `printBanner` export from setup module (#94)

### Changed

- Minimum Ghostty version bumped from 1.3.0 to 1.3.1 (required for `set_surface_title` / `set_tab_title`)

## [0.4.1] - 2026-03-13

### Fixed

- `--help` now works on first run — moved help check before the setup wizard gate

### Changed

- Renamed "server" pane to "shell" across entire codebase (code, tests, docs, config keys)
- Consolidated readline boilerplate in `setup.ts` — `numberedSelect`, `confirm`, and `selectToolFromCatalog` now use shared `promptUser()` from `utils.ts`
- Renamed `COMMAND_KEYS` → `DISPLAY_COMMAND_KEYS` in `index.ts` to avoid naming overlap with the security validation Set in `launcher.ts`
- Enabled bundle minification via tsup (52 KB → 33 KB total, 36% reduction)
- Added `"exports"` field to `package.json` for explicit ESM module resolution
- Updated README, user manual, and architecture docs for v0.4.0 features

### Tests

- 381 tests (up from 377) — 4 new tests closing branch coverage gaps
- `script.ts` now at 100% branch coverage (was 97.43%) — covered `hasShell` without `shellCommand` and multi-editor right column without shell
- `setup.ts` coverage improved — covered `printSummary` with `shell="true"` and custom shell commands, non-minimal layout `selectShell()` path

## [0.4.0] - 2026-03-13

### Added

- Interactive setup wizard (`summon setup`) for first-run onboarding — choose layout, editor, sidebar, and shell preferences with numbered selection
- First-run auto-trigger: setup wizard launches automatically when no config file exists (TTY only)
- Tool detection during setup — checks if chosen commands (editor, sidebar, Ghostty) are installed, shows install hints for missing tools
- Shell tab completion for zsh and bash (`summon completions <shell>`)
- Short flags `-p` for `--panes` and `-s` for `--sidebar`
- Brief usage hint on no-argument invocation instead of full help dump
- Security confirmation prompt for `.summon` files containing shell metacharacters
- `SHELL` environment variable validation with safe fallback to `/bin/bash`
- Dry-run output includes layout summary header
- `NO_COLOR` support in setup wizard — respects the `NO_COLOR` environment variable per https://no-color.org/
- Invalid input feedback in setup wizard prompts

### Changed

- Renamed `mtop` layout preset to `btop` to match the actual binary name
- Shell config key description clarified: "Shell pane: true, false, or command"
- Shared `utils.ts` module with `SAFE_COMMAND_RE`, `GHOSTTY_PATHS`, `resolveCommand`, and `promptUser`
- Shared readline prompt helper extracted from launcher and setup
- `parseIntInRange` from `validation.ts` reused in launcher (replaced hand-rolled parseInt)
- `ensureConfig()` creates empty config file instead of hardcoded `editor=claude` — runtime defaults in `layout.ts` still apply
- `isFirstRun()` export in config.ts for checking whether config file exists without creating it
- `executeScript` uses `execFileSync` instead of `execSync` for osascript (defense-in-depth)
- `resolveCommand` in utils.ts validates command names against `SAFE_COMMAND_RE` before shell execution

### Tests

- 377 tests (up from 244 in v0.3.2) — extensive coverage for setup wizard, completions, launcher, utils, and security features
- Setup wizard coverage: non-TTY guard, user-decline loop, display paths, input feedback
- Sidebar-is-falsy branch in script generation covered

## [0.3.2] - 2026-03-13

### Fixed

- Config-launched panes (lazygit, editors, shell) now cd into the project directory before running commands
- Config display no longer treats `"0"` as falsy (#66)
- Removed misleading shell hint for valid single-word commands (#67)
- `summon set` now validates panes, editor-size, layout, and auto-resize values at write time (#68)
- osascript errors now surface their actual message instead of generic fallback (#69)

### Changed

- `command -v` lookup uses `execFileSync` with argument array for defense-in-depth (#71)
- Coverage thresholds raised from 60/55/85/60 to 95/90/95/95 (#72)
- Added `@internal` annotation to `resetConfigCache` for consistency (#74)

## [0.3.1] - 2026-03-13

### Fixed

- Config warnings, validation, homedir handling, editor flag, and resize conflict (#58, #59, #60, #62, #63)
- CLI audit fixes for set truthiness, config display, and layout validation (#43, #44, #45, #46, #51)
- Config hardening: explicit file permissions and getConfig cleanup (#47, #50)
- Empty config values no longer override preset layouts
- Detect Ghostty in `~/Applications` for Homebrew installs
- Exclude subprocess-tested files from v8 coverage (#54)

### Changed

- Cache resolved command paths to avoid duplicate lookups (#61)
- Lazy-load readline in launcher (#48, #52)
- Use `homedir()` for Ghostty path detection
- Updated dev dependencies (#49)

### Added

- Documentation for `.summon` file trust model (#55)

## [0.3.0] - 2026-03-13

### Added

- Auto-resize enabled by default — sidebar auto-resizes to match `editor-size` without needing `--auto-resize` flag
- `--no-auto-resize` flag to opt out of auto-resize (#37)
- Relative path resolution for target argument (#38)
- Per-subcommand `--help` support (#33)
- Context-aware empty-value messages in `summon set` (#40)
- Shared validation constants (`PANES_MIN`, `EDITOR_SIZE_MIN/MAX/DEFAULT`) (#42)

### Fixed

- Shell metacharacter escaping in root pane editor command (#39)
- `--panes` and `--editor-size` validated at parse time (#34)
- `ensureCommand` error message reflects actual config key (#35)
- Dry-run skips Ghostty/command checks for CI compatibility
- Auto-resize repositioned before editor column splits

### Changed

- Config reads cached and command resolution deduplicated (#31, #32)

### Docs

- Publishing guide updated with version placeholders (#41)

## [0.2.0] - 2026-03-13

### Added

- Experimental `--auto-resize` flag to resize sidebar to match editor-size

### Fixed

- Root pane now `cd`s into the project directory before launching editor
- `summon set` rejects unknown config keys with exit 1
- osascript execution failures show user-friendly error message
- Config `writeKV` sanitizes newlines to prevent config file corruption

### Changed

- `ensureConfig` cached to avoid redundant filesystem reads

## [0.1.0] - 2026-03-13

### Added

- CLI entry point with subcommand dispatch (launch, add, remove, list, set, config)
- Config system: machine-level (`~/.config/summon/`) and per-project (`.summon`)
- Layout planner with 5 presets: minimal, full, pair, cli, btop
- AppleScript generator for Ghostty native splits
- Launcher orchestrator with config resolution and command dependency checks
- Auto-install prompts for missing commands (claude, lazygit)
- Ghostty detection (checks `/Applications/Ghostty.app`)
- CLI flags: `--layout`, `--editor`, `--panes`, `--editor-size`, `--sidebar`, `--shell`
- Config resolution order: CLI > project > machine > preset > defaults
- README with layout diagrams, command reference, and config documentation
- Architecture documentation and user manual
- CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md
- GitHub issue templates and PR template
- CI pipeline with Node 18/20/22 matrix on macOS
- CodeQL security scanning
- Dependabot for npm and GitHub Actions

[Unreleased]: https://github.com/juan294/summon/compare/v1.7.0...develop
[1.7.0]: https://github.com/juan294/summon/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/juan294/summon/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/juan294/summon/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/juan294/summon/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/juan294/summon/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/juan294/summon/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/juan294/summon/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/juan294/summon/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/juan294/summon/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/juan294/summon/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/juan294/summon/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/juan294/summon/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/juan294/summon/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/juan294/summon/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/juan294/summon/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/juan294/summon/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/juan294/summon/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/juan294/summon/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/juan294/summon/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/juan294/summon/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/juan294/summon/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/juan294/summon/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/juan294/summon/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/juan294/summon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/juan294/summon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/juan294/summon/releases/tag/v0.1.0
