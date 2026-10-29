---
name: "multi-agent"
description: "Rules for sub-agents, Agent Teams, worktree agents, central commit pattern, and parallel work coordination."
---

# Multi-Agent Coordination

## Central Commit Pattern

Shared-worktree subagents edit only their assigned files. The orchestrator owns
commits there. Agents in isolated task-owned worktrees may commit locally:

```bash
git branch --show-current
git add <assigned-files> && git commit -m "fix: scoped change"
```

The orchestrator reviews and integrates completed commits locally. Never stage
unrelated files or publish a working branch/PR.

## Central Push Pattern

A single command pushing N branches still triggers remote work for N branches.
Keep all working branches local. Complete applicable tests, coverage, typechecks,
lint, build and deployment preflight locally, then integrate and verify the
combined result. Inspect workflow/deployment triggers before the single authorized
push of the completed integration branch. Never create Vercel Previews;
production publication remains separately and explicitly authorized.

After an authorized push, inspect every expected run for its exact commit.
Existing logs can inform local repair; never trigger a hosted rerun/re-push loop.

## Sub-Agent Permissions

Wrong -- spawn sub-agent for write operation, it fails silently:

```bash
# Sub-agent: "I don't have permission to edit files"
```

Right -- verify permissions before spawning, take over if blocked:

```text
1. Check tool permissions before spawning sub-agents for write ops
2. If a sub-agent fails due to permissions, take over manually immediately
3. Don't retry the sub-agent -- do the work yourself
```

## Agent Team Spawn Context

Wrong -- teammate has no context, makes wrong assumptions:

```text
"Fix the login bug"
```

Right -- include full context since teammates don't inherit history:

```text
"Fix the login bug in /absolute/path/src/auth/login.ts:42.
The session token is not being refreshed on 401 responses.
The fix: add a retry with token refresh in the catch block.
Run 'cd /absolute/path && pnpm test src/auth/' to verify."
```

## File Ownership

Wrong -- two teammates edit the same file, merge conflict:

```text
Teammate A: edit src/api/routes.ts
Teammate B: edit src/api/routes.ts
```

Right -- break work so each teammate owns different files:

```text
Teammate A: edit src/api/auth-routes.ts
Teammate B: edit src/api/user-routes.ts
```

## Scope & Watchdog

Wrong -- open-ended task, no stop condition: the agent keeps investigating
long after its real work is done (a fork agent ran 2+ hours past completion).

```text
"Look into the CI failures and fix what you find."
```

Right -- one-sentence scope with an explicit terminal condition:

```text
"Fix the failing applyRateLimit test in src/rate-limit.test.ts so the suite
is green. STOP the moment that test passes -- do not investigate other
failures, refactor, or open new threads. Report back with the diff."
```

Rules for the orchestrator:

- Give every spawned agent a **single-sentence scope** and a **terminal
  condition** ("stop the moment X is true"). No open-ended "look into".
- Set a **wall-clock budget** (~15-20 min for a focused fix). If an agent
  is still running past it, kill it and inspect -- don't let it spin.
- Require a **progress checkpoint** for long fan-outs: agents report status
  every few files so a stuck agent is visible, not silent.

## Dedup Before Continuing

Wrong -- an agent resumes work a sibling already committed, producing a
duplicate (e.g. a second `applyRateLimit` test block already on the branch).

```text
Agent B keeps adding tests without checking what Agent A committed.
```

Right -- check the actual repo state before doing or continuing work:

```bash
git log --oneline -10        # has a sibling already landed this?
git status                   # is the change already staged/committed?
grep -rn "applyRateLimit" test/   # does the artifact already exist?
```

If the work is already done, stop and report -- do not redo it.

## Scoped Testing Under Parallelism

Wrong -- every parallel agent runs the full test suite, exhausting CPU/memory:

```bash
# Agent 1 (worktree A): pnpm test          -> spawns full worker pool
# Agent 2 (worktree B): pnpm test          -> spawns full worker pool
# Agent 3 (worktree C): pnpm test          -> spawns full worker pool
# N agents x full-suite workers = CPU/memory exhaustion on one machine
```

Right -- agents test only their changed files; run the full suite once, at
integration:

```bash
# Each worktree agent: scoped run against its own changed files
pnpm test src/rate-limit.test.ts

# Main agent, after merging all branches: one full-suite run
pnpm test
```

Limit concurrent agents to 3-4. The full suite runs once, after merging --
not once per agent.
