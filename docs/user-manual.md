# User Manual

Complete usage reference for summon.

## Prerequisites

- **Node.js >= 18**
- **macOS** (AppleScript is macOS-only)
- **[Ghostty](https://ghostty.org) 1.3.0+** with AppleScript enabled (default)

### Ghostty Configuration

Ensure AppleScript is enabled in your Ghostty config (it's on by default):

```
# ~/.config/ghostty/config
macos-applescript = true
```

On first use, macOS will prompt you to grant Automation permissions for your terminal to control Ghostty.

## Installation

```bash
npm i -g summon-ws
```

This installs the `summon` command.

## Updating

```bash
npm i -g summon-ws
```

Check your current version:

```bash
summon --version
```

## First Launch Walkthrough

```bash
# 1. Navigate to your project
cd ~/code/myapp

# 2. Launch a workspace
summon .

# 3. A new Ghostty window opens with:
#    - 2 editor panes running 'claude'
#    - 1 server pane (plain shell for dev servers)
#    - 1 sidebar pane running 'lazygit'

# 4. Navigate between panes
#    Use Ghostty's native split navigation keybindings
#    Default: Ctrl+Shift+Arrow keys (or your custom keybindings)

# 5. Zoom a pane
#    Use Ghostty's toggle_split_zoom keybinding
```

## Command Reference

### `summon <target>`

Launch a workspace. The target can be:

- `.` -- current directory
- An absolute path (`/Users/juan/project`) or home-relative path (`~/project`)
- A registered project name (see `summon add`)

```bash
summon .
summon ~/code/myapp
summon myapp
```

### `summon add <name> <path>`

Register a project name mapped to a directory path. Paths support `~` expansion.

```bash
summon add myapp ~/code/myapp
summon add api ~/code/backend/api
```

### `summon remove <name>`

Remove a registered project.

```bash
summon remove myapp
```

### `summon list`

List all registered projects.

```bash
$ summon list
Registered projects:
  myapp → /Users/juan/code/myapp
  api → /Users/juan/code/backend/api
```

### `summon set <key> [value]`

Set a machine-level config value. Omit the value to reset to a plain shell.

```bash
summon set editor vim           # use vim instead of claude
summon set sidebar              # sidebar becomes a plain shell
summon set panes 4              # four editor panes
summon set editor-size 80       # editor grid takes 80% width
summon set server false         # disable the server pane
summon set server "npm run dev" # run a command in the server pane
summon set layout minimal       # default to the minimal preset
```

### `summon config`

Show current machine configuration.

```bash
$ summon config
Machine config:
  editor → claude
  sidebar → lazygit
  panes → 2
  editor-size → 75
```

### CLI Flags

Flags override both machine and per-project config for a single launch.

| Flag | Description |
|---|---|
| `-l`, `--layout <preset>` | Use a layout preset (`minimal`, `full`, `pair`, `cli`, `mtop`) |
| `--editor <cmd>` | Override editor command |
| `--panes <n>` | Override number of editor panes |
| `--editor-size <n>` | Override editor width percentage |
| `--sidebar <cmd>` | Override sidebar command |
| `--server <value>` | Server pane: `true`, `false`, or a command |
| `-n`, `--dry-run` | Print generated AppleScript without executing |
| `-n`, `--dry-run` | Print generated AppleScript without executing |
| `-h`, `--help` | Show help message |
| `-v`, `--version` | Show version number |

```bash
summon . --layout minimal
summon . -l pair --server "npm run dev"
summon . --editor vim --panes 2
```

## Layout Presets

Presets are named shortcuts for common layout configurations.

| Preset | Editor panes | Server pane | Description |
|---|---|---|---|
| `full` | 3 | yes (shell) | Multi-agent coding + dev server |
| `pair` | 2 | yes (shell) | Two editors + dev server |
| `minimal` | 1 | no | Simple editor + sidebar |
| `cli` | 1 | yes (shell) | CLI tool development -- editor + server |
| `mtop` | 2 | yes (shell) | System monitoring -- editor + mtop + server |

Use a preset via CLI flag, per-project config, or machine config:

```bash
# CLI flag (one-time)
summon . --layout minimal

# Per-project config (in .summon)
layout=minimal

# Machine config (persistent default)
summon set layout pair
```

Individual keys override preset values. For example, `--layout minimal --server true` gives you 1 editor pane but keeps the server pane.

## Server Pane

The server pane sits at the bottom of the right column. It supports three modes:

| Value | Behavior |
|---|---|
| `true` (default) | Plain shell -- you run commands manually |
| `false` or empty | No server pane at all |
| Any other string | Runs that command automatically (e.g. `npm run dev`) |

```bash
# Disable the server pane
summon . --server false

# Run a dev server automatically
summon . --server "npm run dev"

# Persistent config
summon set server "python -m http.server"
```

## Per-project Config

Place a `.summon` file in your project root to override machine-level config for that project. The file uses `key=value` format:

```ini
# ~/code/myapp/.summon
layout=pair
server=npm run dev
```

```ini
# ~/code/cli-tool/.summon
layout=minimal
editor=vim
```

### Config Resolution Order

When summon launches, config values are resolved in this order (first wins):

1. **CLI flags** (`--layout`, `--editor`, etc.)
2. **Project config** (`.summon` in the target directory)
3. **Machine config** (`~/.config/summon/config`)
4. **Preset expansion** (if a `layout` key resolved above)
5. **Built-in defaults** (`editor=claude`, `panes=2`, etc.)

## Config Reference

| Key | Type | Default | Description |
|---|---|---|---|
| `editor` | string | `claude` | Command launched in each editor pane. Set to empty for a plain shell. |
| `sidebar` | string | `lazygit` | Command launched in the sidebar pane. Set to empty for a plain shell. |
| `panes` | integer | `2` | Number of editor panes. |
| `editor-size` | integer | `75` | Width percentage allocated to the editor grid. The sidebar gets the remainder. |
| `server` | string | `true` | Server pane toggle: `true` (shell), `false` (none), or a command to run. |
| `layout` | string | | Default layout preset (`minimal`, `full`, `pair`, `cli`, or `mtop`). |

Machine config: `~/.config/summon/config`
Project config: `.summon` (in project root)
Project mappings: `~/.config/summon/projects`

All files use `key=value` format, one entry per line.

## Layout Diagrams

### full preset / panes=3

```
+-------------------- 75% ---------------------+------ 25% ------+
|                    |                          |                 |
|    editor (1)      |    editor (3)            |    sidebar      |
|                    |                          |                 |
+--------------------+--------------------------+                 |
|                    |                          |                 |
|    editor (2)      |    server (shell)        |                 |
|                    |                          |                 |
+--------------------+--------------------------+-----------------+
      left col             right col                sidebar
```

### pair preset / panes=2

```
+-------------------- 75% ---------------------+------ 25% ------+
|                    |                          |                 |
|                    |    editor (2)            |                 |
|    editor (1)      |                          |    sidebar      |
|                    +--------------------------+                 |
|                    |                          |                 |
|                    |    server (shell)        |                 |
|                    |                          |                 |
+--------------------+--------------------------+-----------------+
      left col             right col                sidebar
```

### minimal preset / panes=1

```
+-------------------- 75% ---------------------+------ 25% ------+
|                                              |                 |
|                                              |                 |
|                                              |                 |
|    editor (1)                                |    sidebar      |
|                                              |                 |
|                                              |                 |
|                                              |                 |
+----------------------------------------------+-----------------+
```

## Differences from tmux-based Tools

| Feature | tmux-based (termplex) | Ghostty-native (summon) |
|---|---|---|
| Pane rendering | tmux draws pane borders | Ghostty native splits |
| Session persistence | Yes (detach/reattach) | No (close = gone) |
| Mouse/scrollback | tmux mouse mode | Native Ghostty |
| Colors/rendering | tmux passthrough | Direct GPU rendering |
| Navigation | tmux keybindings | Ghostty split keybindings |
| Platform | Anywhere tmux runs | macOS only |

## Troubleshooting

### Ghostty not found

Summon checks that `/Applications/Ghostty.app` exists. If you see an error, ensure Ghostty is installed at that path.

### macOS Automation permission

On first use, macOS will ask you to grant permission for your terminal to control Ghostty via AppleScript. Go to System Settings > Privacy & Security > Automation and ensure your terminal is allowed to control Ghostty.

### Unknown project name

```
Unknown project: myapp
Register it with: summon add myapp /path/to/project
Or see available:  summon list
```

Register the project with `summon add` or use a direct path instead.

### Config file location

All config files are at `~/.config/summon/`:

```
~/.config/summon/
  config      machine-level settings
  projects    project name -> path mappings
```

Per-project config lives in your project root as `.summon`.

Files are plain text (`key=value` format) and safe to edit manually.
