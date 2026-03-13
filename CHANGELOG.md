# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Interactive setup wizard (`summon setup`) for first-run onboarding — choose layout, editor, sidebar, and server preferences with numbered selection
- First-run auto-trigger: setup wizard launches automatically when no config file exists (TTY only)
- Tool detection during setup — checks if chosen commands (editor, sidebar, Ghostty) are installed, shows install hints for missing tools
- `NO_COLOR` support in setup wizard — respects the `NO_COLOR` environment variable per https://no-color.org/
- Shared `utils.ts` module with `SAFE_COMMAND_RE`, `GHOSTTY_PATHS`, and `resolveCommand` (extracted from launcher.ts and setup.ts)

### Changed

- `ensureConfig()` creates empty config file instead of hardcoded `editor=claude` — runtime defaults in `layout.ts` still apply
- `isFirstRun()` export in config.ts for checking whether config file exists without creating it
- `executeScript` uses `execFileSync` instead of `execSync` for osascript (defense-in-depth)
- `resolveCommand` in utils.ts validates command names against `SAFE_COMMAND_RE` before shell execution

## [0.3.2] - 2026-03-13

### Fixed

- Config-launched panes (lazygit, editors, server) now cd into the project directory before running commands
- Config display no longer treats `"0"` as falsy (#66)
- Removed misleading server hint for valid single-word commands (#67)
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
- Layout planner with 5 presets: minimal, full, pair, cli, mtop
- AppleScript generator for Ghostty native splits
- Launcher orchestrator with config resolution and command dependency checks
- Auto-install prompts for missing commands (claude, lazygit)
- Ghostty detection (checks `/Applications/Ghostty.app`)
- CLI flags: `--layout`, `--editor`, `--panes`, `--editor-size`, `--sidebar`, `--server`
- Config resolution order: CLI > project > machine > preset > defaults
- README with layout diagrams, command reference, and config documentation
- Architecture documentation and user manual
- CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md
- GitHub issue templates and PR template
- CI pipeline with Node 18/20/22 matrix on macOS
- CodeQL security scanning
- Dependabot for npm and GitHub Actions

[Unreleased]: https://github.com/juan294/summon/compare/v0.3.2...develop
[0.3.2]: https://github.com/juan294/summon/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/juan294/summon/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/juan294/summon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/juan294/summon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/juan294/summon/releases/tag/v0.1.0
