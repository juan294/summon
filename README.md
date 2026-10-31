# Summon your Ghostty or Rex workspace!

[![CI](https://github.com/juan294/summon/actions/workflows/ci.yml/badge.svg)](https://github.com/juan294/summon/actions/workflows/ci.yml)
[![CodeQL](https://github.com/juan294/summon/actions/workflows/codeql.yml/badge.svg)](https://github.com/juan294/summon/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/summon-ws)](https://www.npmjs.com/package/summon-ws)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue)](https://www.typescriptlang.org)
[![license](https://img.shields.io/npm/l/summon-ws)](./LICENSE)

Summon your Ghostty or Rex workspace with one command. Native splits, no tmux.

---

## Install

```bash
npm i -g summon-ws
```

Requires Node >= 22.12, macOS, and one of two terminals: [Ghostty](https://ghostty.org) 1.3.1+ (1.4.0 is the recommended security baseline) or Rex (beta). Summon detects the terminal that runs it; Rex needs no extra setup.

Run `summon doctor` to inspect version, capabilities and effective settings. See the [Ghostty workflow guide](docs/ghostty.md) for compatibility, exact pane focus, titles, visibility-aware monitoring and opt-in SSH recipes, and [Summon under Rex](docs/rex.md) for what differs in Rex.

## Quick Start

```bash
summon .                          # launch workspace in current directory
```

On first run, an interactive setup wizard guides you through choosing your editor, sidebar, layout, shell, and Starship prompt theme. You can re-run it anytime:

```bash
summon setup                      # reconfigure workspace defaults
```

<p align="center">
  <img src="assets/setup-wizard.gif" alt="summon setup wizard" width="600">
</p>

Register projects for quick access:

```bash
summon add myapp ~/code/myapp     # register a project
summon myapp                      # launch by project name
```

## How It Works

Under Ghostty, Summon generates and executes AppleScript that drives Ghostty's native split system. Under Rex, it sends one `session.create` request to the Rex server: one session per workspace, one block per pane. No terminal multiplexer of its own -- just the terminal's native panes with commands running in each one. The terminal that runs `summon` decides the backend; see [docs/rex.md](docs/rex.md).

## Default Layout

<!-- Diagram: default 3-pane layout (editor left 60%, sidebar top-right 40%, shell bottom-right 40%) -->
```
summon .    (panes=2, editor=<your editor>, sidebar=<your sidebar>, shell=true)

+------------ 75% (editor grid) ------------+------ 25% ------+
|                                            |                 |
|                                            |                 |
|    editor (1)          editor (2)          |    sidebar      |
|                                            |                 |
+--------------------------------------------+                 |
|                                            |                 |
|                   shell                    |                 |
|                                            |                 |
+--------------------------------------------+-----------------+
               editor grid (75%)                sidebar (25%)
```
The editor grid (left 75%) splits vertically between the two editor panes;
the shell occupies the bottom of the editor grid; the sidebar runs the full
height on the right (25%).

## Layout Presets

| Preset | Panes | Shell | Use case |
|---|---|---|---|
| `full` | 3 | yes | Multi-agent coding + shell |
| `pair` | 2 | yes | Two editors + shell |
| `minimal` | 1 | no | Simple editor + sidebar only |
| `cli` | 1 | yes | CLI tool development -- editor + shell |
| `btop` | 2 | yes | System monitoring -- editor + btop + shell |

```bash
summon . --layout minimal         # 1 editor pane, no shell
summon . -l pair                  # 2 editors + shell
```

## Custom Layouts

Define arbitrary split configurations using a tree DSL:

```bash
summon layout create              # interactive layout builder wizard
summon . --layout my-layout       # launch with a custom layout
```

Custom layouts are saved to `~/.config/summon/layouts/` and can be used anywhere a preset name is accepted.

## Per-project Config

Drop a `.summon` file in your project root to override machine-level config:

```ini
# .summon
layout=minimal
editor=vim
shell=npm run dev
env.PORT=3000
```

Config resolution order: **CLI flags > .summon > machine config > preset > defaults**

## Commands

| Command | Description |
|---|---|
| `summon <target>` | Launch workspace (project name, path, or `.`) |
| `summon setup` | Interactive setup wizard — choose editor, sidebar, layout, shell, Starship theme |
| `summon add <name> <path>` | Register a project name to a directory |
| `summon remove <name>` | Remove a registered project |
| `summon list` | List all registered projects |
| `summon set <key> [value]` | Set a machine-level config value |
| `summon config` | Show current machine configuration |
| `summon open [project]` | Focus a running workspace or launch a stopped one; without a name, pick one interactively |
| `summon export [path]` | Export resolved config as a `.summon` file |
| `summon doctor [--fix] [--verbose]` | Check version, capabilities and effective settings (--fix appends eligible missing settings to an unambiguous existing file; --verbose adds diagnostic info) |
| `summon freeze <name>` | Save current resolved config as a reusable custom layout |
| `summon keybindings [--vim] [--detach-tab]` | Print pane navigation config, optionally including whole-tab detachment |
| `summon layout <action>` | Manage custom layouts (create, save, list, show, delete, edit) |
| `summon status [--once]` | Interactive workspace status dashboard across all projects |
| `summon switch [project]` | Alias for `summon open` |
| `summon inspect <project> [--json]` | Read workspace state and current native pane observations |
| `summon focus <project> [pane]` | Focus the recorded root or named pane by exact native identity |
| `summon title <project> [pane] [--set <text> \| --reset]` | Read, set or clear a tab/pane title override |
| `summon clean <project> [--orphans]` | Close an empty Rex session and end its record; `--orphans` reviews earlier launches (see [docs/rex.md](docs/rex.md)) |
| `summon briefing` | Morning briefing — overnight commits, dirty files, recommendations |
| `summon ports` | Detect port assignments across projects, highlight conflicts |
| `summon snapshot <action>` | Manage context snapshots (save, show, clear) |
| `summon session <name>` | Launch a saved multi-project session — one terminal tab (or Rex session) per project |
| `summon session add <name> <p>...` | Save a session (named list of registered projects) |
| `summon session list` | List saved sessions |
| `summon session show <name>` | Print a session's project list |
| `summon session remove <name>` | Delete a saved session |
| `summon session --all` | Launch every registered project as tabs |
| `summon trust <dir>` | Trust a project's `.summon` file (required before first launch in untrusted directories) |
| `summon completions <shell>` | Generate shell completion script (`zsh`, `bash`, `fish`) |

`summon open myapp` and `summon switch myapp` focus the workspace when it is running and launch it when it is stopped; without a name both show the same picker. `summon focus myapp` only focuses an existing recorded pane, and `summon myapp` launches explicitly. Missing or legacy native identity produces recovery guidance; focus does not automatically launch a replacement.

## CLI Flags

| Flag | Description |
|---|---|
| `-l, --layout <preset>` | Use a layout preset (`minimal`, `full`, `pair`, `cli`, `btop`) |
| `-e, --editor <cmd>` | Override editor command |
| `-p, --panes <n>` | Override number of editor panes |
| `--editor-size <n>` | Override editor width percentage |
| `-s, --sidebar <cmd>` | Override sidebar command |
| `--shell <value>` | Shell pane: `true`, `false`, or a command |
| `--auto-resize` | Resize sidebar to match editor-size (default: on) |
| `--no-auto-resize` | Disable auto-resize |
| `--starship-preset <preset>` | Starship prompt preset name (per-workspace) |
| `--font-size <n>` | Override font size for workspace panes |
| `--env KEY=VALUE` | Set environment variable (repeatable) |
| `--on-start <cmd>` | Run a command before workspace creation |
| `--new-window` | Open workspace in a new terminal window (a fresh session under Rex) |
| `--new-tab` | Open workspace in a new terminal tab |
| `--clean` | Auto-close stale panes from prior Ghostty session (default: off) |
| `--no-clean` | Skip auto-close of restored panes |
| `--fullscreen` | Start workspace in fullscreen mode |
| `--maximize` | Start workspace maximized |
| `--float` | Float workspace window on top |
| `--no-project-config` | Skip the `.summon` file (do not require trust) |
| `-n, --dry-run` | Print the generated AppleScript (or, under Rex, the `session.create` request) without executing |
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

## Config Keys

| Key | Default | Description |
|---|---|---|
| `editor` | *(set during setup)* | Command launched in editor panes |
| `sidebar` | `lazygit` | Command launched in the sidebar pane |
| `panes` | `2` | Number of editor panes |
| `editor-size` | `75` | Width percentage for the editor grid |
| `shell` | `true` | Shell pane: `true` (shell), `false` (none), or a command |
| `layout` | | Default layout preset |
| `auto-resize` | `true` | Auto-resize sidebar to match editor-size |
| `clean` | `false` | Auto-close stale panes from a prior restored Ghostty session |
| `starship-preset` | | Starship prompt theme preset (per-workspace) |
| `font-size` | | Font size for workspace panes (points) |
| `on-start` | | Command to run before workspace creation |
| `on-stop` | | Command to run after workspace closes |
| `new-window` | `false` | Open workspace in a new Ghostty window (under Rex, a new session in the current window; only the `--new-window` flag skips the switch to a running session) |
| `fullscreen` | `false` | Start workspace in fullscreen mode |
| `maximize` | `false` | Start workspace maximized |
| `float` | `false` | Float workspace window on top |

Machine config is stored at `~/.config/summon/config`:

```bash
summon set editor vim               # use vim as the editor
summon set shell "npm run dev"      # run a command in the shell pane
summon set layout minimal           # default to minimal preset
summon set starship-preset tokyo-night  # per-workspace Starship prompt theme
summon set font-size 14                # font size for workspace panes
summon set on-start "npm install"      # run before workspace creation
summon set new-window true             # always open in a new window
summon set clean true                  # enable auto-clean of restored panes (default off)
summon set env.API_KEY sk-123          # per-workspace environment variable
```

### Auto-clearing restored panes (`--clean` / `--no-clean`)

When Ghostty restores panes from a previous session, running `summon` from one
of those panes would otherwise nest the new layout inside whichever pane happens
to be first. By default, summon detects this case and closes the extra panes
before laying out the workspace:

```
Clearing 4 stale panes from previous session...
```

To skip this behavior for a single run or permanently:

```bash
summon <project> --no-clean         # one-off opt-out
summon set clean false              # global opt-out
summon <project> --clean            # force clean (overrides config)
```

Auto-clean is skipped when:
- `SUMMON_WORKSPACE` is set (you're already inside a live summon workspace — the existing nesting warning handles that case).
- `--new-window` is passed (a fresh window has nothing to clean).
- The current tab has only one pane.
- Dry-run mode (`--dry-run`).

> **Note:** Any TUI process in a closed pane (LazyGit, vim, etc.) receives SIGHUP. Save your work before running `summon` from a restored multi-pane tab, or use `--no-clean` to preserve the panes.

## Docs

- [Architecture](docs/architecture.md) -- module map, AppleScript generation, layout algorithm
- [User Manual](docs/user-manual.md) -- full command reference, walkthrough, troubleshooting
- [Ghostty Workflows](docs/ghostty.md) -- version/capability diagnostics, pane focus, titles, visibility and SSH
- [Summon under Rex](docs/rex.md) -- backend detection, session and pane mapping, already-running behavior, `summon clean`, per-launch files
- [Changelog](CHANGELOG.md) -- release history
- [Publishing](docs/publishing.md) -- npm publish checklist

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for details on the development workflow, commit conventions, and PR guidelines.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Environment Variables

| Variable | Description |
|---|---|
| `SHELL` | Login shell used to execute pane commands. Must be an absolute path. Falls back to `/bin/bash` if unset or invalid. |
| `NO_COLOR` | When set, disables ANSI colors in the setup wizard. Follows the [NO_COLOR](https://no-color.org) standard. |
| `FORCE_COLOR` | `1` turns ANSI colors on and `0` turns them off, whether or not stdout is a terminal. `NO_COLOR` wins over it. |
| `COLORTERM` | When set to `truecolor` or `24bit`, the setup wizard shows colored palette swatches for Starship presets. |
| `STARSHIP_CONFIG` | Set automatically when `starship-preset` is configured. Points each workspace to a cached preset TOML file. Do not set manually. |
| `SUMMON_WORKSPACE` | Set to `1` inside summon workspaces. Used to detect and warn about nested launches. |
| `SUMMON_DEBUG` | Set to `1` to enable debug output. Each message is written to stderr with an ISO timestamp; nothing is written to a file. |
| `SUMMON_NO_CACHE` | No effect. It disabled a cross-invocation read cache (`~/.config/summon/cache.json`), which is gone; config is always read from disk. An old `cache.json` is no longer read, and you can delete it. |
| `SUMMON_NO_SPINNER` | When set (to any value), launch progress is printed as plain lines instead of an animated spinner. |
| `SUMMON_NO_VISIBILITY` | Set to `1` to keep normal status-monitor polling instead of negotiating terminal visibility reports. |
| `EDITOR` | Editor used by `summon layout edit`. Falls back to `vi` if unset. |
| `TERM_PROGRAM` | Set by your terminal. Summon reads it to pick the backend: `rex` selects Rex, `ghostty` selects Ghostty. Unset or another terminal: Ghostty when installed, else Rex (see [docs/rex.md](docs/rex.md)). |
| `XDG_CONFIG_HOME` | Read by `summon doctor --fix`. When it points anywhere other than `~/.config`, doctor does not edit the Ghostty config, because Ghostty may load another file. |
| `REX_SERVER` | Set by Rex terminals; inside Rex, Summon uses it as the server (else `~/Library/Application Support/rex/server.sock`). With `TERM_PROGRAM` unset, an inherited value selects Rex only when `rex whoami` answers on it; other terminals ignore it. |
| `REX_BIN_DIR` | Set by Rex terminals. Searched for the `rex` CLI after `PATH`, before the Rex app bundles. |

## Trust Model

`.summon` files configure commands that summon executes in each pane (`editor`, `sidebar`, `shell`, `on-start`). Running `summon .` in a directory will execute whatever commands its `.summon` file specifies -- this is the same trust model as `Makefile`, direnv `.envrc`, or VS Code `.vscode/tasks.json`.

Summon uses a direnv-style trust gate: before a project's `.summon` file is acted upon, its SHA-256 hash must be recorded as trusted. The first time you run summon in a directory with a `.summon` file, or after that file changed (for example after `git pull`), summon says which case it is. On a terminal it shows the file and asks `Trust and launch? [y/N]`; `y` trusts exactly the content shown and launches, and `n` exits with 130. Without a terminal (scripts, CI) and in `summon session --all`, nothing is asked: the launch fails, or the project is skipped. You can also grant trust explicitly:

```bash
summon trust .                    # trust the .summon file in the current directory
summon trust ~/code/myapp         # trust a specific project's .summon file
```

Trust is revoked automatically if the file content changes. Run `summon trust <dir>` again after any edit.

When a `.summon` file contains command values with shell metacharacters (`;`, `|`, `&`, `` ` ``, `$(`, `${`, `<`, `>`), summon displays the commands and prompts for confirmation before executing. The prompt offers three choices: `y` (run all), `n` (abort), or `s` (skip that pane). In non-interactive environments (piped input, CI), execution is refused outright. This check is skipped for `--dry-run` since no commands are executed.

**`on-start` note:** The `on-start` hook executes its value via a shell (`execSync`) rather than `execFileSync`. This is intentional -- `on-start` supports complex shell commands like `docker compose up -d && npm install` that require shell interpretation. The `editor`, `sidebar`, and `shell` commands are validated against `SAFE_COMMAND_RE` before execution, but `on-start` is not, since it is designed to run arbitrary shell snippets. The `confirmDangerousCommands` safety net still applies: if `on-start` is set in a `.summon` file and contains shell metacharacters, the user is prompted before execution.

**Always review `.summon` files before running summon in untrusted repositories, paying particular attention to `on-start` values which execute as shell commands.**

## Security

To report a vulnerability, please follow the [Security Policy](SECURITY.md). Do not open a public issue.

## License

[MIT](./LICENSE)
