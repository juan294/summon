# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/juan294/summon/compare/v0.6.1...develop
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
