---
name: "rpi-validate"
description: "Verify each implementation phase against its approved plan, deviation notes, actual changes and valid automated acceptance evidence."
argument-hint: "[request]"
---
The request is supplied as literal arguments: $ARGUMENTS


Validate the implementation against the plan.

When a parent uses a machine-readable assignment/acceptance record, follow the
[dispatch contract](references/dispatch.md) and validate it before claiming
complete coverage. The record is optional for a small parent-only task; required
review, TDD and phase acceptance still apply.

Process:
1. Locate the requested plan and phases (provided path or repository history).
   Read controlling instructions, the complete plan/current phase contracts and
   `docs/plans/<plan-name>-notes.md` when present. Cite recorded decisions and
   deviations rather than reconstructing intent from the diff.
2. Read the [durable handoff](references/handoff.md), then revalidate actual
   worktree/base/current state before reusing its evidence. Inspect changed code
   and tests to the required depth; unchanged complete prior reads remain usable.
   Validation stays within the requested phase scope.
3. Review independently of implementation. A narrow review may use one fresh
   reviewer; useful independent assignments state objective, permitted read-only
   actions/files, evidence/output, resource limits and completion condition. Use
   available slots and account for every required result. Missing or failed review
   is an acceptance gap, not approval.
4. For each requested phase:
   - Verify marked-complete items are actually done.
   - Run every applicable automated verification command, or reuse valid
     evidence when candidate inputs and check selection are unchanged.
   - Review test quality, not only test results. For each changed or added
     test, name the production change that would make it fail. Flag
     tautological, disjunctive, registration-only and over-broad assertions,
     mocks of owned code, and coverage exclusions that defend a threshold.
   - Think about edge cases.
5. Save `docs/agents/validation-report.md` with:
   - Implementation status per phase
   - Automated verification results
   - Code review findings (matches, deviations, issues), every confirmed finding's
     disposition and evidence-backed false-positive rejections
   - Missing review/coverage results and any unresolved architectural decision
   - Test-quality findings: assertions that cannot fail, owned-code mocks,
     threshold-defending exclusions, and any narrowed assertion's remaining invariant
   - Manual testing required (only if automation impossible — explain WHY)
   - Recommendations
6. Return findings to the authorized implementation owner for repair, simplify
   and re-verification. A validation-only request reports rather than silently
   editing product files. If this validation belongs to an implementation loop,
   continue that already-authorized loop until every actionable finding is resolved.
7. Apply the durable handoff contract in the report, including check/candidate
   identity and remaining acceptance gaps. Present the outcome and stop at the
   requested validation/phase boundary unless continuation is already authorized.

## Execution and acceptance

Use the scope and authorization already supplied in the request. Resolve routine
implementation choices from repository evidence. Complete authorized local work,
review, repair and applicable verification before its acceptance gate. An explicit
instruction can authorize continuation across phases; otherwise stop at the stated
phase boundary. Production, publication, destructive actions and new scope retain
their actual authorization requirements. Preserve durable artifacts before cleanup.

## Bundled contract tools

For a structured handoff, resolve `scripts/rpi-dispatch.py` relative to this
installed skill; its sibling `scripts/validate-findings.py` checks report IDs
and references. Follow [dispatch](references/dispatch.md) for invocation and
[durable handoff](references/handoff.md) for actual-state revalidation.
