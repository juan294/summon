---
name: "CI Workflow"
description: "Push accountability, CI monitoring after push, background agent CI verification, verification command sequencing."
---

# CI Workflow

## Push Accountability

Wrong -- push and move on:

```bash
git push origin develop
# Start next task immediately, never check CI
```

Right -- spawn background agent to monitor CI:

```bash
git push origin develop
# Background agent:
gh run list --branch develop --limit 1
# If CI fails: investigate with gh run view <id> --log-failed
# Fix and re-push. The push isn't done until CI is green.
```

## Verification Command Sequencing

Wrong -- run typecheck, lint, test as parallel tool calls:

```bash
# Parallel call 1: pnpm run typecheck
# Parallel call 2: pnpm run lint
# Parallel call 3: pnpm run test
# If one fails, all parallel calls are killed (Error #1)
```

Right -- chain sequentially with semicolons:

```bash
pnpm run typecheck 2>&1; pnpm run lint 2>&1; pnpm run test 2>&1
```

## Pre-Commit Verification

Wrong -- commit first, discover failures from pre-commit hook:

```bash
git commit -m "feat: add feature"
# Pre-commit hook fails: lint errors, type errors
```

Right -- run checks before committing:

```bash
pnpm run typecheck 2>&1; pnpm run lint 2>&1
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
pnpm run typecheck 2>&1; pnpm run lint 2>&1; pnpm run test 2>&1
# Fix any breakage before proceeding
```
