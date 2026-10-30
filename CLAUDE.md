# CLAUDE.md -- summon

## One-liner

CLI tool that launches configurable multi-pane terminal workspaces in Ghostty (AppleScript) or Rex (session API), macOS only, with automatic backend detection.

## Stack

TypeScript 6 · Node >= 22.12 · pnpm@10.29.2 · tsup · Vitest 4 · ESLint · zero runtime deps · macOS only

Contributors need Node >=22.12. DevDeps use current stable majors (TS 6, Vitest 4, Vite 8) — ensure your toolchain is up to date before contributing.

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
  config.ts             Config file read/write (~/.config/summon/); re-exports path constants; layered over cache.ts
  cache.ts              Persistent cross-invocation read-through cache (~/.config/summon/cache.json); opt-out via SUMMON_NO_CACHE
  layout.ts             Layout calculation (pure function)
  tree.ts               Tree DSL parser, layout node model, plan builder (pure function)
  script.ts             AppleScript generator (pure function — builds script string)
  launcher.ts           Orchestrator: resolve config, resolve backend (P15 seam), generate script, dispatch to a backend
  backend.ts            BackendId, LaunchContext, resolveBackendForLaunch, resolveBackendForRecord
  backend-detect.ts     Pure backend detection table over an env snapshot plus injected probe results
  launch-identity.ts    Per-launch ids and artifacts: newLaunchId, launchArtifactPaths, bootstrap/trap shell fragments, launch manifests
  self.ts               How this process was started (node binary, resolved script), registered by index.ts so the cleanup trap runs the same Summon
  file-lock.ts          withFileLock: cross-process lock (directory rename, dead-owner recovery) for config and status records
  backends/ghostty.ts   GhosttyBackend adapter: AppleScript launch, executeScript, spinner, rollback
  backends/rex/cli.ts   discoverRex (PATH, REX_BIN_DIR, app bundles), defaultRexServer
  backends/rex/types.ts RexIdentity type and parser, REX_OPS trait table, result types
  backends/rex/errors.ts classifyRexFailure (CLI failure classifier, P14)
  backends/rex/layout.ts buildSessionCreateRequest: LayoutPlan/TreeLayoutPlan -> session.create request, pane order, block labels (pure)
  backends/rex/app.ts   App client listing and choice (P7), selectInApp, waitForAppClient, openRexApp
  backends/rex/launch.ts createWorkspace (manifest first, token wait, adoption), adoptOrphans (P13), showWorkspace, maybeSwitchToExisting (P2)
  backends/rex/status.ts sessionState (four-state table P10), focusRex, inspectRex, titleRex, program status (OSC 7501)
  backends/rex/backend.ts createRexBackend: Backend adapter wiring the pieces above
  launch-guards.ts      Pre-launch safety checks (ensureGhostty, ensureAccessibility, confirmDangerousCommands)
  status-record.ts      Record layer: WorkspaceStatus, readStatusRecord, withOwnedRecord locked writes, launch artifact removal, Ghostty liveness
  status.ts             Status reader: readStatus/readAllStatuses over both backends (active/partial/stopped/unknown), Rex adoption and reconciliation, endRexLaunch; re-exports status-record
  briefing.ts           Morning project briefing (overnight commits, dirty files, recommendations)
  monitor.ts            Interactive TUI dashboard for workspace status (refresh loop, keyboard nav)
  ports.ts              Port detection across projects (env vars, package.json, framework configs)
  snapshot.ts           Context snapshot collect/write/restore (git state, layout, branch)
  setup.ts              Interactive setup wizard, visual layout builder (back-nav, numbered select, accessibility prompt)
  setup-gallery.ts      Template gallery data extracted from setup.ts (LAYOUT_INFO, GRID_TEMPLATES)
  starship.ts           Starship detection, preset listing, TOML config caching
  keybindings.ts        Ghostty key table config generator (pure function)
  completions.ts        Shell completion script generator (bash, zsh, fish)
  sessions.ts           Named session save/restore — persist and replay workspace configs (SESSIONS_DIR)
  paths.ts              Canonical path constants (CONFIG_DIR, STATUS_DIR, SNAPSHOTS_DIR, LAYOUTS_DIR, SESSIONS_DIR, TRUST_FILE)
  shell-escape.ts       AppleScript/shell escape primitives (escapeAppleScript, shellQuote, shellDoubleQuote)
  command-spec.ts       Command string analysis (analyzeCommand, commandHasShellMeta, commandExecutable)
  errors.ts             Named error classes (TabOpenError — recoverable new-tab failure for session --all)
  edit-distance.ts      editDistance: optimal string alignment distance shared by the layout builder and the "Did you mean" hint (pure)
  trust.ts              .summon file trust management — SHA-256 allowlist (assertTrusted, trustProject, isTrusted)
  utils.ts              Shared utilities (SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand, promptUser, getErrorMessage, isDebug, debugLog, gitSafeEnv, confirm, supportsColor)
  validation.ts         Input validation helpers (parseIntInRange, parsePositiveFloat, validateProjectNameOrExit)
  globals.d.ts          Build-time constants (__VERSION__)
  cli/
    parse.ts            CLI argument parsing extracted from index.ts (parseCli, buildOverrides)
    help.ts             Help text, lazily imported on --help path (showHelp, hasSubcommandHelp, showSubcommandHelp)
    resolve-target.ts   Resolves launch target directory from name/path/. (resolveTargetDirectory, expandHome); projectSuggestions "Did you mean" lookup
    suggest.ts          suggestProjects: prefix, subsequence and edit-distance suggestions ranked by launch recency (pure)
  commands/
    clean.ts            handleCleanCommand — close an empty Rex session (P17) or review earlier launches (--orphans)
    config.ts           handleConfigCommand, handleExportCommand, handleFreezeCommand, handleSetCommand
    doctor.ts           handleDoctorCommand
    layout.ts           handleLayoutCommand
    layout-support.ts   validateLayoutOrExit, validateLayoutNameOrExit, layoutNotFoundOrExit (shared helpers)
    project.ts          handleAddCommand, handleListCommand, handleOpenCommand, handleRemoveCommand
    runtime.ts          handleStatusCommand, handleSnapshotCommand, handleBriefingCommand, handlePortsCommand
    session.ts          handleSessionCommand — named session save/restore subcommand handler
    setup.ts            handleCompletionsCommand, handleKeybindingsCommand, handleSetupCommand
    trust.ts            handleTrustCommand — .summon file trust subcommand handler
    workspace.ts        handleFocusCommand, handleInspectCommand, handleTitleCommand — per-backend workspace commands
    types.ts            CommandHandler and CommandContext interfaces
  ui/
    ansi.ts             ANSI color/style helpers extracted from setup.ts (bold, dim, green, yellow, cyan, etc.)
    output.ts           Single user-facing output writer (out, err, fail — unified "summon: error:" prefix)
    width.ts            Display-width primitives for CJK/emoji-safe truncation (isWideCodePoint, getDisplayWidth, truncate)
    layout-preview.ts   Layout preview renderer for the setup wizard
    symbols.ts          Canonical glyph vocabulary (sym.ok, sym.warn, sym.fail, sym.info, sym.bullet)
  e2e/
    rex-harness.ts      Rex E2E gate (SUMMON_REX_E2E advisory, SUMMON_REX_E2E_REQUIRED), prerequisites, polling helpers (coverage-excluded)
    rex-native.test.ts  Rex launch/adopt/switch E2E against a real server (run the two Rex E2E files one at a time)
    rex-lifecycle.test.ts Observed Rex lifecycle table (which actions fire the cleanup trap)
    rex-cli.test.ts     Rex CLI E2E: the built CLI as a child process under a sandbox home (docs/release/rex-e2e-guide.md)
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

### Two backends, detected automatically

Summon drives two terminals through one `Backend` seam resolved in `launcher.ts` right after config resolution (`backend.ts`, pure table in `backend-detect.ts`). The terminal running Summon decides: `TERM_PROGRAM=rex` means Rex, `TERM_PROGRAM=ghostty` means Ghostty, another terminal or none means Ghostty when installed, else Rex when its CLI is found; an inherited `REX_SERVER` counts only when `rex whoami` answers on it. There is no config key and no flag for the backend (plan decision D2, owner preference for autodetection).

- **Ghostty** (`backends/ghostty.ts`): generates AppleScript that drives Ghostty's native split system and executes it via `osascript`. No terminal multiplexer, just native Ghostty panes.
- **Rex** (`backends/rex/`): sends one `session.create` request through the `rex` CLI (one session per workspace, one block per pane), shows it in a connected Rex app, and reads it back through `session.view`. Every launch has an id and a manifest so a lost answer can be adopted later. See `docs/rex.md` for the user-facing contract.

### Key Design Decisions

- **AppleScript is generated as a string** by a pure function (`script.ts`). This makes it testable without actually running osascript. The Rex request is built the same way (`backends/rex/layout.ts`).
- **Layout planning is separated from script generation.** `layout.ts`/`tree.ts` compute the abstract plan; `script.ts` turns it into AppleScript and `backends/rex/layout.ts` into a Rex request.
- **Status records are owned per launch.** `status-record.ts` writes the shared record only under a file lock with an ownership expectation; Rex liveness is resolved from the server on read (`status.ts`), never from stale markers.
- **Config system is identical to termplex.** Same key=value files, same layering (CLI > project > global > preset > defaults), same project registry.
- **macOS only.** The `os` field in package.json enforces this. No cross-platform abstraction.

## RPI Workflow

This project follows Research-Plan-Implement (RPI).

1. /rpi-research -- Understand the codebase as-is
2. /rpi-plan -- Create a phased implementation spec
3. /rpi-implement -- Execute one phase at a time with review gates
4. /rpi-validate -- Verify implementation against the plan

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
3. Release to production via a **merge-commit** PR: `develop` -> `main`. Never
   squash a release PR. A squash drops the shared ancestry and makes later
   release PRs use a stale merge base. Feature PRs into `develop` may still
   squash.
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

**`docs/release/release-checklist.md` is the single procedural authority for
releases.** Follow it; do not reconstruct the steps from memory or from this
summary.

- `develop` deploys nowhere -- it's the integration branch
- `main` is production: merging a PR to `main` is a release signal
- The release candidate is the **post-merge `main` SHA**, and the annotated tag
  is created only after `pnpm analyze:release` exits 0
- npm publish is **automatic** on GitHub Release `published`, via
  `.github/workflows/release.yml`, which carries OIDC provenance. Do not run
  `npm publish` by hand -- the manual path in `docs/publishing.md` is an
  emergency fallback that loses provenance.

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

- **PE-S1**: `setup.ts` compiles to ~20KB chunk. Further code splitting (lazy imports for gallery/builder) could reduce cold-start cost. Tracked in #329.
- **PE-S2**: Implemented in #516/#330. A persistent cross-invocation cache at `~/.config/summon/cache.json` keyed on absolute path + mtimeMs + size accelerates machine config and project registry reads across CLI invocations. Opt-out: `SUMMON_NO_CACHE=1`.

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
<!-- rpi:claude-import:start -->
@AGENTS.md
<!-- rpi:claude-import:end -->
