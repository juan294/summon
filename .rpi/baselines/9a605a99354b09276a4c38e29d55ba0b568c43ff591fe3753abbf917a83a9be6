---
name: "rpi-describe-pr"
description: "Draft a reviewable change description from the complete local diff, commit history and valid verification evidence; publish text only when explicitly authorized."
argument-hint: "[request]"
---
The request is supplied as literal arguments: $ARGUMENTS


Generate a PR description for the current branch.

Process:
1. Identify the requested existing PR or local change; an unpublished local
   branch does not require creating a PR.
2. Read controlling project instructions and the requested review template.
   Revalidate base/current refs and actual worktree changes; get the complete
   diff, relevant commit history and metadata for that scope.
3. Analyze changes thoroughly — user-facing vs internal, breaking changes.
4. Use valid existing verification evidence for unchanged tested inputs; run
   missing applicable checks and label pass/fail/untested accurately.
5. Lead the description with the concrete problem and resulting behavior, then
   explain relevant changes, verification evidence and material limits. Apply the
   [durable handoff](references/handoff.md) contract using existing plan/review
   artifacts; do not treat a stale summary as proof of the current candidate.
6. Save the description locally. Update an existing external PR only when
   explicitly authorized; use structured text or a body file for multiline text.

## Execution and acceptance

Use the scope and authorization already supplied in the request. Resolve routine
implementation choices from repository evidence. Complete authorized local work,
review, repair and applicable verification before its acceptance gate. An explicit
instruction can authorize continuation across phases; otherwise stop at the stated
phase boundary. Production, publication, destructive actions and new scope retain
their actual authorization requirements. Preserve durable artifacts before cleanup.
