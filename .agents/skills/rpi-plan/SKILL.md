---
name: "rpi-plan"
description: "Create a cited phased implementation specification with behavioral oracles, explicit scope and measurable automated and manual acceptance criteria."
---

Create an implementation plan for: the request

Process:
1. Read controlling instructions/contracts and directly mentioned files completely,
   including accepted research or assessment when present. Revalidate their baseline against the
   actual worktree; cite valid findings and decisions rather than reconstructing them.
2. Find relevant code, patterns and docs. Keep narrow work with the parent. Useful
   independent assignments stay within planning and state objective, permitted
   read-only actions/files, evidence/output, resource limits and completion condition.
   Use available slots and inspect every required result and coverage gap.
3. Inspect discovered implementation to the depth required by unresolved decisions;
   reuse valid prior reads instead of rereading every discovered file.
4. Present your understanding and ask only for material information the request,
   accepted artifacts and repository cannot resolve. Do not repeat supplied decisions.
5. Resolve remaining uncertainties with targeted evidence when needed.
6. Present design options with trade-offs.
7. Propose phase structure, get feedback.
8. Write detailed plan with separate phase files.
9. Read [the pseudocode notation](references/pseudocode-notation.md) and use it
   for nontrivial changes. Ground acceptance in executable or checkable evidence.
10. When the plan specifies behavior, prefer pointing at an executable or checkable
    artifact (a failing test, a module with the semantics to match, a mockup, a rubric)
    over describing the behavior in prose.
11. Separate automated vs. manual success criteria.
12. Write a **Stuck states and recovery** section: for every state the change
    can enter that fails closed, blocks work, or degrades output (a barrier,
    lock, fallback, disabled path, cached error), state who sees it and what
    they see; how it ends without insider knowledge (automatic recovery, or a
    visible prompt that starts the fix); and the test that proves it ends or
    that the user is told. A safety test alone is not enough; each stuck state
    also needs a recovery-or-disclosure test. "Recovery requires a manual step"
    is acceptable only when the user is shown that step.
13. Write a **Consumer sweep** section when the change alters what a shared
    function, type, cache format or fixture returns or stores (especially on
    failure): list every caller and writer found by search, with the command
    used, and mark each covered by a phase or explicitly excluded with a
    reason. Include test fixtures, E2E helpers and scripts that write the
    same data.
14. Identify independent work units within each phase: no file overlap or
    dependency on another unit's output. Mark those units `[batch-eligible]`
    for local worktree coordination, with one integration owner and no working
    branch push/PR creation. Keep phase execution and acceptance sequential.
15. Use at most three temporary [NEEDS CLARIFICATION] markers and resolve
    every one before final acceptance. Do not fill unknowns with placeholders.
16. Resolve every material decision before plan acceptance. A missing required
    investigation or reviewer result remains an explicit acceptance gap.
17. Apply the [durable handoff](references/handoff.md) contract in the plan/notes,
    naming accepted decisions, evidence limits and next-phase entry conditions.
    Revalidate actual worktree state on resume.

Save to docs/plans/YYYY-MM-DD-[description].md
Phase files: docs/plans/YYYY-MM-DD-[description]-phases/phase-N.md

No unresolved questions in the final plan. Present the saved plan and phase-file
paths, acceptance criteria and remaining decisions, then stop at the planning
boundary. Do not implement unless the user explicitly authorized that next workflow.

## Execution and acceptance

Use the scope and authorization already supplied in the request. Resolve routine
implementation choices from repository evidence. Complete authorized local work,
review, repair and applicable verification before its acceptance gate. An explicit
instruction can authorize continuation across phases; otherwise stop at the stated
phase boundary. Production, publication, destructive actions and new scope retain
their actual authorization requirements. Preserve durable artifacts before cleanup.
