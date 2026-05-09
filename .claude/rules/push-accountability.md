---
description: Push accountability -- commit before pull, CI verification after push, background monitoring
---

# Push Accountability

Always commit before `git pull --rebase` -- hook enforced.

After pushing, spawn a background agent to monitor CI.
If CI fails, the agent investigates, fixes, and re-pushes.
Main terminal continues -- push verification is non-blocking.
