# Architecture

Technical reference for contributors.

## Module Map

| Module | Role | Side Effects | Dependencies |
|--------|------|:------------:|--------------|
| `index.ts` | CLI entry point — parseArgs, subcommand dispatch, first-run detection | yes | config, launcher, setup (dynamic) |
| `launcher.ts` | Orchestrator — config resolution, command checks, script execution via osascript | yes | config, layout, script, utils |
| `config.ts` | Config file read/write (`~/.config/summon/` and `.summon`), first-run detection | yes | Node stdlib only |
| `setup.ts` | Interactive setup wizard — TUI primitives, tool catalogs, numbered-selection flow | yes | config, utils |
| `utils.ts` | Shared utilities — `SAFE_COMMAND_RE`, `GHOSTTY_PATHS`, `resolveCommand` | yes | Node stdlib only |
| `layout.ts` | Layout calculation and presets | **pure** | none |
| `script.ts` | AppleScript generator — builds script string from LayoutPlan | **pure** | none |
| `validation.ts` | Input validation helpers (`parseIntInRange`) | **pure** | none |
| `globals.d.ts` | Build-time constant declarations (`__VERSION__`) | — | — |
| `*.test.ts` | Co-located unit tests (Vitest) | — | — |

### Dependency Graph

```mermaid
graph TD
    index[index.ts] --> config[config.ts]
    index --> launcher[launcher.ts]
    index -.->|dynamic import| setup[setup.ts]
    launcher --> config
    launcher --> layout[layout.ts]
    launcher --> script[script.ts]
    launcher --> utils[utils.ts]
    setup --> config
    setup --> utils

    config -.- cfg_fns["addProject, removeProject,
    getProject, listProjects,
    setConfig, listConfig,
    isFirstRun, readKVFile"]
    layout -.- lay_fns["planLayout, isPresetName,
    getPreset, LayoutOptions,
    LayoutPlan"]
    script -.- scr_fns["generateAppleScript"]
    utils -.- util_fns["SAFE_COMMAND_RE,
    GHOSTTY_PATHS,
    resolveCommand"]
    setup -.- setup_fns["runSetup, detectTools,
    validateSetup, EDITOR_CATALOG,
    SIDEBAR_CATALOG"]

    style cfg_fns fill:none,stroke-dasharray:5
    style lay_fns fill:none,stroke-dasharray:5
    style scr_fns fill:none,stroke-dasharray:5
    style util_fns fill:none,stroke-dasharray:5
    style setup_fns fill:none,stroke-dasharray:5
```

`layout.ts`, `script.ts`, and `validation.ts` are pure modules with no project imports. `config.ts` and `utils.ts` only use Node stdlib. `setup.ts` is loaded via dynamic import from `index.ts` — it's only parsed when the setup wizard is needed (first run or `summon setup`), keeping normal launch times unaffected.

## Data Flow

```mermaid
flowchart TD
    cli["CLI invocation"] --> parse["parseArgs
    flags: --help, --version, --layout,
    --editor, --panes, --editor-size,
    --sidebar, --server, --auto-resize,
    --no-auto-resize, --dry-run"]
    parse --> firstrun{"isFirstRun()
    && stdin.isTTY?"}

    firstrun -->|yes| wizard["setup.ts: runSetup()
    interactive wizard
    (layout, editor, sidebar, server)"]
    wizard --> wizardsave["setConfig() for each choice
    + validateSetup() tool checks"]
    wizardsave --> wizardcont{"subcommand
    provided?"}
    wizardcont -->|no| exit0["exit 0
    (bare summon)"]
    wizardcont -->|yes| dispatch

    firstrun -->|no| dispatch{"subcommand dispatch"}

    dispatch -->|"add / remove / list
    set / config"| configrw["config.ts
    read/write"]
    dispatch -->|"setup"| wizardexplicit["setup.ts: runSetup()
    (explicit invocation)"]
    dispatch -->|"default (launch target)"| resolve["resolve target directory
    (., absolute path, or project name)"]

    resolve --> overrides["build CLIOverrides
    from parsed flags"]
    overrides --> launch["launcher.launch(targetDir, cliOverrides)"]

    launch --> ghostty["ensureGhostty()
    check Ghostty is running"]
    ghostty --> resolvecfg["resolveConfig(targetDir, cliOverrides)"]

    resolvecfg --> readkv["readKVFile(targetDir/.summon)"]
    resolvecfg --> resolvekey["resolve layout key
    CLI > project > global"]
    resolvecfg --> expand["expand preset if layout
    is a valid preset name"]
    resolvecfg --> layer["layer each key:
    CLI > project > global > preset"]

    layer --> plan["planLayout(resolvedOpts)
    compute pane counts and sizes"]
    plan --> ensure["ensureCommand() for editor,
    sidebar, secondaryEditor, serverCommand"]
    ensure --> gen["generateAppleScript(plan, targetDir)
    build script string"]
    gen --> exec["execute via
    execFileSync('osascript', { input: script })"]
```

## Setup Wizard

`setup.ts` implements the interactive first-run onboarding wizard. It is loaded via dynamic `import()` from `index.ts` to avoid adding to the startup cost of normal launches.

### First-Run Detection

`isFirstRun()` in `config.ts` checks whether `~/.config/summon/config` exists. It does NOT call `ensureConfig()` — the check must not create the file as a side effect.

The auto-trigger in `index.ts` fires when:
1. `isFirstRun()` returns `true` (no config file)
2. `process.stdin.isTTY` is truthy (interactive terminal)
3. The subcommand is not a config management command (add, remove, list, set, config, setup)

### Wizard Flow

1. **Welcome banner** — box-drawn border using Unicode characters
2. **Layout selection** — numbered list of 5 presets with ASCII diagrams
3. **Editor selection** — catalog of common editors, detected via `resolveCommand()`, sorted available-first
4. **Sidebar selection** — catalog of common sidebar tools, same detection pattern
5. **Server selection** — plain shell, disabled, or custom command
6. **Summary** — display chosen configuration
7. **Confirmation** — Y/n; declining loops back to step 2
8. **Validation** — check each chosen command with `resolveCommand()`, check Ghostty installation, show install hints for missing tools
9. **Save** — write each key via `setConfig()`

### Tool Catalogs

Editors and sidebar tools are defined as `ToolEntry[]` catalogs in `setup.ts`. Each entry has `cmd` (binary name), `name` (display name), and `desc` (description). The `detectTools()` function runs `resolveCommand()` against each catalog entry and returns `DetectedTool[]` with an `available` boolean.

### Color Support

ANSI colors are controlled by the `useColor` flag, computed at module load:

```typescript
const useColor = !!(process.stdout.isTTY && !process.env.NO_COLOR);
```

All color functions (`bold`, `dim`, `green`, `yellow`, `cyan`) pass through when `useColor` is false, per the [no-color.org](https://no-color.org/) convention.

### Code Splitting

tsup automatically code-splits `setup.ts` into a separate chunk (`setup-*.js`, ~15 KB). This chunk is only loaded when the setup wizard is needed, keeping the main entry point lean for normal workspace launches.

## AppleScript Generation

`script.ts` exports a pure function `generateAppleScript(plan, targetDir)` that returns a string. The generated script:

1. Creates a `surface configuration` with the target working directory
2. Creates a new Ghostty window with that configuration
3. Captures the root terminal (first pane)
4. Splits for sidebar (direction `right`)
5. Splits for right column editors (direction `right` from root)
6. Splits left column vertically for additional editor panes (direction `down`)
7. Splits right column vertically for additional editors + server (direction `down`)
8. Sends commands to each pane via `input text` + `send key "enter"`
9. Focuses the root editor pane

### AppleScript Object Model

```mermaid
graph TD
    app["application 'Ghostty'"] --> windows
    windows --> tabs
    tabs --> terminals["terminals
    (individual panes/splits)"]
```

Key commands used:
- `new surface configuration` -- create config with working directory, command, etc.
- `new window with configuration` -- create window
- `split <terminal> direction <dir> with configuration` -- create split
- `input text "<cmd>" to <terminal>` -- send command text
- `send key "enter" to <terminal>` -- press enter
- `focus <terminal>` -- focus a pane

### No tmux, No Session Persistence

Unlike termplex, summon does not create persistent sessions. Each `summon` invocation creates a new Ghostty window with splits. Closing the window ends everything. There is no detach/reattach. This is a Ghostty limitation -- if they add session persistence in the future, summon can adopt it.

## Config Resolution

`resolveConfig()` in `launcher.ts` merges configuration from multiple sources:

```mermaid
flowchart LR
    cli["CLI flags"] -->|overrides| summon[".summon"] -->|overrides| global["~/.config/summon/config"] -->|overrides| preset["preset expansion"] -->|overrides| defaults["built-in defaults"]

    style cli fill:#4a9,color:#fff
    style defaults fill:#888,color:#fff
```

1. Read project `.summon` file via `readKVFile(join(targetDir, ".summon"))`
2. Resolve the `layout` key (CLI > project > global) and expand the matching preset as a base
3. For each config key (`editor`, `sidebar`, `panes`, `editor-size`, `server`), pick the highest-priority value
4. Return partial `LayoutOptions` -- `planLayout()` fills remaining defaults

## Layout Presets

Defined in `layout.ts` as a `Record<PresetName, Partial<LayoutOptions>>`:

| Preset | `editorPanes` | `server` | `secondaryEditor` |
|---|---|---|---|
| `minimal` | 1 | `"false"` | |
| `full` | 3 | `"true"` | |
| `pair` | 2 | `"true"` | |
| `cli` | 1 | `"npm login"` | |
| `btop` | 2 | `"true"` | `"btop"` |

### Preset Layouts

Each diagram shows the resulting Ghostty window. The sidebar (lazygit) is always on the right at `100 - editorSize`% width.

#### `minimal` — single editor, no server

```
┌─────────────────────────────┬───────────┐
│                             │           │
│                             │           │
│           editor            │  lazygit  │
│                             │           │
│                             │           │
└─────────────────────────────┴───────────┘
            75%                    25%
```

#### `full` — 3 editors + server (default)

```
┌──────────────┬──────────────┬───────────┐
│              │              │           │
│   editor 1   │   editor 3   │           │
│              │              │           │
├──────────────┼──────────────┤  lazygit  │
│              │              │           │
│   editor 2   │    server    │           │
│              │              │           │
└──────────────┴──────────────┴───────────┘
         75% (2 columns)           25%
```

#### `pair` — 2 editors + server

```
┌──────────────┬──────────────┬───────────┐
│              │              │           │
│              │   editor 2   │           │
│              │              │           │
│   editor 1   ├──────────────┤  lazygit  │
│              │              │           │
│              │    server    │           │
│              │              │           │
└──────────────┴──────────────┴───────────┘
         75% (2 columns)           25%
```

#### `cli` — single editor + custom server command

```
┌──────────────┬──────────────┬───────────┐
│              │              │           │
│              │              │           │
│    editor    │  npm login   │  lazygit  │
│              │              │           │
│              │              │           │
└──────────────┴──────────────┴───────────┘
         75% (2 columns)           25%
```

#### `btop` — editor + btop + server

```
┌──────────────┬──────────────┬───────────┐
│              │              │           │
│              │     btop     │           │
│              │              │           │
│    editor    ├──────────────┤  lazygit  │
│              │              │           │
│              │    server    │           │
│              │              │           │
└──────────────┴──────────────┴───────────┘
         75% (2 columns)           25%
```

## Layout Algorithm

Given `N` editor panes (default 3) and server toggle:

1. **Left column**: `ceil(N/2)` editor panes
2. **Right column**: `N - ceil(N/2)` editor panes + (1 server pane if `hasServer`)
3. **Sidebar**: separate column at `100 - editorSize`% width

### Server Pane

| Input | `hasServer` | `serverCommand` |
|---|---|---|
| `"true"` | `true` | `null` (plain shell) |
| `"false"` or `""` | `false` | `null` |
| anything else | `true` | the input string |

### Secondary Editor

`secondaryEditor` allows a preset to specify a different command for right-column editor panes. Used by the `btop` preset to run `btop` in the right column while the left column runs the primary editor.

### Split Percentage Formula

When splitting `N` panes into a column, each split uses:

```
pct(i) = floor((N - i) / (N - i + 1) * 100)
```

where `i` is the 1-based index of the split. This produces equal-height panes.

## Config Storage

### Machine-level

Config files live at `~/.config/summon/`:

| File | Purpose |
|---|---|
| `config` | Machine-level settings (editor, sidebar, panes, editor-size, server, layout) |
| `projects` | Project name-to-path mappings |

Both use `key=value` format, one entry per line.

### Per-project

A `.summon` file in the project root uses the same `key=value` format.

## Build Pipeline

1. **tsup** compiles `src/index.ts` to `dist/index.js` (ESM, target node18)
2. **Shebang injection**: `#!/usr/bin/env node` banner prepended
3. **Version injection**: `__VERSION__` replaced with `package.json` version at build time
4. **prepublishOnly**: runs `pnpm run build` before any `npm publish`

The `files` field in package.json limits the published package to `dist/` only.
