---
description: RPI workflow details -- phase rules, pre-release sequence, implementation loop
---

# RPI Details

## Context Management

- Each RPI phase should be its own conversation.
  Preserve their acceptance boundaries unless the user explicitly authorizes
  continuation; a continuation instruction does not remove verification.
- Use `/clear` between unrelated tasks.
  Use `/compact` when context is heavy but the task continues.
- Handoffs record objective, approved scope, base/current commit and worktree,
  findings, decisions, check evidence and tested identity, deviations, risks and
  next phase. On resume, verify actual files, refs and evidence validity before
  relying on the handoff; compaction never grants new authority.
- Subagents are context control mechanisms --
  they search/read in their window and return only distilled results.
- Research and planning happen against the integration branch.
  Implementation happens in worktrees or temporary branches.

## Rules for All Phases

- Read controlling instructions/contracts and directly mentioned files completely.
  Inspect implementation to the depth needed; reuse valid prior reads.
- In `rpi-research`, document what exists without improvement recommendations.
  Use the separate `rpi-assess` workflow for evaluative research and alternatives.
- Every code reference must include file:line.
- Delegate only useful bounded independent assignments within this phase.
  A narrow task may stay with the parent. State objective, permitted actions,
  owned files, evidence/output, resource budget and terminal condition for each
  assignment. Missing required results remain coverage gaps until resolved.
- Never write documents with placeholder values.
- Exhaust all tools before suggesting manual steps --
  check CLI tools, shell commands, MCP servers, and file tools
  before escalating to the user.

## Rules for Implementation

- Follow the atomic loop:
  implement -> independent review -> repair -> simplify -> verify.
  The native simplify command or Codex helper catches code reuse, quality, and efficiency issues
  that the plan-compliance reviewer does not check.
- Independent batch work stays local, one owner per file set/worktree and one
  integration owner. Never use a batch mode that automatically publishes PRs.
  Keep at most three simultaneous implementers; use fewer when the task or
  available resources do not justify three.
- Run ALL automated verification after each phase.
- Stop after each phase for acceptance unless the user explicitly authorizes
  continuation. Finish all authorized phase work before that gate.
- If a technical discovery invalidates the plan contract, record the adjustment
  and explain the impact before dependent work; ask only for a required new decision.

## Pre-Release Workflow

`rpi-pre-launch` -> `rpi-remediate` -> `rpi-update-docs` -> `rpi-release`

After `rpi-pre-launch`, include a simplify pass for reuse, quality and
efficiency. Track its findings with the other audit results; resolve security
and infrastructure findings through the same review, repair and verification
loop. Preserve all required audit domains regardless of staffing.

Resolve every confirmed actionable finding before acceptance. Reject false
positives with evidence. Strategic findings needing a new architectural decision
receive explicit local dispositions and owner review; external issue creation
requires authorization. Never silently discard a finding.

## Testing Philosophy

Prefer automated verification.
Manual only for: sudo, hardware, new installs, visual-only.
Use deterministic linting/formatting tools. Preserve TDD for behavioral code
changes. Run all required phase/final gates locally, sequentially with failure
aggregation; a later success cannot erase an earlier failure. Reuse evidence
only for unchanged tested inputs, never as a substitute for an invalidated gate.
