---
description: RPI workflow details -- phase rules, pre-release sequence, implementation loop
---

# RPI Details

## Context Management

- Each RPI phase should be its own conversation.
  Don't run research + plan + implement in one session.
- Use `/clear` between unrelated tasks.
  Use `/compact` when context is heavy but the task continues.
- Subagents are context control mechanisms --
  they search/read in their window and return only distilled results.
- Research and planning happen against the integration branch.
  Implementation happens in worktrees or temporary branches.

## Rules for All Phases

- Read all mentioned files COMPLETELY before doing anything else.
- Never suggest improvements during research --
  only document what exists.
- Every code reference must include file:line.
- Spawn parallel subagents for independent research tasks.
  Wait for ALL before synthesizing.
- Never write documents with placeholder values.
- Exhaust all tools before suggesting manual steps --
  check CLI tools, shell commands, MCP servers, and file tools
  before escalating to the user.

## Rules for Implementation

- Follow the atomic loop:
  implement -> review -> fix -> approve -> `/simplify` -> verify.
  `/simplify` catches code reuse, quality, and efficiency issues
  that the plan-compliance reviewer does not check.
- Check for `[batch-eligible]` phases --
  use `/batch` to execute independent phases in parallel.
  `[batch-eligible]` is decided during `/plan` by identifying phases
  with no file overlap; `/batch` then runs them in parallel, one
  worktree per phase, each opening a PR.
- Use `/batch` for bulk changes outside RPI too --
  migrations, multi-issue sprints, repetitive refactors. Don't
  manually iterate through 20 files when `/batch` can parallelize.
- Run ALL automated verification after each phase.
- STOP after each phase and wait for human confirmation.
- If the plan doesn't match reality, STOP and explain.

## Pre-Release Workflow

`/pre-launch` -> `/remediate` -> `/update-docs` -> `/release`

After `/pre-launch`, run `/simplify` first -- it fixes dead code,
duplicates, and inefficiencies in one pass. Then address security
and infrastructure findings manually.

Fix everything, always: categorize findings by severity, but fix
100%. With AI agents, fix cost is near-zero. Exception: `/remediate`
Wave 3 (Later/strategic) items get issues filed but no fix agents --
those require human architectural judgment.

## Testing Philosophy

Prefer automated verification.
Manual only for: sudo, hardware, new installs, visual-only.
Don't use Claude for linting/formatting -- use tools and hooks.
