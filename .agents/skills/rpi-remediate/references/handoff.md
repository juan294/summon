# Durable workflow handoff

Keep the handoff in the existing research, plan, phase or implementation artifact.
A small edit can use a compact paragraph; it does not need a separate document.
Preserve the artifact as project history under the repository's visibility and
commit policy before removing an operational worktree.

Record the information needed by a fresh session or the other harness:

- Objective and approved scope, including any authorized continuation or exact
  release version. Distinguish completed local work from external authorization.
- Base and current commit/branch, actual worktree path and candidate identity.
- Findings and their dispositions: resolved, rejected with evidence, explicitly
  accepted architectural exception, or unresolved blocker. Keep every finding ID.
- Decisions and invariants that explain the implementation and its boundaries.
- Completed checks, outcomes and the exact candidate/runtime they cover. Identify
  evidence invalidated by later changes and distinguish local from native checks.
- Deviations from the plan, their reasons, risks and unsupported integrations.
- The next phase or action and its remaining prerequisites or acceptance gate.

On resume, inspect the actual branch, worktree status, commit and relevant files.
Compare them with the recorded state before reusing checks or claiming completion.
An artifact describes prior observations; it cannot override newer repository
state, owner instructions or native permissions. Preserve unexpected local edits
and reconcile differences before dependent work.

Read controlling instructions and phase contracts completely. Retain source
locations and prior observations so that a new phase does not require rereading
every implementation file already understood. Inspect changed or uncertain code
to the depth needed for the current task.

For delegated work, record the assignment's objective, permitted actions/files,
evidence/output contract, resource constraints and completion condition. Keep
assignment results and missing coverage explicit. A failed helper is a gap to
resolve, never an implicitly successful review.
