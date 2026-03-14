# User Manual

Complete usage reference for summon.

## Prerequisites

- **Node.js >= 18**
- **macOS** (AppleScript is macOS-only)
- **[Ghostty](https://ghostty.org) 1.3.1+** with AppleScript enabled (default)

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

## First Launch — Setup Wizard

The first time you run summon (when no config file exists at `~/.config/summon/config`), an interactive setup wizard launches automatically:

```bash
cd ~/code/myapp
summon .
```

The wizard walks you through five choices:

1. **Layout** — choose from 5 presets (minimal, pair, full, cli, btop) with ASCII diagrams
2. **Editor** — pick from detected editors (claude, nvim, vim, code, etc.) or enter a custom command
3. **Sidebar** — pick from detected tools (lazygit, gitui, tig, btop, etc.) or enter a custom command
4. **Shell pane** — plain shell, disabled, or a custom command (e.g. `npm run dev`)
5. **Starship prompt theme** — choose a Starship preset for per-workspace prompt theming (requires [Starship](https://starship.rs) installed). Color palette swatches are shown for presets with custom colors. Includes a "Random (surprise me!)" option.

After confirming, the wizard:
- Saves your choices to `~/.config/summon/config`
- Checks that your chosen tools are installed (shows install hints for missing ones)
- Continues to launch your workspace with the new settings

You can re-run the wizard anytime with `summon setup`.

### Skipping the wizard

The wizard only auto-triggers when:
- No config file exists AND stdin is a TTY

In non-interactive environments (CI, piped input), summon uses runtime defaults without prompting. You can also skip the wizard entirely by setting config values directly:

```bash
summon set editor vim
summon set sidebar lazygit
summon set layout pair
summon .
```

### After setup

```bash
# Navigate between panes
#   Use Ghostty's native split navigation keybindings
#   Default: Ctrl+Shift+Arrow keys (or your custom keybindings)

# Zoom a pane
#   Use Ghostty's toggle_split_zoom keybinding
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

### `summon setup`

Launch the interactive setup wizard. Guides you through choosing your preferred layout, editor, sidebar, shell, and Starship prompt theme configuration.

```bash
summon setup
```

The wizard:
- Shows all 5 layout presets with ASCII diagrams
- Detects which editors and sidebar tools are installed on your system
- Lets you enter custom commands for any pane
- Offers Starship prompt theme selection with color palette swatches (if Starship is installed)
- Validates chosen tools and shows install hints for missing ones
- Saves settings to `~/.config/summon/config`

Requires an interactive terminal (TTY). In non-interactive environments, configure manually with `summon set`.

### `summon set <key> [value]`

Set a machine-level config value. Omit the value to reset to a plain shell.

```bash
summon set editor vim           # use vim instead of claude
summon set sidebar              # sidebar becomes a plain shell
summon set panes 4              # four editor panes
summon set editor-size 80       # editor grid takes 80% width
summon set shell false         # disable the shell pane
summon set shell "npm run dev" # run a command in the shell pane
summon set layout minimal       # default to the minimal preset
summon set starship-preset tokyo-night  # per-workspace Starship prompt theme
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
| `-l`, `--layout <preset>` | Use a layout preset (`minimal`, `full`, `pair`, `cli`, `btop`) |
| `-e`, `--editor <cmd>` | Override editor command |
| `-p`, `--panes <n>` | Override number of editor panes |
| `--editor-size <n>` | Override editor width percentage |
| `-s`, `--sidebar <cmd>` | Override sidebar command |
| `--shell <value>` | Shell pane: `true`, `false`, or a command |
| `--auto-resize` | Resize sidebar to match editor-size (default: on) |
| `--no-auto-resize` | Disable auto-resize |
| `--starship-preset <preset>` | Starship prompt preset name (per-workspace) |
| `-n`, `--dry-run` | Print generated AppleScript without executing |
| `-h`, `--help` | Show help message |
| `-v`, `--version` | Show version number |

```bash
summon . --layout minimal
summon . -l pair --shell "npm run dev"
summon . --editor vim --panes 2
```

## Shell Completions

Summon supports tab completion for project names, subcommands, flags, config keys, and layout presets.

### Setup

#### zsh (macOS default)

Add to your `~/.zshrc`:

```bash
eval "$(summon completions zsh)"
```

Then reload: `source ~/.zshrc`

#### bash

Add to your `~/.bashrc` or `~/.bash_profile`:

```bash
eval "$(summon completions bash)"
```

Then reload: `source ~/.bashrc`

### What gets completed

- `summon <TAB>` — subcommands, registered project names, directories
- `summon remove <TAB>` — registered project names
- `summon set <TAB>` — config keys
- `summon set layout <TAB>` — layout presets
- `summon set starship-preset <TAB>` — Starship preset names (dynamic)
- `summon --layout <TAB>` — layout presets
- `summon --starship-preset <TAB>` — Starship preset names (dynamic)
- `summon --<TAB>` — all CLI flags

Project names are read dynamically from `~/.config/summon/projects`,
so newly added projects are immediately completable.

## Layout Presets

Presets are named shortcuts for common layout configurations.

| Preset | Editor panes | Shell pane | Description |
|---|---|---|---|
| `full` | 3 | yes (shell) | Multi-agent coding + shell |
| `pair` | 2 | yes (shell) | Two editors + shell |
| `minimal` | 1 | no | Simple editor + sidebar |
| `cli` | 1 | yes (shell) | CLI tool development -- editor + shell |
| `btop` | 2 | yes (shell) | System monitoring -- editor + btop + shell |

Use a preset via CLI flag, per-project config, or machine config:

```bash
# CLI flag (one-time)
summon . --layout minimal

# Per-project config (in .summon)
layout=minimal

# Machine config (persistent default)
summon set layout pair
```

Individual keys override preset values. For example, `--layout minimal --shell true` gives you 1 editor pane but keeps the shell pane.

## Shell Pane

The shell pane sits at the bottom of the right column. It supports three modes:

| Value | Behavior |
|---|---|
| `true` (default) | Plain shell -- you run commands manually |
| `false` or empty | No shell pane at all |
| Any other string | Runs that command automatically (e.g. `npm run dev`) |

```bash
# Disable the shell pane
summon . --shell false

# Run a command automatically
summon . --shell "npm run dev"

# Persistent config
summon set shell "python -m http.server"
```

## Per-project Config

Place a `.summon` file in your project root to override machine-level config for that project. The file uses `key=value` format:

```ini
# ~/code/myapp/.summon
layout=pair
shell=npm run dev
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
| `shell` | string | `true` | Shell pane toggle: `true` (shell), `false` (none), or a command to run. |
| `layout` | string | | Default layout preset (`minimal`, `full`, `pair`, `cli`, or `btop`). |
| `auto-resize` | boolean | `true` | Auto-resize sidebar to match editor-size. |
| `starship-preset` | string | | Starship prompt theme preset. When set, each workspace launches with `STARSHIP_CONFIG` pointing to a cached preset TOML file at `~/.config/summon/starship/<preset>.toml`. Requires [Starship](https://starship.rs) installed. |

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
|    editor (2)      |    shell                 |                 |
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
|                    |    shell                 |                 |
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

## Environment Variables

| Variable | Description |
|---|---|
| `SHELL` | Login shell used to execute pane commands. Must be an absolute path (e.g., `/bin/zsh`). Falls back to `/bin/bash` if unset or invalid. |
| `NO_COLOR` | When set, disables ANSI colors in the setup wizard. Follows the [NO_COLOR](https://no-color.org) standard. |
| `COLORTERM` | When set to `truecolor` or `24bit`, the setup wizard shows colored palette swatches for Starship presets. |
| `STARSHIP_CONFIG` | Set automatically by summon when `starship-preset` is configured. Points each workspace to a cached preset TOML file. Do not set manually. |

## Troubleshooting

### Ghostty not found

Summon checks for Ghostty in `/Applications/Ghostty.app` and `~/Applications/Ghostty.app` (Homebrew). If you see an error, ensure Ghostty is installed at one of those paths.

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
  starship/   cached Starship preset TOML files (auto-generated)
```

Per-project config lives in your project root as `.summon`.

Files are plain text (`key=value` format) and safe to edit manually.

## Security — Shell Metacharacter Detection

When summon reads a `.summon` file from a project directory, it checks the command keys (`editor`, `sidebar`, `shell`) for shell metacharacters: `;`, `|`, `&`, `` ` ``, `$(`, `<`, `>`.

If any are found, summon displays the suspicious commands and prompts for confirmation:

```
⚠  This .summon file contains commands with shell metacharacters:
  shell = npm run dev && echo "done"

Run these commands? [y/N]
```

This protects against accidentally executing unreviewed commands from cloned repositories. The behavior depends on the environment:

| Context | Behavior |
|---|---|
| Interactive terminal (TTY) | Prompts for confirmation (default: no) |
| Non-interactive (CI, piped) | Refuses to execute, exits with error |
| `--dry-run` | Skipped (no commands are executed) |
| CLI flags | Not checked (you typed them yourself) |
| Machine config | Not checked (you set them via `summon set`) |

Only `.summon` project files are checked — CLI flags and machine config are trusted sources since you control them directly.
