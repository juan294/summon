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
- Research and planning happen on the default branch.
  Implementation happens in worktrees or feature branches.

## Rules for All Phases

- Read all mentioned files COMPLETELY before doing anything else.
- Never suggest improvements during research --
  only document what exists.
- Every code reference must include file:line.
- Spawn parallel subagents for independent research tasks.
  Wait for ALL before synthesizing.
- Never write documents with placeholder values.

## Rules for Implementation

- Follow the atomic loop:
  implement -> review -> fix -> approve -> `/simplify` -> verify.
- Check for `[batch-eligible]` phases --
  use `/batch` to execute independent phases in parallel.
- Run ALL automated verification after each phase.
- STOP after each phase and wait for human confirmation.
- If the plan doesn't match reality, STOP and explain.

## Pre-Release Workflow

`/pre-launch` -> `/remediate` -> `/update-docs` -> `/release`

## Testing Philosophy

Prefer automated verification.
Manual only for: sudo, hardware, new installs, visual-only.
Don't use Claude for linting/formatting -- use tools and hooks.
