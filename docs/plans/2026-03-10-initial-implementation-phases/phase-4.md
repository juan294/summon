# Phase 4: CLI Entry Point

## Scope

Create `index.ts` -- the CLI entry point. Build and verify the full pipeline.

## Files to Create

### `src/index.ts`

Adapted from termplex `src/index.ts`. Changes:

**Help text:** Updated for summon:
```
summon -- Summon your Ghostty workspace

Usage:
  summon <target>             Launch workspace (project name, path, or '.')
  summon add <name> <path>    Register a project name -> path mapping
  summon remove <name>        Remove a registered project
  summon list                 List all registered projects
  summon set <key> [value]    Set a machine-level config value
  summon config               Show current machine configuration

Options:
  -h, --help                  Show this help message
  -v, --version               Show version number
  -l, --layout <preset>       Use a layout preset (minimal, full, pair, cli, mtop)
  --editor <cmd>              Override editor command
  --panes <n>                 Override number of editor panes
  --editor-size <n>           Override editor width %
  --sidebar <cmd>             Override sidebar command
  --server <value>            Server pane: true, false, or a command

Config keys:
  editor        Command for coding panes (default: claude)
  sidebar       Command for sidebar pane (default: lazygit)
  panes         Number of editor panes (default: 3)
  editor-size   Width % for editor grid (default: 75)
  server        Server pane toggle (default: true)
  layout        Default layout preset

Layout presets:
  minimal       1 editor pane, no server
  full          3 editor panes + server (default)
  pair          2 editor panes + server
  cli           1 editor pane + server (npm login)
  mtop          editor + mtop + server + lazygit sidebar

Per-project config:
  Place a .summon file in your project root with key=value pairs.
  Project config overrides machine config; CLI flags override both.

Requires: macOS, Ghostty 1.3.0+

Examples:
  summon .                        Launch workspace in current directory
  summon myapp                    Launch workspace for registered project
  summon add myapp ~/code/app     Register a project
  summon set editor claude        Set the editor command
  summon . --layout minimal       Launch with minimal preset
  summon . --server "npm run dev" Launch with custom server command
```

**Removed flags:**
- `--force` / `-f` (no sessions)
- `--mouse` / `--no-mouse` (Ghostty handles natively)
- `allowNegative` option in parseArgs (was for --no-mouse)

**Removed from CLIOverrides building:**
- `force`
- `mouse`

**Changed references:**
- Error messages: `termplex` -> `summon`
- Config command: `termplex set` -> `summon set`
- Binary names in help: `termplex`/`ws` -> `summon`

**Subcommand handling:** Same structure (add, remove, list, set, config, default=launch).

**No `completion` subcommand** -- deferred to post-initial-release.

## Build Verification

After creating `index.ts`, verify the full build pipeline:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
chmod +x dist/index.js
./dist/index.js --help
./dist/index.js --version
```

## Success Criteria

### Automated
- [x] `pnpm typecheck` -- no errors
- [x] `pnpm lint` -- no errors
- [x] `pnpm test` -- ALL tests pass (config + layout + script + launcher)
- [x] `pnpm build` -- succeeds, produces `dist/index.js` with shebang
- [x] `./dist/index.js --help` -- outputs correct help text
- [x] `./dist/index.js --version` -- outputs `0.1.0`

### Manual
None for this phase.
