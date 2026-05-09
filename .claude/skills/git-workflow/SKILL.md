---
name: "Git Workflow"
description: "Git recipes, worktree management, push sequences, branch verification, and conflict resolution patterns."
---

# Git Workflow

## Push Sequence

Wrong -- unstaged changes break the pull:

```bash
git pull --rebase && git push
```

Right -- commit before pulling (clean tree required):

```bash
git add <files> && git commit -m "msg" && git pull --rebase && git push
```

## First Push / PR Creation

Wrong -- no upstream, push and gh pr create both fail:

```bash
git push && gh pr create --title "feat: thing"
```

Right -- set upstream on first push:

```bash
git push -u origin <branch> && gh pr create --title "feat: thing"
```

## Push with Tag

Wrong -- pushes ALL local tags, fails if any old tag exists on remote:

```bash
git push --tags
```

Right -- push specific tags by name or use --follow-tags:

```bash
git push origin main && git push origin v1.0.0
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

Wrong -- relative paths and lowercase -d:

```bash
cd ../worktree && pnpm test           # cwd resets between calls
git worktree remove <path> && git branch -d <branch>  # -d fails
```

Right -- absolute paths, force remove, uppercase -D:

```bash
cd /absolute/path/to/worktree && pnpm test
git worktree remove --force <path>; git branch -D <branch>
```

Always remove worktrees BEFORE merging PRs with `--delete-branch`.

## Conflict Resolution

Wrong -- plain checkout fails on unmerged files:

```bash
git checkout -- conflicted-file.ts
```

Right -- pick a side, abort, or remove conflicting untracked files:

```bash
git checkout --ours file.ts    # keep yours
git checkout --theirs file.ts  # keep incoming
git rebase --abort             # cancel entirely
rm untracked-file.ts && git merge feature  # untracked collision
```
