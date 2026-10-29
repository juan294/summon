---
description: Remote budget and push accountability -- local verification, one completed integration push, no Preview deployments
---

# Push Accountability

Keep working branches and worktrees local. Finish applicable tests, coverage,
typechecks, lint, build and deployment preflight locally, resolve failures,
and integrate completed work locally into the documented integration branch.
Inspect workflow and deployment triggers before the single authorized push of
that completed branch. Never create Vercel Preview deployments or publish
working branches/PRs for experimentation. If an integration push would create a
Preview, stop before pushing and use only a documented, non-destructive bypass.
Production publication remains separately and explicitly authorized. Read-only
inspection of existing runs and deployments is allowed.

Commit or preserve intended changes before pulling; never pull through a dirty
tree. After an authorized push, inspect every expected workflow for the exact
pushed commit. Diagnose failures from existing logs and reproduce/fix locally.
Report the failed remote result; do not trigger reruns or a fix-and-repush loop.
A new remote action needs authorization after the complete local gates pass.
