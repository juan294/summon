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
