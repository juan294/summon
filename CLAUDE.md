# CLAUDE.md -- summon

## One-liner

CLI tool that launches configurable multi-pane Ghostty workspaces using AppleScript (macOS).

## Stack

TypeScript 5.7 · Node >= 18 · pnpm · tsup · Vitest · ESLint · zero runtime deps · macOS only

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
  index.ts         CLI entry point (parseArgs-based)
  config.ts        Config file read/write (~/.config/summon/)
  layout.ts        Layout calculation (pure function)
  tree.ts          Tree DSL parser, layout node model, plan builder (pure function)
  script.ts        AppleScript generator (pure function — builds script string)
  launcher.ts      Orchestrator: resolve config, generate script, execute via osascript
  status.ts        Workspace status tracking (active/stopped, PID, uptime, marker files)
  briefing.ts      Morning project briefing (overnight commits, dirty files, recommendations)
  monitor.ts       Interactive TUI dashboard for workspace status (refresh loop, keyboard nav)
  ports.ts         Port detection across projects (env vars, package.json, framework configs)
  snapshot.ts      Context snapshot save/restore (git state, layout, branch)
  setup.ts         Interactive setup wizard, visual layout builder (template gallery, grid builder, live preview)
  starship.ts      Starship detection, preset listing, TOML config caching
  keybindings.ts   Ghostty key table config generator (pure function)
  completions.ts   Shell completion script generator (bash, zsh)
  utils.ts         Shared utilities (SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand, promptUser, getErrorMessage, isGhosttyInstalled, checkAccessibility)
  validation.ts    Input validation helpers (parseIntInRange, parsePositiveFloat, validateIntFlag, validateFloatFlag)
  globals.d.ts     Build-time constants (__VERSION__)
  *.test.ts        Co-located unit tests
```

## Code Style

- **Zero runtime dependencies** -- stdlib only (`node:util`, `node:fs`, etc.)
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

This project follows the Research-Plan-Implement (RPI) pattern.
All significant changes go through four phases:
1. /research -- Understand the codebase as-is
2. /plan -- Create a phased implementation spec
3. /implement -- Execute one phase at a time with review gates
4. /validate -- Verify implementation against the plan

### Context Management

- Each RPI phase should be its own conversation. Don't run research + plan + implement in one session.
- Use `/clear` between unrelated tasks. Use `/compact` when context is heavy but the task continues.
- Subagents are context control mechanisms -- they search/read in their window and return only distilled results.
- Research and planning happen on `develop`. Implementation happens in worktrees or feature branches.
- If research comes back wrong, throw it out and restart with more specific steering.

### Rules for All Phases

- Read all mentioned files COMPLETELY before doing anything else.
- Never suggest improvements during research -- only document what exists.
- Every code reference must include file:line.
- Spawn parallel subagents for independent research tasks.
- Wait for ALL subagents before synthesizing.
- Never write documents with placeholder values.

### Rules for Implementation

- Follow the atomic loop: implement → review (plan compliance) → fix → approve → `/simplify` (code quality) → verify.
- Run `/simplify` after reviewer approval -- it handles code reuse, quality, and efficiency in one native pass.
- Check for `[batch-eligible]` phases in the plan -- use `/batch` to execute independent phases in parallel.
- Run ALL automated verification after each phase.
- STOP after each phase and wait for human confirmation.
- Never auto-proceed to the next phase.
- If the plan doesn't match reality, STOP and explain the mismatch.

### Pre-Release Workflow

```
/pre-launch -> /remediate -> /update-docs -> /release
```

- `/remediate` -- resolve all pre-launch findings with parallel TDD agents, CI verification
- `/update-docs` -- refreshes all documentation, diagrams, version references, and inline code docs
- `/release` -- version bump, CHANGELOG, tag, GitHub release, registry publish advisory

### Testing Philosophy

- Prefer automated verification over manual testing.
- Manual testing is ONLY for: AppleScript execution against real Ghostty, visual layout verification, sudo, hardware, new installs.
- If you can verify it with a command or tool, do so automatically.
- Don't use Claude for linting/formatting -- use automated tools and hooks instead.

## Key Commands

```bash
pnpm run typecheck      # Check types
pnpm run lint           # Check linting
pnpm run test           # Run all tests
pnpm run build          # Production build
pnpm run dev            # Watch mode
```

### CRITICAL: Run verification commands sequentially, NEVER in parallel
Never run typecheck, lint, or test as parallel sibling Bash tool calls.
Chain with `&&` or `;`: `pnpm run typecheck 2>&1; pnpm run lint 2>&1`

## Git Workflow

**`develop` is the default branch. `main` is production only.**

1. All development happens on `develop`
2. Never commit directly to `main`
3. Release to production via PR: `develop` -> `main`
4. Always run checks before committing (pre-commit hooks enforce this)
5. Always commit before pulling -- `git pull --rebase` requires a clean tree (hook enforced)
6. **Before any commit, verify the current branch** -- run `git branch --show-current` and confirm it matches your intent. If the user hasn't specified a branch, ask. (hook blocks push to main/master)
7. After config, dependency, or infrastructure changes, **immediately run the full test suite** before proceeding to the next task

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

## Conditional Blocks for Context-Specific Rules

As this file grows, wrap domain-specific sections in `<important if="condition">` tags.
The agent activates these only when the condition matches the current task, reducing noise.
Keep universal content (stack, structure, git workflow) unwrapped.

```markdown
<important if="you are writing or modifying tests">
- Use `createTestApp()` helper for integration tests
- Mock database with `dbMock` from `packages/db/test`
- Test fixtures live in `__fixtures__/` directories
</important>
```

- **Be specific.** `"you are writing tests"` is good. `"you are writing code"` matches everything and defeats the purpose.
- **Group by domain.** One block per domain (testing, deployment, database) — don't wrap individual lines.

## Agent Operational Rules

### Shell & Tools
- Chain verification commands sequentially, never as parallel Bash calls
- In worktrees: prefix every command with `cd /absolute/path && `
- Never use `~` in file tool paths -- use full absolute paths starting with `/`
- Always pass `{ encoding: 'utf-8' }` to `execSync`/`spawnSync`

### Git Recipes (use these exact sequences -- hooks enforce critical steps)
```bash
# Push sequence -- ALWAYS commit before pulling (Error #33, hook enforced)
git add <files> && git commit -m "msg" && git pull --rebase && git push

# First push -- set upstream tracking
git add <files> && git commit -m "msg" && git push -u origin <branch>

# Push with tag -- NEVER use --tags (Error #44, hook enforced)
git push origin main && git push origin v1.0.0
# Or: git push origin main --follow-tags

# Worktree cleanup
git worktree remove --force <path>; git branch -D <branch>
```

### Git Operations
- Run typecheck/lint BEFORE committing (pre-commit hooks run the same checks)
- Remove worktrees BEFORE merging PRs with `--delete-branch`
- Never fabricate filesystem paths -- use the working directory or discover with `ls`

### GitHub CLI
- Don't guess `gh --json` field names -- query available fields first
- Check CI per-PR with `--json`, not chained human-readable output
- `review: fail` means "needs approval", NOT a CI failure

### Sub-agents & Agent Teams
- Verify tool permissions before spawning sub-agents for write operations
- If a sub-agent fails due to permissions, take over manually immediately
- Monitor context size when running many parallel agents
- Agent Teams are enabled via `.claude/settings.json` -- use them for complex parallel work
- When creating a team: break work so each teammate owns different files (avoid conflicts)
- Teammates don't inherit conversation history -- include full context in spawn prompts
- Use subagents for focused tasks (result is all that matters); use teams for collaborative work requiring discussion
- **Only the main agent handles git commit/push.** Sub-agents and teammates write changes to their working directories. The main agent reviews the changes, runs tests, and commits centrally. This prevents wrong-branch pushes and merge conflicts from parallel agents.

## Push Accountability

Every push to the development branch requires CI verification. After pushing:
1. Spawn a background agent to monitor CI: `gh run list --branch develop --limit 1`
2. If CI passes -- log and move on
3. If CI fails -- background agent investigates with `gh run view <id> --log-failed`, fixes, and re-pushes
4. Main terminal continues working -- push verification is non-blocking
5. Never push to production from a background fix

## TDD Protocol

All code changes follow Red-Green-Refactor:
1. **Red** -- Write a failing test FIRST
2. **Green** -- Minimum code to pass
3. **Refactor** -- Clean up with green tests

No exceptions. Bug fixes need a regression test. Refactors need existing coverage. No "tests later."

## Agent Autonomy

Before asking the user to do anything manually:
1. Exhaust CLI tools (`gh`, `git`, project CLIs)
2. Exhaust shell commands (curl, build scripts)
3. Exhaust file tools (Read/Edit/Write for config changes)
4. Only then ask for human help -- with a clear explanation of what you tried

Autonomy applies to development work. Production-affecting actions always need explicit human authorization.

## Memory Management

When you discover an operational lesson during any session -- CI failure pattern, permission issue, workaround, tooling quirk, environment-specific behavior -- save it to auto memory immediately. Don't wait to be asked.

What to save proactively:
- CI/CD pipeline behaviors and failure patterns specific to this project
- Environment quirks (build flags, platform issues, dependency conflicts)
- Project-specific conventions confirmed by the user
- Workarounds for tools, APIs, or libraries used in this project
- Permission configurations that required adjustment

After completing `/bootstrap`, `/adopt`, or any significant configuration change, save the key decisions and project context to auto memory so future sessions start with full awareness.

## Project File Locations

Go directly to these paths — never search the codebase for them.

| Topic | Path | Notes |
|-------|------|-------|
| Agent reports | `docs/agents/*-report.md` | Flag YELLOW/RED items. Cross-agent context in `shared-context.md` |
| Agent logs | `logs/<name>.log`, `<name>.error.log` | Read alongside reports to diagnose failures |
| Agent scripts | `scripts/agents/` | Standalone bash files invoking Claude CLI headless |
| ADRs | `docs/decisions/` | Architecture decision records |
| PR descriptions | `docs/prs/{number}_description.md` | |
| Research docs | `docs/research/YYYY-MM-DD-description.md` | |
| Plans | `docs/plans/YYYY-MM-DD-description.md` | Phase files in `-phases/phase-N.md` |
