---
name: "rpi-fix-ci"
description: "Diagnose existing CI failures and repair their root causes locally with regression evidence and complete verification before any authorized publication."
argument-hint: "[request]"
disable-model-invocation: true
---
The request is supplied as literal arguments: $ARGUMENTS


# Repair Existing CI Failures

Use the failed run/candidate and authorized repair scope in the request. Read
controlling instructions, test contracts and the [durable handoff](references/handoff.md)
completely. Revalidate the actual worktree, branch and failed commit before reusing
prior diagnoses or check results. Keep repairs in an owned local branch/worktree.

## Process

1. Identify the exact failed run and candidate. Inspect existing runs with
   `gh run list --branch <branch> --commit <sha> --json databaseId,headSha,conclusion,status,name`.
   Missing or pending checks are not passes. If there is no failure, report and stop.
2. Read existing failure logs with `gh run view <run-id> --log-failed`. Locate the
   failed command and enough surrounding output to explain it; a truncated tail
   alone may omit the cause. Do not rerun hosted jobs to collect evidence.
3. Inventory test, typecheck, lint and build failures, then group them by likely
   root cause and affected file ownership. One cause breaking many tests is one
   investigation, with every affected test retained in its verification scope.
4. Keep narrow repairs with the parent. Delegate useful independent local work
   only within the current authorized phase. Each assignment states objective,
   permitted actions/files, evidence/output, resource constraints and completion
   condition. Keep at most three simultaneous implementers; available slots and
   tool contention may require fewer. One integration owner inspects every result;
   a missing or failed assignment remains an explicit unresolved gap.
5. Reproduce each cause locally. Read the failing test and relevant implementation
   to the depth needed; reuse valid prior reads. For behavioral defects, first
   confirm an existing regression fails or write and run a failing regression that
   captures the invariant, then make the minimum correct fix. Executable CI/config
   behavior needs a regression oracle too. Never weaken or delete a valid test to
   obtain a pass. Use appropriate deterministic checks for non-behavioral edits.
6. Run targeted checks sequentially after each fix. Preserve every command's
   status. A flaky failure remains unresolved until evidence explains it; a local
   pass alone cannot erase the reported CI failure.
7. Obtain independent review of cause, changes, regression coverage and all known
   failure dispositions. Inspect every required reviewer result; missing review
   blocks acceptance. Repair confirmed findings, record false-positive evidence
   and surface only unresolved architecture/new-scope decisions for a new decision.
8. Run the native simplify pass or Codex simplify helper on changed files, then
   the complete local CI-equivalent gate, including applicable tests, coverage,
   typechecks, lint and build. Sequence resource-intensive checks and preserve all
   exits. Repeat diagnosis for new failures while meaningful local progress is
   possible; if an external dependency or new decision blocks progress, report the
   concrete unresolved cause and next action instead of claiming completion.
9. Save the durable handoff with every failure's disposition, changed scope and
   exact check/candidate identity. Commit with a factual conventional message and
   integrate the completed verified change locally. Verify branch identity first.
   Inspect hosted triggers before any single authorized integration push; never
   create Previews, publish working branches, rerun hosted jobs or use a fix-and-
   repush debugging loop. Production publication needs its own explicit authority.

Complete implement -> independent review -> repair -> simplify -> verify within
the authorized phase, then stop for its required acceptance unless continuation
was already supplied. Preserve unresolved diagnostics and all owned artifacts
before worktree cleanup. A local repair does not make an earlier remote run green.
