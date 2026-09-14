---
name: "ci-workflow"
description: "Push accountability, CI monitoring after push, background agent CI verification, verification command sequencing."
---

# CI Workflow

## Push Accountability

Keep working branches and worktrees local. Finish applicable tests, coverage,
typechecks, lint, build and deployment preflight locally, resolve failures,
and integrate completed work locally into the documented integration branch.
Inspect workflow and deployment triggers before the single authorized push of
that completed branch. Never create Vercel Preview deployments or publish
working branches/PRs for experimentation. If an integration push would create a
Preview, stop before pushing and use only a documented, non-destructive bypass.
Production publication remains separately and explicitly authorized. Read-only
inspection of existing runs and deployments is allowed.

After an authorized integration push, match every expected workflow to its
pushed commit, rather than assuming the latest branch run belongs to this push:

```bash
gh run list --branch <integration-branch> --commit <pushed-sha> \
  --json databaseId,headSha,name,status,conclusion
gh run view <failed-run-id> --log-failed
```

Failure diagnosis and repair happen locally. Do not rerun remote workflows or
re-push fixes as a debugging loop; report the result and complete local gates
before any separately authorized follow-up publication.

## Buffer Output from execSync/spawnSync

Wrong -- `.trim()` fails because these return a Buffer by default:

```js
const sha = execSync('git rev-parse HEAD').trim();  // TypeError
```

Right -- pass encoding explicitly:

```js
const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
```

## Running ESM CLI Tools

A shebang or executable bit does not change Node's module interpretation.
Use `.mjs` for ESM, `.cjs` for CommonJS, or a `.js` file governed by its nearest
package.json `"type"` field. Respect the project's supported Node version and
package metadata; invoking via `npx` does not repair invalid module metadata.

```bash
node ./bin/cli.mjs
# Or: node ./bin/cli.js with nearest package.json declaring "type": "module"
```

## Missing Dependencies

Wrong -- run commands in a worktree, fresh clone, or CI with no node_modules:

```bash
pnpm run build  # Cannot find module ...
```

Right -- install first:

```bash
pnpm install && pnpm run build
```

## Scaffolding Requires an Empty Directory

Wrong -- add config files before scaffolding, so the tool aborts:

```bash
echo "# Project" > CLAUDE.md
npx create-next-app@latest .   # aborts: directory not empty
```

Right -- scaffold first, add config files after:

```bash
npx create-next-app@latest .
echo "# Project" > CLAUDE.md
```

## Verification Command Sequencing

Wrong -- run typecheck, lint, test as parallel tool calls:

```bash
# Parallel call 1: pnpm run typecheck
# Parallel call 2: pnpm run lint
# Parallel call 3: pnpm run test
# If one fails, all parallel calls are killed (Error #1)
```

Right -- chain sequentially with `&&` so early failures cannot be hidden:

```bash
pnpm run typecheck 2>&1 && pnpm run lint 2>&1 && pnpm run test 2>&1
```

## Pre-Commit Verification

Wrong -- commit first, discover failures from pre-commit hook:

```bash
git commit -m "feat: add feature"
# Pre-commit hook fails: lint errors, type errors
```

Right -- run checks before committing:

```bash
pnpm run typecheck 2>&1 && pnpm run lint 2>&1 &&
git add <files> && git commit -m "feat: add feature"
```

## Config Change Blast Radius

Wrong -- change tsconfig and continue coding:

```bash
# Edit tsconfig.json
# Continue implementing next feature
# Discover 200 type errors at commit time
```

Right -- run full test suite immediately after config changes:

```bash
# Edit tsconfig.json
pnpm run typecheck 2>&1 && pnpm run lint 2>&1 && pnpm run test 2>&1
# Fix any breakage before proceeding
```
