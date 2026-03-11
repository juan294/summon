# Plan: Initial Implementation of Summon

**Date:** 2026-03-10
**Goal:** Build a working Ghostty workspace launcher that matches termplex's feature set using AppleScript instead of tmux.

## Background

Summon replaces termplex's tmux backend with Ghostty's native AppleScript API (Ghostty 1.3.0+). The config system, presets, project registry, and CLI interface are conceptually identical. The key difference is in `script.ts` (new) replacing `launcher.ts`'s tmux commands with AppleScript generation.

Reference: `docs/research/` in the termplex repo contains the full Ghostty capability mapping (`2026-03-10-ghostty-native-replacement.md`).

## Architecture Overview

```
src/
  index.ts       CLI entry point (same structure as termplex)
  config.ts      Config read/write for ~/.config/summon/ (adapted from termplex)
  layout.ts      Layout planning (identical logic to termplex)
  script.ts      NEW: AppleScript generator (pure function)
  launcher.ts    Orchestrator (adapted: osascript instead of tmux)
  globals.d.ts   Build-time constants
```

### Key Difference from Termplex

Instead of calling `tmux split-window`, `tmux new-session`, etc., summon:
1. Generates an AppleScript string via `script.ts`
2. Executes it via `execSync('osascript -e "..."')`

The AppleScript uses Ghostty's API:
- `new surface configuration` -- set working directory per pane
- `new window with configuration` -- create window
- `split <terminal> direction <dir>` -- create splits
- `input text` + `send key "enter"` -- send commands to panes
- `focus <terminal>` -- focus a specific pane

## Phases

### Phase 1: Core Infrastructure
Files: `config.ts`, `layout.ts`, `globals.d.ts` + tests

Port config.ts and layout.ts from termplex with minimal changes:
- `config.ts`: Change config dir from `~/.config/termplex/` to `~/.config/summon/`
- `config.ts`: Project file reads `.summon` instead of `.termplex`
- `layout.ts`: Identical to termplex (same presets, same algorithm)

**Success criteria (automated):**
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm test` passes (config + layout tests)

### Phase 2: AppleScript Generator
Files: `script.ts` + tests

New pure function `generateAppleScript(plan: LayoutPlan, targetDir: string): string` that:
1. Creates a `surface configuration` with working directory
2. Creates a new Ghostty window
3. Builds the split tree following termplex's layout algorithm:
   - Split sidebar right from root
   - Split right column right from root (if needed)
   - Split left column panes vertically
   - Split right column panes vertically (editors + server)
4. Sends commands to each pane via `input text` + `send key "enter"`
5. Focuses the root editor pane

This is a pure function -- it returns a string, no side effects. Tests verify the generated AppleScript contains the right structure without needing Ghostty.

**Success criteria (automated):**
- `pnpm typecheck` passes
- `pnpm lint` passes
- Tests verify generated script for each preset (minimal, full, pair, cli, mtop)
- Tests verify pane commands are sent correctly
- Tests verify working directory is set

### Phase 3: Launcher Orchestrator
Files: `launcher.ts` + tests

Adapt termplex's launcher.ts:
- Replace `tmux()` helper with `osascript()` helper
- Replace `buildSession()` with `executeScript(generateAppleScript(plan, dir))`
- Remove session reattach logic (Ghostty has no session persistence)
- Remove `--force` flag (no sessions to kill)
- Remove mouse mode config (Ghostty handles this natively)
- Keep: config resolution, command dependency checks, install prompts
- Add: Ghostty detection (check if Ghostty.app exists or is running)

**Success criteria (automated):**
- `pnpm typecheck` passes
- `pnpm lint` passes
- Tests verify config resolution (same layering as termplex)
- Tests verify Ghostty detection
- Tests verify osascript execution (mocked)

### Phase 4: CLI Entry Point
Files: `index.ts` + build verification

Adapt termplex's index.ts:
- Remove `--force` flag (no sessions)
- Remove `--mouse` / `--no-mouse` flags (not applicable)
- Change help text references from termplex to summon
- Change config file references from `.termplex` to `.summon`
- Change binary name in help from `termplex`/`ws` to `summon`

**Success criteria (automated):**
- `pnpm typecheck` passes
- `pnpm lint` passes
- `pnpm build` succeeds
- `pnpm test` passes (all tests)
- `./dist/index.js --help` outputs correct help text
- `./dist/index.js --version` outputs version

### Phase 5: Manual Integration Testing
No code changes. Test against real Ghostty.

**Success criteria (manual -- requires Ghostty 1.3.0+):**
- [ ] `summon .` creates a Ghostty window with correct layout
- [ ] All 5 presets create correct pane arrangements
- [ ] Commands run in correct panes
- [ ] Per-project `.summon` config works
- [ ] `summon add/remove/list/set/config` all work
- [ ] Error messages are clear for: missing Ghostty, bad config, unknown project

## Features Intentionally Omitted

These termplex features are dropped because they don't apply to Ghostty:

| Feature | Why dropped |
|---|---|
| `--force` flag | No persistent sessions to kill |
| `--mouse` / `--no-mouse` | Ghostty handles mouse natively |
| Session reattach | Ghostty has no session persistence |
| tmux install prompt | No tmux dependency |
| tmux title config | Ghostty manages titles natively |

## Future Considerations (not in scope)

- **Shell completion** -- Add after initial release, same pattern as termplex
- **Session persistence** -- If Ghostty adds this, adopt it
- **Window sizing** -- Ghostty's `window-width`/`window-height` could be used
- **Per-pane font size** -- Ghostty's surface config supports this
- **Environment variables per pane** -- Ghostty's surface config supports this
