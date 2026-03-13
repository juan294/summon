# summon — Native Ghostty workspace launcher

![Chapa Badge](https://chapa.thecreativetoken.com/u/juan294/badge.svg)
[![CI](https://github.com/juan294/summon/actions/workflows/ci.yml/badge.svg)](https://github.com/juan294/summon/actions/workflows/ci.yml)
[![CodeQL](https://github.com/juan294/summon/actions/workflows/codeql.yml/badge.svg)](https://github.com/juan294/summon/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/summon-ws)](https://www.npmjs.com/package/summon-ws)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)
[![license](https://img.shields.io/npm/l/summon-ws)](./LICENSE)

Summon your Ghostty workspace with one command. Native splits, no tmux.

---

## Install

```bash
npm i -g summon-ws
```

Requires Node >= 18, macOS, and [Ghostty](https://ghostty.org) 1.3.0+.

## Quick Start

```bash
summon .                          # launch workspace in current directory
summon add myapp ~/code/myapp     # register a project
summon myapp                      # launch by project name
```

## How It Works

Summon generates and executes AppleScript that drives Ghostty's native split system. No terminal multiplexer -- just native Ghostty panes with commands running in each one.

## Default Layout

```
summon .    (panes=2, editor=claude, sidebar=lazygit, server=true)

+-------------------- 75% ---------------------+------ 25% ------+
|                    |                          |                 |
|                    |    claude (2)            |                 |
|    claude (1)      |                          |    lazygit      |
|                    +--------------------------+                 |
|                    |                          |                 |
|                    |    server (shell)        |                 |
|                    |                          |                 |
+--------------------+--------------------------+-----------------+
      left col             right col                sidebar
```

## Layout Presets

| Preset | Panes | Server | Use case |
|---|---|---|---|
| `full` | 3 | yes | Multi-agent coding + dev server |
| `pair` | 2 | yes | Two editors + dev server |
| `minimal` | 1 | no | Simple editor + sidebar only |
| `cli` | 1 | yes | CLI tool development -- editor + server |
| `mtop` | 2 | yes | System monitoring -- editor + mtop + server |

```bash
summon . --layout minimal         # 1 editor pane, no server
summon . -l pair                  # 2 editors + server
```

## Per-project Config

Drop a `.summon` file in your project root to override machine-level config:

```ini
# .summon
layout=minimal
editor=vim
server=npm run dev
```

Config resolution order: **CLI flags > .summon > machine config > preset > defaults**

## Commands

| Command | Description |
|---|---|
| `summon <target>` | Launch workspace (project name, path, or `.`) |
| `summon add <name> <path>` | Register a project name to a directory |
| `summon remove <name>` | Remove a registered project |
| `summon list` | List all registered projects |
| `summon set <key> [value]` | Set a machine-level config value |
| `summon config` | Show current machine configuration |

## CLI Flags

| Flag | Description |
|---|---|
| `-l, --layout <preset>` | Use a layout preset (`minimal`, `full`, `pair`, `cli`, `mtop`) |
| `--editor <cmd>` | Override editor command |
| `--panes <n>` | Override number of editor panes |
| `--editor-size <n>` | Override editor width percentage |
| `--sidebar <cmd>` | Override sidebar command |
| `--server <value>` | Server pane: `true`, `false`, or a command |
| `--auto-resize` | **Experimental:** resize sidebar to match editor-size |
| `-n, --dry-run` | Print generated AppleScript without executing |
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

## Config Keys

| Key | Default | Description |
|---|---|---|
| `editor` | `claude` | Command launched in editor panes |
| `sidebar` | `lazygit` | Command launched in the sidebar pane |
| `panes` | `2` | Number of editor panes |
| `editor-size` | `75` | Width percentage for the editor grid |
| `server` | `true` | Server pane: `true` (shell), `false` (none), or a command |
| `layout` | | Default layout preset |
| `auto-resize` | `false` | **Experimental:** auto-resize sidebar to match editor-size |

Machine config is stored at `~/.config/summon/config`:

```bash
summon set editor vim               # use vim as the editor
summon set server "npm run dev"     # run dev server automatically
summon set layout minimal           # default to minimal preset
```

## Docs

- [Architecture](docs/architecture.md) -- module map, AppleScript generation, layout algorithm
- [User Manual](docs/user-manual.md) -- full command reference, walkthrough, troubleshooting
- [Changelog](CHANGELOG.md) -- release history
- [Publishing](docs/publishing.md) -- npm publish checklist

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for details on the development workflow, commit conventions, and PR guidelines.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Trust Model

`.summon` files configure commands that summon executes in each pane (`editor`, `sidebar`, `server`). Running `summon .` in a directory will execute whatever commands its `.summon` file specifies -- this is the same trust model as `Makefile`, direnv `.envrc`, or VS Code `.vscode/tasks.json`.

**Always review `.summon` files before running summon in untrusted repositories.**

## Security

To report a vulnerability, please follow the [Security Policy](SECURITY.md). Do not open a public issue.

## License

[MIT](./LICENSE)
