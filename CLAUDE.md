# CLAUDE.md -- summon

## One-liner

CLI tool that launches configurable multi-pane Ghostty workspaces using AppleScript (macOS).

## Stack

TypeScript 6 · Node >= 20.19 · pnpm@10.29.2 · tsup · Vitest 4 · ESLint · zero runtime deps · macOS only

Contributors need Node >=20.19. DevDeps use current stable majors (TS 6, Vitest 4, Vite 8) — ensure your toolchain is up to date before contributing.

## Build & Run

```bash
pnpm install          # install dependencies
pnpm build            # compile to dist/index.js (with shebang)
pnpm dev              # watch mode
pnpm typecheck        # type-check without emitting
pnpm lint             # check linting
pnpm test             # run tests once
pnpm test:watch       # run tests in watch mode
pnpm test:coverage    # run tests with v8 coverage
```

## Project Structure

```
src/
  index.ts              CLI entry point — dispatch registry (thin, ~134 lines)
  config.ts             Config file read/write (~/.config/summon/); re-exports path constants
  layout.ts             Layout calculation (pure function)
  tree.ts               Tree DSL parser, layout node model, plan builder (pure function)
  script.ts             AppleScript generator (pure function — builds script string)
  launcher.ts           Orchestrator: resolve config, generate script, execute via osascript
  launch-guards.ts      Pre-launch safety checks (ensureGhostty, ensureAccessibility, confirmDangerousCommands)
  status.ts             Workspace status tracking (active/stopped, PID, uptime, marker files)
  briefing.ts           Morning project briefing (overnight commits, dirty files, recommendations)
  monitor.ts            Interactive TUI dashboard for workspace status (refresh loop, keyboard nav)
  ports.ts              Port detection across projects (env vars, package.json, framework configs)
  snapshot.ts           Context snapshot save/restore (git state, layout, branch)
  setup.ts              Interactive setup wizard, visual layout builder (back-nav, numbered select, accessibility prompt)
  setup-gallery.ts      Template gallery data extracted from setup.ts (LAYOUT_INFO, GRID_TEMPLATES)
  starship.ts           Starship detection, preset listing, TOML config caching
  keybindings.ts        Ghostty key table config generator (pure function)
  completions.ts        Shell completion script generator (bash, zsh, fish)
  sessions.ts           Named session save/restore — persist and replay workspace configs (SESSIONS_DIR)
  paths.ts              Canonical path constants (CONFIG_DIR, STATUS_DIR, SNAPSHOTS_DIR, LAYOUTS_DIR, SESSIONS_DIR, TRUST_FILE)
  shell-escape.ts       AppleScript/shell escape primitives (escapeAppleScript, shellQuote, shellDoubleQuote)
  command-spec.ts       Command string analysis (analyzeCommand, commandHasShellMeta, commandExecutable)
  trust.ts              .summon file trust management — SHA-256 allowlist (assertTrusted, trustProject, isTrusted)
  utils.ts              Shared utilities (SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand, promptUser, getErrorMessage, isDebug, debugLog, gitSafeEnv, confirm, supportsColor)
  validation.ts         Input validation helpers (parseIntInRange, parsePositiveFloat, validateProjectNameOrExit)
  globals.d.ts          Build-time constants (__VERSION__)
  cli/
    parse.ts            CLI argument parsing extracted from index.ts (parseCli, buildOverrides, showHelp)
    resolve-target.ts   Resolves launch target directory from name/path/. (resolveTargetDirectory, expandHome)
  commands/
    config.ts           handleConfigCommand, handleExportCommand, handleFreezeCommand, handleSetCommand
    doctor.ts           handleDoctorCommand
    layout.ts           handleLayoutCommand
    layout-support.ts   validateLayoutOrExit, validateLayoutNameOrExit, layoutNotFoundOrExit (shared helpers)
    project.ts          handleAddCommand, handleListCommand, handleOpenCommand, handleRemoveCommand
    runtime.ts          handleStatusCommand, handleSnapshotCommand, handleBriefingCommand, handlePortsCommand
    session.ts          handleSessionCommand — named session save/restore subcommand handler
    setup.ts            handleCompletionsCommand, handleKeybindingsCommand, handleSetupCommand
    trust.ts            handleTrustCommand — .summon file trust subcommand handler
    types.ts            CommandHandler and CommandContext interfaces
  ui/
    ansi.ts             ANSI color/style helpers extracted from setup.ts (bold, dim, green, yellow, cyan, etc.)
    layout-preview.ts   Layout preview renderer for the setup wizard
    symbols.ts          Canonical glyph vocabulary (sym.ok, sym.warn, sym.fail, sym.info, sym.bullet)
  *.test.ts             Co-located unit tests
```

## Code Style

- **Zero runtime dependencies** -- stdlib only (`node:util`, `node:fs`, etc.) — enforced: `node -e "if (Object.keys(require('./package.json').dependencies||{}).length) process.exit(1)"` in CI.
- TypeScript strict mode with `noUncheckedIndexedAccess`
- ESM throughout (`"type": "module"`)
- Functional style -- prefer pure functions, minimize side effects
- Co-located tests (`foo.test.ts` next to `foo.ts`)
- ESM CLI files use shebang -- never run with `node`, use `chmod +x && ./cli` or `npx .`

## Architecture

### Backend: AppleScript via osascript

Summon generates AppleScript that drives Ghostty's native split system. The script is executed via `osascript -e "<script>"`. This replaces tmux entirely -- no terminal multiplexer, just native Ghostty panes.

### Key Design Decisions

- **AppleScript is generated as a string** by a pure function (`script.ts`). This makes it testable without actually running osascript.
- **Layout planning is separated from script generation.** `layout.ts` computes the abstract plan, `script.ts` turns it into AppleScript.
- **Config system is identical to termplex.** Same key=value files, same layering (CLI > project > global > preset > defaults), same project registry.
- **macOS only.** The `os` field in package.json enforces this. No cross-platform abstraction.

## RPI Workflow

This project follows Research-Plan-Implement (RPI).

1. /research -- Understand the codebase as-is
2. /plan -- Create a phased implementation spec
3. /implement -- Execute one phase at a time with review gates
4. /validate -- Verify implementation against the plan

Each phase is its own conversation. STOP after each phase.
Use /clear between tasks, /compact when context is heavy.

## Key Commands

```bash
pnpm run typecheck      # Check types
pnpm run lint           # Check linting
pnpm run test           # Run all tests
pnpm run build          # Production build
pnpm run dev            # Watch mode
```

## Git Workflow

**`develop` is the default branch. `main` is production only.**

1. All development happens on `develop`
2. Never commit directly to `main`
3. Release to production via PR: `develop` -> `main`
4. Always run checks before committing (pre-commit hooks enforce this)
5. Always commit before pulling -- `git pull --rebase` requires a clean tree (hook enforced)
6. **Before any commit, verify the current branch** -- run `git branch --show-current` and confirm it matches your intent. If the user hasn't specified a branch, ask. (hook blocks push to main/master)
7. After config, dependency, or infrastructure changes, **immediately run the full test suite** before proceeding to the next task

Run verification sequentially with `;` or `&&`, never as parallel Bash calls.

### Commit Messages

Use conventional commits:
```
feat(scope): description (#issue)
fix(scope): description (#issue)
test(scope): description
refactor(scope): description
chore: description
docs: description
ci: description
```

Keep commits focused -- one logical change per commit.
All commits must pass `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.

## Deployment

- `develop` deploys nowhere -- it's the integration branch
- `main` is production: merging a PR to `main` is a release signal
- npm publish is manual: `pnpm build && npm publish` (see docs/publishing.md)
- Releases are tagged from `main`: `git tag v<version> && git push origin v<version>`

## Agent Behavior

Exhaust tools before asking the user. Production actions need human authorization.
Save operational lessons to auto memory immediately. Don't wait to be asked.

## Project File Locations

Go directly to these paths — never search the codebase for them.

| Topic | Path | Notes |
|-------|------|-------|
| Agent reports | `docs/agents/*-report.md` | Gitignored on public repos; tracked on private (Rule #70) |
| Agent logs | `logs/<name>.log`, `<name>.error.log` | Gitignored. Read alongside reports to diagnose failures |
| Agent scripts | `scripts/agents/` | Gitignored. Standalone bash files invoking Claude CLI headless |
| ADRs | `docs/decisions/` | Architecture decision records |
| PR descriptions | `docs/prs/{number}_description.md` | |
| Research docs | `docs/research/YYYY-MM-DD-description.md` | |
| Plans | `docs/plans/YYYY-MM-DD-description.md` | Phase files in `-phases/phase-N.md` |

## Security Invariants

**DO NOT REMOVE `src/shell-escape.lint.test.ts`** — This is a load-bearing CI gate.
It statically scans all source files and fails if any raw template literal interpolates
a user value into an AppleScript or shell context. Removing this test removes the
primary injection defense. See src/shell-escape.ts for the escape functions it protects.

## Known Architectural Debt

- **AR-L1**: Two parallel layout pipelines in `launcher.ts` and `script.ts` duplicate options mapping (`launchTreeLayout`/`launchTraditionalLayout` and `generateTreeAppleScript`/`generateAppleScript`). Any new layout option must be threaded through both pipelines independently. Tracked in #318.
- **PE-S1**: `setup.ts` compiles to ~20KB chunk. Further code splitting (lazy imports for gallery/builder) could reduce cold-start cost. Tracked in #329.
- **PE-S2**: Config reads are now mtime-memoized within a single invocation (implemented in WU-E). A persistent cross-invocation cache (e.g., `~/.config/summon/cache.json` surviving between CLI runs) would further reduce cold-start disk I/O. Tracked in #330.

## Schema Migrations

JSON files written by summon (`status/*.json`, `snapshot/*.json`) include a `version` field (currently `1`).

**Policy:**
- Backward compatibility is required for at least one major version after a schema bump.
- When bumping the schema version, increment the `version` field and add a migration path in the reading code that upgrades old records to the new shape.
- New optional fields with sensible defaults do not require a version bump.
- Removals or semantic changes to existing fields always require a bump.
- Document each bump in `docs/decisions/` as an ADR.

See `docs/decisions/schema-migration-strategy.md` for the full policy.

## Known TODOs

- **UX-L4**: Add "All projects clean" positive confirmation to briefing output when no issues are found (briefing.ts).
