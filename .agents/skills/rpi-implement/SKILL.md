---
name: "rpi-implement"
description: "Execute an approved phased plan through implementation, review, repair, simplify and complete local verification before each acceptance boundary."
---

# Implement the Approved Plan

Use the plan path and selected phases in the request. Read the entire plan and
current phase specifications, existing checkmarks and deviation/handoff notes.
Read controlling instructions/contracts completely. On resume, verify the actual
worktree, branch, base/current commit and local changes against the handoff before
using its check evidence or starting dependent work.

When a parent uses a machine-readable assignment/acceptance record, follow the
[dispatch contract](references/dispatch.md) and validate it before claiming
complete coverage. The record is optional for a small parent-only task; required
review, TDD and phase acceptance still apply.

## Process

1. Gather the relevant code, tests and project rules. Use bounded independent
   research assignments when helpful; do not repeat completed research without a
   concrete uncertainty.
2. Track tasks and work in an isolated local branch/worktree. Research and planning
   start from the documented integration branch. Verify branch identity before
   every commit and preserve unrelated work.
3. Complete phases in dependency order with review and verification at each
   acceptance boundary. An all-phases continuation permits moving to the next
   completed boundary; it does not overlap phases. Use batch/worktree mechanics
   only for independent units inside the current approved phase. Keep each
   worktree local and disable native batch publication. One integration owner
   manages commits/merges; no feature PRs.
4. For the current authorized phase, keep narrow work with the parent or select
   useful independent assignments with distinct file ownership. Each states its
   objective, permitted actions/files, required evidence/output, resource constraints
   and completion condition. Keep at most three simultaneous implementers; available
   harness slots and contention may require fewer. Group related failures by cause
   rather than allocating one worker per failing test. One integration owner accounts
   for every required result and changes no other assignment's files silently.
5. For behavioral code changes, write a failing test first, verify that it captures
   the required behavior and preserves affected invariants, then implement the
   minimum correct change. Never weaken a valid test to hide a defect.
6. Review plan compliance independently: every planned item, acceptance criterion
   and confirmed actionable finding must be accounted for. Repair findings and
   repeat review until approved. Reject false positives with concrete evidence;
   architectural/new-scope decisions remain explicit unresolved dispositions.
   The implementation author cannot supply its only independent review. A missing,
   failed or incomplete reviewer result blocks acceptance; obtain the required review
   through a fresh context or qualified reviewer before claiming completion.
7. Run the harness-native simplify pass (or the Codex simplify helper), reviewing reuse, quality and efficiency.
   Apply confirmed improvements and verify any changed tested inputs.
8. Run the complete applicable local gate: tests, coverage, typechecks, lint, build,
   repository invariants and deployment preflight. Sequence resource-intensive
   checks and preserve every exit status. Reuse valid evidence only when the
   candidate inputs and check selection are unchanged.
9. Mark completed items and apply the [durable handoff](references/handoff.md)
   contract in the phase notes, including every finding's disposition and exact
   candidate/check identity. Include pending work and next-phase entry conditions.
   Record deviations in `docs/plans/<plan-name>-notes.md` under `## Deviations`:
   plan said / found / chose / why. Preserve approved plans, phase files and notes
   as curated history; raw operational evidence follows visibility policy.
10. Integrate completed work locally and verify the combined result. Inspect
    hosted triggers before any single authorized integration push. Never create
    Vercel Previews, publish working branches/PRs or debug through hosted CI.

## Phase boundary and preservation

Complete implement -> review -> fix -> approve -> simplify -> verify before the
phase acceptance report. Stop after that phase unless the user explicitly
requested continuation. Retain per-phase evidence and handoffs even during an
all-phases run. Do not remove a worktree until changes, plans, handoffs, untracked
files and ignored evidence are preserved and integration/ownership established.

If reality invalidates the plan, explain Expected / Found / Why it matters and
record the necessary plan adjustment before dependent work. Routine path/name
corrections do not require a new approval; an unresolved architecture or scope
decision does. Never silently bypass a failed acceptance requirement.

## Bundled contract tools

For a structured handoff, resolve `scripts/rpi-dispatch.py` relative to this
installed skill; its sibling `scripts/validate-findings.py` checks report IDs
and references. Follow [dispatch](references/dispatch.md) for invocation and
[durable handoff](references/handoff.md) for actual-state revalidation.
