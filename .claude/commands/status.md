Quick project status check. Output a concise orientation and stop.

Run these commands and present the results in a compact summary:

1. `git branch --show-current` — current branch
2. `git log --oneline -3` — last 3 commits
3. `git status --short` — uncommitted changes (if any)
4. `gh run list --branch $(git branch --show-current) --limit 1 --json conclusion,status,name 2>/dev/null` — latest CI status (skip if gh unavailable)
5. Check for any TODO/FIXME items in CLAUDE.md or open tasks

Present as a 5-line summary:

```
Branch: <branch>
Last commit: <message> (<hash>)
Working tree: <clean / N files changed>
CI: <status or "not available">
Open items: <count or "none">
```

Do NOT start any other work. Just report status and stop.
