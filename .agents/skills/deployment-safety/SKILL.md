---
name: "Deployment Safety"
description: "Production deployment rules, rollback-first recovery, dependency batching, CI cost awareness, and framework upgrade verification."
---

# Deployment Safety

## Merging to Main

Wrong -- merge Dependabot PR thinking it's cleanup:

```bash
gh pr merge 42 --merge  # Dependabot targets main = production deploy
```

Right -- move the update onto the non-production integration path,
close the PR, and release normally:

```bash
# develop/main topology:
git checkout develop && git cherry-pick <commit>
gh pr close 42  # release via develop -> main

# main-only topology:
git checkout -b chore/dependency-updates main
git cherry-pick <commit>
gh pr close 42  # validate on branch/PR before merging back to main
```

## Dependency Batching

Wrong -- merge N PRs one-by-one (O(n^2) rebase cascade):

```bash
gh pr merge 1 && gh pr merge 2 && gh pr merge 3
# 7 PRs x 9 workflows = ~189 wasted CI runs
```

Right -- batch into a single branch:

```bash
# develop/main topology:
git checkout -b chore/dependency-updates develop

# main-only topology:
git checkout -b chore/dependency-updates main

# Apply all updates, run CI once, merge one PR
```

## CI Cost Awareness

Wrong -- push partial work to see if CI passes:

```bash
git push  # 9 workflows triggered, guess and check
```

Right -- test locally, push once:

```bash
pnpm run typecheck 2>&1; pnpm run lint 2>&1; pnpm run test 2>&1
git push  # confident it works
```

## Framework Upgrades

Wrong -- merge after CI passes (CI != production):

```bash
gh pr merge 99 --squash  # CI green, serverless runtime crashes
```

Right -- verify on preview deployment first:

```bash
# Push to non-main branch -> preview URL
# Verify: site loads, API routes respond, health checks pass
# Only then merge to main
```

## Production Incident Recovery

Wrong -- deploy fixes to prod while investigating:

```bash
vercel deploy --prod  # fails, deploy again, fails again
```

Right -- roll back first, investigate second:

```bash
vercel rollback  # Step 1: restore service immediately
# Step 2: investigate on non-production (logs, preview URL)
# Step 3: fix on the integration path, verify on preview,
# then merge to the production branch
```

## Justify Every Action

Before any CI run, deployment, or API call:

```text
1. Is this needed? (Can I achieve this locally?)
2. Is this justified? (Does this advance the task?)
3. Is this verifiable? (Will I know if it succeeded?)
If any answer is "no" -- do not proceed.
```
