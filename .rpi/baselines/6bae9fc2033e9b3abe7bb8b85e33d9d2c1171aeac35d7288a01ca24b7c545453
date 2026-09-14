---
name: "error-patterns"
description: "Known agent error patterns -- debugging reference for tool failures, git errors, CI issues, and common mistakes. Consult when encountering unexpected behavior, tool errors, or CI failures."
user-invocable: false
---

# Error Patterns -- Top 20

**#1: Lost parallel verification results** --
Use `&&` or aggregate each exit status; bare `;` hides early failures.

**#2: Wrong worktree cwd** --
Bind each call to an observed worktree path or explicit workdir; verify branch.

**#3: Pre-commit hook rejection** --
Run typecheck/lint BEFORE committing. Fix first.

**#8: Tilde in file paths** --
Resolve an absolute path unless that specific file API promises expansion.

**#9: Push rejected (non-fast-forward)** --
Reconcile remote integration history locally, then rerun affected gates.

**#12: Push and forget CI** --
Inspect expected workflows for the authorized pushed commit.

**#13: Skipping TDD** --
Write the failing test FIRST. Red-Green-Refactor.

**#16: Dependencies not installed** --
Run `pnpm install` / `uv sync` before build/test/lint.

**#25: No upstream tracking** --
Working branches remain local; only completed integration may be published.

**#30: PR create before pushing** --
Do not publish a working branch merely to create a PR.

**#33: Pull rebase with dirty tree** --
Commit before `git pull --rebase` (hook enforced).

**#44: Push --tags pushes ALL tags** --
Push only the named authorized release tag: `git push origin v1.0.0`.

**#45: Fabricated filesystem paths** --
Never guess paths. Use Glob/Grep to find files first.

**#48: Commit/push to wrong branch** --
Run `git branch --show-current` before every commit.

**#49: Sub-agent git conflicts** --
Each sub-agent owns different files. Central commit.

**#51: CI explosion from parallel pushes** --
Integrate and verify locally; one authorized integration push may trigger several workflows.

**#56: Merge to main without topology** --
Ask: does merging to main deploy to production?

**#58: Deploy without preview verification** --
Run local runtime and platform preflights; never create Previews.

**#59: Improvised production recovery** --
Roll back immediately. Never deploy to diagnose.

**#62: Supabase migration without local test** --
Test role access with `supabase db reset --local`; remote application is separate.

## Error Domains

- **Shell & Tools:** #1, #2, #8, #16, #17, #22, #24, #36, #45
- **Git:** #3, #6, #9, #11, #15, #18, #25, #33, #44, #48,
  #54, #55
- **GitHub CLI:** #4, #10, #20, #23, #30, #31, #32, #35,
  #39, #52, #53
- **CI & Deployment:** #12, #50, #51, #56, #57, #58, #59, #60
- **Python/macOS:** #21, #26, #29, #37, #38, #40, #41, #42
- **Supabase:** #61, #62
- **Multi-Agent:** #19, #49, #63
- **Process:** #5, #7, #13, #14, #27, #28, #34, #43, #46,
  #47, #64

## References

- `references/error-catalog.md` -- one-line-per-error index of all 64 errors,
  grouped by the same domains above. Read it when the Top 20 above did not
  resolve the issue -- it points you at the right error number before you go
  looking for the full write-up.
- For the full symptom/root-cause/solution detail behind any error number,
  read `patterns/agent-errors.md` in the cc-rpi blueprint repository (not
  part of this project's local files).
