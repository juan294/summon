# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/juan294/summon/compare/v1.0.0...develop
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
