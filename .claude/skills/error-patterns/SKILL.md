---
name: "Error Patterns"
description: "Known agent error patterns -- debugging reference for tool failures, git errors, CI issues, and common mistakes. Consult when encountering unexpected behavior, tool errors, or CI failures."
user-invocable: false
---

# Error Patterns -- Top 20

**#1: Parallel verification kills siblings** --
Chain with `;` or `&&`, never parallel Bash calls.

**#2: Worktree cwd resets to main repo** --
Prefix EVERY command with `cd /absolute/path &&`.

**#3: Pre-commit hook rejection** --
Run typecheck/lint BEFORE committing. Fix first.

**#8: Tilde in file paths** --
Never use `~` in Read/Write/Edit paths. Full absolute.

**#9: Push rejected (non-fast-forward)** --
Pull with rebase first: `git pull --rebase && git push`.

**#12: Push and forget CI** --
Spawn background agent to monitor CI after every push.

**#13: Skipping TDD** --
Write the failing test FIRST. Red-Green-Refactor.

**#16: Dependencies not installed** --
Run `pnpm install` / `uv sync` before build/test/lint.

**#25: No upstream tracking** --
First push: `git push -u origin branch-name`.

**#30: PR create before pushing** --
Push branch to remote BEFORE `gh pr create`.

**#33: Pull rebase with dirty tree** --
Commit before `git pull --rebase` (hook enforced).

**#44: Push --tags pushes ALL tags** --
Push specific: `git push origin v1.0.0` or `--follow-tags`.

**#45: Fabricated filesystem paths** --
Never guess paths. Use Glob/Grep to find files first.

**#48: Commit/push to wrong branch** --
Run `git branch --show-current` before every commit.

**#49: Sub-agent git conflicts** --
Each sub-agent owns different files. Central commit.

**#51: CI explosion from parallel pushes** --
Batch pushes. One push triggers one CI run.

**#56: Merge to main without topology** --
Ask: does merging to main deploy to production?

**#58: Deploy without preview verification** --
CI passing is NOT sufficient. Verify on preview URL.

**#59: Improvised production recovery** --
Roll back immediately. Never deploy to diagnose.

**#62: Supabase migration without local test** --
Always `supabase db reset` locally before `db push`.

## Error Domains

- **Shell & Tools:** #1, #2, #8, #16, #17, #22, #24, #36, #45
- **Git:** #3, #6, #9, #11, #15, #18, #25, #33, #44, #48,
  #54, #55
- **GitHub CLI:** #4, #10, #20, #23, #30, #31, #32, #35,
  #39, #52, #53
- **CI & Deployment:** #12, #50, #51, #56, #57, #58, #59, #60
- **Python/macOS:** #21, #26, #29, #37, #38, #40, #41, #42
- **Supabase:** #61, #62
- **Multi-Agent:** #19, #49
- **Process:** #5, #7, #13, #14, #27, #28, #34, #43, #46, #47

## Full Catalog

The complete 62-error catalog with detailed symptoms,
root causes, and solutions is at `patterns/agent-errors.md`
in the cc-rpi blueprint repository.
Read it when this reference doesn't resolve your issue.
