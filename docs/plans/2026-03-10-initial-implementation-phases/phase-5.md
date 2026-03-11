# Phase 5: Manual Integration Testing

## Scope

Test summon against a real Ghostty 1.3.0+ installation. No code changes -- just verification.

## Prerequisites

- macOS with Ghostty 1.3.0+ installed
- AppleScript enabled in Ghostty config (`macos-applescript = true`, which is the default)
- Automation permissions granted (macOS will prompt on first use)

## Test Plan

### Basic Launch
- [ ] `summon .` in a project directory creates a Ghostty window
- [ ] Window has correct number of panes (3 editors + 1 server + 1 sidebar for `full` preset)
- [ ] Working directory is set correctly in all panes
- [ ] Commands are running in the correct panes (claude in editors, lazygit in sidebar)
- [ ] Focus is on the root editor pane

### All Presets
- [ ] `summon . --layout minimal` -- 1 editor + sidebar, no server
- [ ] `summon . --layout full` -- 3 editors + server + sidebar
- [ ] `summon . --layout pair` -- 2 editors + server + sidebar
- [ ] `summon . --layout cli` -- 1 editor + npm login + sidebar
- [ ] `summon . --layout mtop` -- 1 editor + mtop + server + sidebar

### Config Management
- [ ] `summon set editor vim` -- sets editor
- [ ] `summon config` -- shows config
- [ ] `summon add test .` -- registers project
- [ ] `summon list` -- lists projects
- [ ] `summon test` -- launches by project name
- [ ] `summon remove test` -- removes project

### Per-project Config
- [ ] Create `.summon` file with `layout=minimal`
- [ ] `summon .` respects the project config
- [ ] CLI flags override project config

### Error Handling
- [ ] `summon nonexistent` -- clear error about unknown project
- [ ] Running on a non-existent directory -- clear error
- [ ] Running without Ghostty installed/running -- clear error

### Custom Commands
- [ ] `summon . --server "npm run dev"` -- server pane runs the command
- [ ] `summon . --editor vim` -- editor panes run vim
- [ ] `summon . --sidebar htop` -- sidebar runs htop

## Success Criteria

All checkboxes above must pass. Any failures should be documented with:
- What happened
- What was expected
- Steps to reproduce

Fixes go back to the relevant phase (2, 3, or 4) for implementation.
