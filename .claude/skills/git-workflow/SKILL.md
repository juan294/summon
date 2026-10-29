---
name: "git-workflow"
description: "Git recipes, worktree management, push sequences, branch verification, and conflict resolution patterns."
---

# Git Workflow

## Push Sequence

Keep working branches and worktrees local. Finish applicable tests, coverage,
typechecks, lint, build and deployment preflight locally, resolve failures,
and integrate completed work locally into the documented integration branch.
Inspect workflow and deployment triggers before the single authorized push of
that completed branch. Never create Vercel Preview deployments or publish
working branches/PRs for experimentation. If an integration push would create a
Preview, stop before pushing and use only a documented, non-destructive bypass.
Production publication remains separately and explicitly authorized. Read-only
inspection of existing runs and deployments is allowed.

Commit intended files locally before pulling. Fetch and inspect the remote
integration tip before final local integration; if it moved, reconcile locally
and repeat the applicable gates. Do not rebase through uncommitted work.

```bash
git branch --show-current
git add <files> && git commit -m "msg"
git fetch origin
# Inspect origin/<integration-branch>; integrate and verify locally.
# Only after trigger inspection and authorization:
git push origin <integration-branch>
```

## Empty Repositories

Wrong -- `git log` and `git diff HEAD` fail on a repo with no commits yet:

```bash
git log -1
git diff HEAD
```

Right -- check for a HEAD first:

```bash
git rev-parse HEAD 2>&1 || echo "no commits yet -- skip log/diff HEAD"
```

## First Publication

Working branches have no remote upstream because they remain local. Do not
create feature, temporary, or remediation PRs. The orchestrator integrates
completed work locally and publishes only the documented integration branch
once, subject to the remote-budget and production authorization boundaries.

## Push with Tag

Wrong -- pushes ALL local tags, fails if any old tag exists on remote:

```bash
git push --tags
```

Right -- after release authorization, push only the named release tag:

```bash
git push origin main
# Observe required main CI passing for the exact pushed SHA before the tag:
git push origin v1.0.0
```

## Branch Verification

Wrong -- assume branch from conversation context:

```bash
git commit -m "feat: add feature"
```

Right -- verify branch before every commit:

```bash
git branch --show-current && git commit -m "feat: add feature"
```

## Worktree Management

Use absolute worktree paths or the tool's explicit per-call working directory.
Do not infer cwd or branch from an earlier shell call. Before cleanup, establish that this task owns the
worktree and branch, all source changes are integrated, and plans, handoffs,
ignored evidence and untracked files are preserved outside the disposable tree.
A clean `git status` alone cannot prove ignored artifacts are preserved.

```bash
git worktree list --porcelain
git -C /absolute/path/to/worktree status --short --untracked-files=all
git -C /absolute/path/to/worktree ls-files --others --ignored --exclude-standard
git merge-base --is-ancestor <working-branch> <integration-branch>
# Proceed only after ownership, preservation and integration are confirmed.
git worktree remove /absolute/path/to/worktree && git branch -d <working-branch>
```

If removal or `-d` refuses, retain the worktree/branch and investigate. A squash
merge does not preserve ancestry; record equivalent integrated content and
preserve the original branch instead of defaulting to force deletion. Never
remove a foreign worktree or delete every branch returned by a listing.

## Cleanup After Merge

Remove only the verified task-owned worktree using the procedure above. Report
retained artifacts and branches with their reasons. Other active worktrees and
unmerged branches are expected to survive. No remote branch cleanup is needed
for branches that were never published.

## Conflict Resolution

Wrong -- plain checkout fails on unmerged files:

```bash
git checkout -- conflicted-file.ts
```

Right -- inspect `git status` and the conflicting contents first. Resolve the intended combination; preserve untracked collisions outside the worktree before retrying. Never delete unknown files:

```bash
git checkout --ours file.ts    # keep yours
git checkout --theirs file.ts  # keep incoming
git rebase --abort             # cancel entirely
# Preserve the untracked collision at a verified unique recovery path first.
```
