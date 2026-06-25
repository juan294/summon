---
name: "Multi-Agent Coordination"
description: "Rules for sub-agents, Agent Teams, worktree agents, central commit pattern, and parallel work coordination."
---

# Multi-Agent Coordination

## Central Commit Pattern

Wrong -- sub-agent pushes directly, causes wrong-branch push:

```bash
# In sub-agent worktree:
git add . && git commit -m "fix" && git push origin feature-branch
```

Right -- sub-agent commits locally, main agent pushes:

```bash
# Sub-agent (worktree): commit only
git add . && git commit -m "fix"

# Main agent: review, then batch-push all branches
git push origin branch-1 branch-2 branch-3
```

## Central Push Pattern

Wrong -- N agents push independently, triggering N x M CI runs:

```bash
# Agent 1 pushes -> 9 CI workflows
# Agent 2 pushes -> 9 CI workflows
# Agent 3 pushes -> 9 CI workflows
# Total: 27 workflow runs
```

Right -- main agent batch-pushes, monitors CI centrally:

```bash
# All agents commit locally in their worktrees
# Main agent pushes all at once:
git push origin branch-1 branch-2 branch-3
# One background agent monitors all CI runs
```

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
"Look into the Chapa failures and fix what you find."
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
