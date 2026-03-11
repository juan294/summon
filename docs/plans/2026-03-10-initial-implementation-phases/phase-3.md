# Phase 3: Launcher Orchestrator

## Scope

Create `launcher.ts` -- the orchestrator that resolves config, generates the script, and executes it.

## Files to Create

### `src/launcher.ts`

Adapted from termplex `src/launcher.ts`. Key changes:

**Removed:**
- `tmux()` helper function
- `splitPane()` helper function
- `buildSession()` function
- `configureTmuxTitle()` function
- `configureMouseMode()` function
- Session existence check (`tmux has-session`)
- Session attach/reattach logic
- `--force` handling (kill existing session)
- Mouse mode configuration

**Added:**
- `ensureGhostty()` -- check Ghostty.app exists (via `osascript -e 'tell application "Ghostty" to get version'` or checking `/Applications/Ghostty.app`)
- `executeScript(script: string)` -- run AppleScript via `execSync('osascript -e ...')`

**Kept (adapted):**
- `CLIOverrides` interface (minus `force` and `mouse`)
- `resolveConfig()` -- same layering logic, reads `.summon` instead of `.termplex`
- `ensureCommand()` -- same logic for checking/installing commands
- `KNOWN_INSTALL_COMMANDS` -- same (claude, lazygit) but remove tmux entry
- `launch()` -- simplified flow:

```pseudo
export async function launch(targetDir, cliOverrides):
  ensureGhostty()
  { opts } = resolveConfig(targetDir, cliOverrides)
  plan = planLayout(opts)

  // Check commands are available
  if plan.editor: await ensureCommand(plan.editor)
  if plan.sidebarCommand: await ensureCommand(plan.sidebarCommand)
  if plan.secondaryEditor: await ensureCommand(secondaryBin)
  if plan.serverCommand: await ensureCommand(serverBin)

  // Generate and execute
  script = generateAppleScript(plan, targetDir)
  executeScript(script)
```

**ResolvedConfig interface** (simplified):
```typescript
export interface ResolvedConfig {
  opts: Partial<LayoutOptions>;
  // no mouse field -- Ghostty handles natively
}
```

### `src/launcher.test.ts`

Adapted from termplex tests. Changes:

**Removed tests:**
- tmux detection
- Session name generation
- buildSession tests
- Session reattach tests
- --force flag tests
- Mouse mode tests
- tmux install via ensureCommand

**Added tests:**
- Ghostty detection (app exists / not exists)
- osascript execution (mock execSync)
- Script generation is called with correct plan and directory

**Kept tests (adapted):**
- Directory existence validation
- Config resolution (global -> project -> CLI layering)
- Preset expansion and warnings
- Command dependency checks (editor, sidebar, secondary, server binaries)
- ensureCommand error paths
- lazygit/claude install handlers
- Input validation (panes, editor-size)

## Success Criteria

### Automated
- [ ] `pnpm typecheck` -- no errors
- [ ] `pnpm lint` -- no errors
- [ ] `pnpm test` -- all launcher tests pass

### Manual
None for this phase.
