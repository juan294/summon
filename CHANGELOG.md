# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/juan294/summon/compare/v0.2.0...develop
[0.2.0]: https://github.com/juan294/summon/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/juan294/summon/releases/tag/v0.1.0
