---
name: "codex-simplify"
description: "Review and simplify recently changed code after implementation, covering reuse, quality and efficiency while preserving behavior and verification evidence."
---

# Codex Simplify

Run a post-implementation cleanup pass over recently changed files.

This skill is the Codex approximation of Claude Code's bundled
`/simplify` behavior. It intentionally lives outside `.claude/skills/`
and uses the non-conflicting name `codex-simplify` so Claude Code keeps
its native `/simplify` command.

Preserve the public contract:

- target recently changed files
- review for reuse, quality, and efficiency
- use three independent review passes
- aggregate findings
- apply fixes

Treat any user-supplied focus, such as memory efficiency, dead code,
duplication, or readability, as extra weighting rather than a
replacement for the core three review lenses.

## When to use

Use this skill when:

- the code already exists
- the implementation or bug fix is already done
- the user wants a cleanup or refactoring pass rather than new feature
  work
- a workflow calls for a `/simplify`-style pass after review approval

Do not use this skill as a substitute for initial implementation, plan
compliance review, or full validation.

## Target file selection

Approximate "recently changed files" with this priority order:

1. Tracked unstaged changes in the current worktree
2. Tracked staged changes
3. Untracked files clearly related to the current task
4. If the tree is clean, files changed by the most recent commit

Use git to discover the set. Prefer file lists equivalent to:

```bash
git diff --name-only --diff-filter=ACMR
git diff --cached --name-only --diff-filter=ACMR
git ls-files --others --exclude-standard
git diff --name-only --diff-filter=ACMR HEAD~1..HEAD
```

Deduplicate the list. Exclude generated artifacts, lockfiles, build
output, and unrelated files unless the user explicitly asks for them.

If there are no relevant changed files, stop and report that
`codex-simplify` has nothing to do.

## Review workflow

Run three independent review passes over the same target file set:

1. **Reuse pass**
   Look for duplication, repeated logic, avoidable branching, and places
   where a simpler shared helper or existing abstraction should be used.
2. **Quality pass**
   Look for confusing structure, dead code, weak naming, brittle
   conditionals, unnecessary complexity, and maintainability problems.
3. **Efficiency pass**
   Look for avoidable work, redundant allocations, repeated I/O,
   wasteful data transformations, and obvious performance footguns.

Choose staffing from the changed scope and available resources. The parent
may perform all three passes locally, keeping their findings independent until
aggregation. Delegate only useful bounded assignments with objective, permitted
actions, files, evidence/output and terminal condition. Three review lenses do
not require three agent instances; respect the project concurrency limit.

Each pass should:

- stay inside the changed-file scope unless a tiny adjacent edit is
  required for correctness
- prefer concrete, behavior-preserving improvements over style-only
  opinions
- respect existing project patterns unless the changed code clearly
  violates them
- treat any user-supplied focus as extra weighting, not as permission to
  ignore reuse, quality, or efficiency entirely

## Aggregation rules

After the three passes, combine findings into one action set:

- deduplicate overlapping suggestions
- prefer the smallest safe change that resolves the issue
- reject churn that only restyles code without improving it
- reject broad architectural rewrites unless they are clearly necessary
  to remove duplication or complexity introduced by the recent change
- preserve behavior, tests, and plan intent

If two fixes conflict, prefer the version that is simpler, lower-risk,
and more local to the changed code.

## Applying fixes

Apply behavior-preserving corrections within the existing authorized scope.
A read-only review assignment returns findings without edits. Ask only when a
necessary change introduces a decision or authority the user has not supplied.

Default priorities:

1. Remove duplication introduced by the recent change
2. Delete dead code or unreachable branches
3. Collapse unnecessary indirection
4. Tighten inefficient hot-path logic
5. Improve names or local structure where that meaningfully reduces
   confusion

Do not:

- expand the task into unrelated refactors
- rewrite stable untouched modules just because they could be cleaner
- change public behavior intentionally
- introduce speculative abstractions

Add or adjust focused tests only when needed to preserve behavior during
a non-trivial simplification.

## Output contract

At the end:

- summarize what changed
- group the rationale under reuse, quality, and efficiency
- mention any fallback used to determine the target file set
- report exact changed files and behavior areas, plus any rejected findings
  and their evidence
- identify which checks or receipts the edits invalidated

In a standalone invocation, rerun all invalidated applicable checks before
claiming completion and report results against the resulting candidate. Reuse
prior passing evidence only when its tested inputs remain unchanged.

When a parent workflow owns verification, hand back the exact changed scope,
invalidated evidence and required reruns for its acceptance gate. Do not claim
the parent gate passed or finish with an unspecified verification reminder.
