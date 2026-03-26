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

<important if="you are merging PRs, merging branches to main, deploying, or handling dependency updates">
### Deployment Safety

- **Merging to `main` IS deploying to production.** Every merge triggers a production deployment. No exceptions.
- **Dependabot PRs target `main` by default.** Never merge them directly. Cherry-pick to `develop`, close the PR, release normally.
- **Every CI run and deployment costs money.** Before starting: estimate how many runs/deploys this will trigger. If more than 2-3, batch the work.
- **Framework upgrades (Next.js, React, etc.) require preview deployment verification.** CI passing is NOT sufficient. Deploy to a preview URL and verify before merging to production.
- **When production is down:** Roll back immediately. Investigate on non-production. Fix forward on `develop`. Never deploy to diagnose. Never promote broken deployments "briefly."
- **Batch dependency updates** into a single branch and PR. Never merge N PRs one-by-one (causes O(n^2) CI waste from rebase cascades).
- **Justify every external action** -- before any CI run, deployment, or API call: Is this needed? Is this justified? Is this verifiable? If any answer is "no," stop.
</important>

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

## Working Patterns

<examples>
<example name="push-sequence">
Commit before pulling -- hook blocks dirty pulls.

```bash
git add src/feature.ts && git commit -m "feat: add feature"
git pull --rebase && git push
```

</example>

<example name="verification">
Run checks sequentially, never as parallel tool calls.

```bash
pnpm run typecheck 2>&1; pnpm run lint 2>&1; pnpm run test 2>&1
```

</example>

<example name="worktree-cleanup">
Remove worktrees before merging PRs. Use -D (uppercase) for branches.

```bash
git worktree remove --force ../feature-branch; git branch -D feature-branch
```

</example>

<example name="file-paths">
Use absolute paths in all file tools and worktree commands. Never use ~.

```bash
cd /Users/dev/project && pnpm run test
```

</example>
</examples>

Domain-specific rules (git, CI, deployment, macOS, GitHub CLI, multi-agent) are in `.claude/skills/` -- loaded automatically when relevant.

<important if="you are pushing code to a remote">
### Push Accountability

After pushing to the development branch, spawn a background agent to monitor CI.
If CI fails, the background agent investigates, fixes, and re-pushes.
Main terminal continues working -- push verification is non-blocking.
</important>

## TDD Protocol

All code changes follow Red-Green-Refactor:
1. **Red** -- Write a failing test FIRST
2. **Green** -- Minimum code to pass
3. **Refactor** -- Clean up with green tests

No exceptions. Bug fixes need a regression test. Refactors need existing coverage. No "tests later."

## Agent Autonomy

Exhaust CLI tools, shell commands, and file tools before asking the user. Only escalate when genuinely impossible. Production-affecting actions need explicit human authorization.

## Memory Management

Save operational lessons to auto memory immediately -- CI failure patterns, environment quirks, project conventions, permission issues. Don't wait to be asked.

## Project File Locations

Go directly to these paths — never search the codebase for them.

| Topic | Path | Notes |
|-------|------|-------|
| Agent reports | `docs/agents/*-report.md` | Gitignored. Local-only operational history. Never committed (Rule #70) |
| Agent logs | `logs/<name>.log`, `<name>.error.log` | Gitignored. Read alongside reports to diagnose failures |
| Agent scripts | `scripts/agents/` | Gitignored. Standalone bash files invoking Claude CLI headless |
| ADRs | `docs/decisions/` | Architecture decision records |
| PR descriptions | `docs/prs/{number}_description.md` | |
| Research docs | `docs/research/YYYY-MM-DD-description.md` | |
| Plans | `docs/plans/YYYY-MM-DD-description.md` | Phase files in `-phases/phase-N.md` |
