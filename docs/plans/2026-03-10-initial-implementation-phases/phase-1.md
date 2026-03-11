# Phase 1: Core Infrastructure

## Scope

Port `config.ts` and `layout.ts` from termplex, along with their tests.

## Files to Create

### `src/config.ts`

Adapted from termplex `src/config.ts`. Changes:
- `CONFIG_DIR` = `~/.config/summon/` (was `~/.config/termplex/`)
- Default config seed: `editor=claude\n` (same as termplex)

```pseudo
const CONFIG_DIR = join(homedir(), ".config", "summon")
const PROJECTS_FILE = join(CONFIG_DIR, "projects")
const CONFIG_FILE = join(CONFIG_DIR, "config")
```

All functions identical: `readKVFile`, `addProject`, `removeProject`, `getProject`, `listProjects`, `setConfig`, `getConfig`, `listConfig`.

### `src/config.test.ts`

Port from termplex `src/config.test.ts`. Same test structure:
- Project CRUD tests
- Machine config tests
- readKVFile edge cases
- Value preservation (values containing `=`)

### `src/layout.ts`

**Identical** to termplex `src/layout.ts`. No changes needed. Same:
- `LayoutOptions` interface
- `DEFAULT_OPTIONS` (editor: "claude", editorPanes: 3, editorSize: 75, sidebarCommand: "lazygit", server: "true")
- `LayoutPlan` interface
- `parseServer()` function
- `PresetName` type and `PRESETS` record
- `isPresetName()`, `getPreset()`, `planLayout()`

### `src/layout.test.ts`

Port from termplex `src/layout.test.ts`. Same test structure:
- Default plan tests
- Pane distribution (1-6 panes)
- Server pane toggle
- All 5 presets
- Preset recognition
- Preset overrides

### `src/globals.d.ts`

```typescript
declare const __VERSION__: string;
```

## Success Criteria

### Automated
- [ ] `pnpm typecheck` -- no errors
- [ ] `pnpm lint` -- no errors
- [ ] `pnpm test` -- all config + layout tests pass

### Manual
None for this phase.
