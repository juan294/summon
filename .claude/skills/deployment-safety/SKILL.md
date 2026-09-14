---
name: "deployment-safety"
description: "Production deployment rules, rollback-first recovery, dependency batching, CI cost awareness, framework upgrade verification, fallback observability, and GitHub repo settings standardization."
---

# Deployment Safety

## Merging to Main

Read the actual deployment topology: `main` may be canonical source, production,
or both. A merge/push that deploys production requires explicit production
authorization. A request to clean up dependency PRs is not release authorization.

Keep working branches and worktrees local. Finish applicable tests, coverage,
typechecks, lint, build and deployment preflight locally, resolve failures,
and integrate completed work locally into the documented integration branch.
Inspect workflow and deployment triggers before the single authorized push of
that completed branch. Never create Vercel Preview deployments or publish
working branches/PRs for experimentation. If an integration push would create a
Preview, stop before pushing and use only a documented, non-destructive bypass.
Production publication remains separately and explicitly authorized. Read-only
inspection of existing runs and deployments is allowed.

## Dependency Batching

Inspect existing dependency PRs read-only. Apply the relevant updates together
on one local task-owned branch based on the documented integration branch:

```bash
git switch -c chore/dependency-updates <integration-branch>
# Apply reviewed updates and run the complete applicable local gate.
```

Integrate the verified result locally. Never merge dependency PRs one-by-one,
push fixes to their branches, request remote rebases, or create a batch PR as a
debugging loop. Closing/commenting on existing PRs needs authorization.

## CI Cost Awareness

Run tests, coverage, typechecks, lint, build and deployment preflight locally
when applicable. Use `&&` or explicit status aggregation so an early failing
check cannot be hidden by later success. Inspect all trigger types before the
single authorized integration push, including auxiliary workflows and report
publication. Existing logs and statuses can be inspected without triggering runs.

## Framework Upgrades

A green build alone does not establish runtime compatibility. Exercise local
runtime smoke tests, packaging and platform preflight, and inspect existing
platform logs/configuration. Never create a Vercel Preview. Record any remaining
platform-only uncertainty in the candidate's release review; do not claim local
tests prove an unexercised hosted runtime works.

## Production Incident Recovery

Under the project's authorized incident procedure, restore the known-good
release before investigating. Rollback is itself a production action and must
be within the authorization already provided.

```bash
# Only under an authorized Vercel rollback procedure:
vercel rollback
# Read existing logs, reproduce locally, fix and fully verify locally.
# Publish a completed production fix only with explicit authorization.
```

Never promote a broken deployment to gather logs or deploy repeatedly to diagnose.

## Fallback Observability

Wrong -- a fallback path activates silently, hiding a production bug:

```typescript
function getConfig() {
  try {
    return loadFromRemote();
  } catch {
    return DEFAULT_CONFIG;  // nobody is ever told this happened
  }
}
```

Right -- log at ERROR level, expose the degraded state in the health
endpoint, and wire an alert:

```typescript
function getConfig() {
  try {
    return loadFromRemote();
  } catch (error) {
    logger.error('[CONFIG_FALLBACK] using default config', { error });
    metrics.increment('fallback.config_default');  // feeds the alert
    return DEFAULT_CONFIG;
  }
}

app.get('/health', () => ({
  status: usingFallback ? 'degraded' : 'healthy',
}));
```

A silent fallback is a silent production bug. Treat any degraded-mode branch
as a first-class code path -- logging, health-endpoint coverage, and
alerting -- not just a catch block that quietly saves the request.

## Repo Settings Standardization

Wrong -- bootstrap a repo and leave GitHub defaults in place, letting merge
commits, stale branches, and disabled security updates drift in:

```bash
gh repo create myorg/new-project --public
# defaults: merge commits + rebase merges allowed, no auto-merge,
# branches linger after merge, Dependabot alerts off
```

When repository-settings changes are explicitly authorized, the canonical configuration is:

```bash
gh api -X PATCH repos/{owner}/{repo} \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true \
  -f allow_auto_merge=true
```

Also turn on Dependabot alerts and security update PRs, and restrict the
Production deployment environment to protected branches only, when authorized.
Preserve permanent integration branches. If a squash merge means ancestry cannot
prove local integration, retain the source branch and document equivalent
content; never default to force deletion. Do not alter settings to bypass a
blocked publication or enable remote compute during a local implementation.
