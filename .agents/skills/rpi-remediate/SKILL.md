---
name: "rpi-remediate"
description: "Validate and resolve every actionable pre-launch finding in ordered local waves with TDD, finding disposition and preservation of strategic exceptions."
---

# Remediate Pre-Launch Findings

Resolve every confirmed actionable finding within the authorized remediation
scope. Record every finding locally, group related causes and ownership, complete
TDD repairs and independent review, integrate sequentially per wave, and verify
locally. Keep narrow work with the parent; delegate only useful independent work.
External issue publication requires authorization; local records preserve the
same evidence and dispositions.

## Input

If the request specifies report paths, use it as the report path or wave selector
(e.g., `wave=2` to resume at Wave 2). Otherwise, auto-detect the report
at `docs/agents/pre-launch-report.md`. If no report exists, suggest
running `rpi-pre-launch` first and **STOP.**

If `wave=N` is provided, load the prior approved plan/handoff and verify its
state before resuming Wave N. Apply the [durable handoff](references/handoff.md)
contract and revalidate actual worktree/base/current state and candidate/check
identity. A selector alone is not evidence of prior approval.

When a parent uses a machine-readable assignment/acceptance record, follow the
[dispatch contract](references/dispatch.md) and validate it before claiming
complete coverage. The record is optional for a small parent-only task; required
review, TDD and phase acceptance still apply.

## Step 1: Parse & Plan

Gather context before making any changes.

1. **Read the pre-launch report** completely. Resolve the bundled
   [finding validator](scripts/validate-findings.py) relative to this skill;
   never assume a Claude-only project script path.

   The report uses a 16-section format. Findings live in sections 4-11
   (Frontend, Backend, Performance, DevOps/SRE, Security, Architecture,
   QA, UX), plus §11a (Agent-Facing Surface) when that domain applies.
   Domain coverage is independent of how many investigators supplied it; a failed
   or absent investigator does not make a required domain inapplicable.
   Section 14 (Before/After/Later) is the wave-ordering index. Section 15
   (Open Questions) is not findings; preserve its unresolved decisions separately.

   **Validate the report contract first** (deterministic gate, before any
   parsing):

   ```bash
   python3 <resolved-skill-directory>/scripts/validate-findings.py <report-path>
   ```

   Exit 0 — findings satisfy the Output Contract; proceed. Non-zero — the
   report has malformed findings (bad Finding-ID, missing required field, or
   no `file:line`). **STOP** and report exactly which findings the validator
   named. Do not parse a broken report: the consumer regex below would
   silently drop the malformed ones, violating Rule #58 (100% coverage).

2. **Extract EVERY finding** — all 5 severity tiers: launch-blocker,
   high, medium, low, strategic. No filtering by severity — Rule #58
   100% coverage.

   Parser contract:

   - Findings are the `#### <Finding-ID> <Title>` blocks in §4-§11,
     plus §11a when present.
   - Finding ID regex: `(AR|FE|BE|PE|DO|SE|QA|UX|AS)-(B|H|M|L|S)[0-9]+`
     (machine-checked by `validate-findings.py` in step 1).
   - Each finding has structured fields (bold format:
     `**Severity:**`, `**Time horizon:**`, `**Evidence type:**`,
     `**Files:**`, `**What's happening:**`, `**Why it matters:**`,
     `**Recommendation:**`, `**Regression risk:**`,
     `**Expected impact:**`, `**Effort estimate:**`).
   - Parse every finding — never drop one.

3. **Group related findings into work units:**

   Grouping hierarchy:

   1. By time horizon first (Before → After → Later) using Section 14.
   2. Within each horizon: by likely root cause and overlapping file ownership.
   3. Within each work unit: by severity descending.

   One root cause may explain several findings or failing tests; retain every
   ID and regression obligation in that work unit. Severity and a "Later" horizon
   do not automatically exempt an actionable fix. Complete authorized work in
   order. Keep explicitly deferred waves and findings requiring a new architecture
   or scope decision as open local dispositions with rationale and next action;
   never describe a recorded follow-up as fixed.

4. **Detect the integration branch:**
   - Check shared AGENTS.md or git config for the documented integration branch.
   - Fall back to `git symbolic-ref refs/remotes/origin/HEAD`.

5. **Present the work plan** to the user, grouped by wave:

   **Wave 1: Before launch (must fix before release)**

   | # | Work Unit           | Domain   | Severity | Files Owned | Agent   |
   |---|---------------------|----------|----------|-------------|---------|

   **Wave 2: After launch (post-release sprint)**

   | # | Work Unit           | Domain   | Severity | Files Owned | Agent   |
   |---|---------------------|----------|----------|-------------|---------|

   **Wave 3: Later / strategic (fixes or explicit open dispositions)**

   | # | Finding ID | Title | Severity | Rationale       |
   |---|------------|-------|----------|-----------------|

   Total: N work units covering M findings across K files.
   Wave 1: X work units. Wave 2: Y work units. Wave 3: Z fixes/open dispositions.
   Integration branch: `<branch>`.

Present the concrete decomposition and proceed within the approved request.
Ask only for missing authorization or an unresolved architecture/scope decision.

## Step 2: Record Findings & Assign Work

Within the authorized remediation scope:

1. **Record every finding** in a local backlog, including Wave 3. Preserve IDs,
   evidence, files, recommendation, regression risk, expected impact, severity,
   horizon and effort. Record external issue URLs only if issue publication is
   explicitly authorized. Use structured text or a body file when publishing;
   inspect existing labels and avoid duplicates. Verify the Wave 3 backlog count
   matches its plan rows before launching any fix work. Every assignment stays
   within the current authorized wave; no finding disappears during grouping.

2. **Assign current-wave work** locally, keeping a narrow repair with the parent.
   Useful independent assignments have distinct file ownership and specify
   objective, permitted actions/files, evidence/output, resource constraints and
   completion condition. Use at most three simultaneous implementers; available
   slots and contention may require fewer. One integration owner accounts for every
   assignment and result. Complete the current wave before starting another.

   Each implementer follows these instructions:

   a. Read controlling instructions/contracts and the local finding records
      completely (and an authorized external issue when present). Inspect relevant
      source/test paths to the depth needed; reuse valid prior reads.

   b. **Verify the recommendation before implementing it.** The finding's
      Recommendation is a hypothesis, not an order. Before writing any code:

      - Read the **Regression risk** field. Independently confirm each
        assumption it states actually holds — trace the real code paths,
        don't take the finding's word. If the fix swaps mechanism X for
        mechanism Y, verify Y covers every input X handles (every locale
        source, every auth path, every caller), not just the one the
        finding names.
      - Identify the user-facing invariant the fix could break. Your
        failing test in step (c) must assert that invariant survives —
        not merely that the finding's symptom is gone. (Guard "the English
        cookie user still sees an English body," not only "ISR is
        restored.")
      - If verification shows the recommendation is incomplete, wrong, or
        trades away an invariant, stop that dependent change and return evidence
        to the integration owner. Evaluate a safe alternative within the approved
        scope; ask the user only if it needs a new architecture/scope decision.
        Preserve the open finding until a verified repair or explicit disposition
        resolves it.

   c. **TDD: Write a failing test FIRST** that captures the finding AND
      guards the invariant identified in step (b). For non-behavioral
      documentation, use appropriate document checks. Executable configuration
      or CI behavior still requires a failing regression oracle; explain any
      genuinely non-testable case.

   d. Implement the minimum fix to make the test pass.

   e. Run verification sequentially:

      Discover and run the project's applicable targeted tests, typechecks and
      lint sequentially, preserving every command's status.

   f. Obtain independent review of finding coverage, invariants and changes.
      Inspect every required reviewer result; missing/failed review blocks
      acceptance. Repair confirmed findings and record evidence when rejecting a
      false positive. The implementer cannot supply its only independent review.

   g. Run the native simplify pass or Codex simplify helper for reuse, quality and
      efficiency. Rerun checks invalidated by its changes; a parent-owned pass
      reports exact changed scope and invalidated evidence to the gate owner.

   h. Commit locally with a factual conventional message referencing finding
      IDs; include issue numbers only when an actual issue exists.

   i. Do NOT push. The orchestrator handles all pushes.

3. **Inspect every current-wave result.** Record pass/fail, tests, changed files
   and finding dispositions. Missing or failed assignments and reviewers are
   explicit coverage gaps. Reassign useful unfinished work or report the concrete
   blocker; silence never counts as approval. A rejected recommendation stays open
   until its safe alternative is verified or the unresolved architecture/scope
   decision receives an explicit disposition.

4. **Preserve later work.** Record unstarted waves and architectural decisions as
   open, with reasons and next actions. They are not fixed merely because they
   have local records. Run authorized actionable Wave 3 repairs through the same
   review and verification loop as earlier waves.

## Step 3: Integration & Verification

Run the full local integration and verification cycle once per wave. Complete
Wave 1 before starting Wave 2. All working branches remain local.

### Wave 1 Integration

1. Inspect independent review results for every work unit, then review changes,
   commits, finding coverage and test evidence. Missing review blocks integration
   acceptance; resolve every confirmed actionable finding in the current scope.
2. Integrate each completed local branch sequentially into the documented local
   integration branch. Run applicable checks after each integration and repair
   failures locally before the next merge. Record commit IDs against findings.
3. Run the harness-native simplify pass (or the Codex simplify helper), reviewing reuse, quality and efficiency on the integrated result and the complete applicable local
   gate, including tests, coverage, typechecks, lint, build and preflight.
4. Preserve the plan, handoff and evidence. No per-wave push, feature PR,
   deployment or hosted debugging loop occurs. After all authorized waves are
   complete, inspect triggers and publish only the completed integration branch
   once if authorized. Never create Vercel Previews. Production remains a
   separate explicitly authorized operation.
5. After an authorized push inspect every expected workflow for that commit;
   diagnose failures from existing logs and repair locally. Do not rerun or
   re-push as a debugging loop.

Present Wave 1 integration results and its durable handoff. **Stop at the wave
boundary** unless the user already authorized Wave 2 continuation; otherwise
record how to resume with `rpi-remediate` and the `wave=2` selector.

### Wave 2 Integration

When Wave 2 continuation is authorized:

1. **Assign Wave 2 work** using the bounded current-wave contract from Step 2;
   keep it with the parent when delegation adds no value.
2. **Monitor Wave 2 agent progress** (same pattern as Wave 1 step 3).
3. **Complete the same local integration cycle as Wave 1**, including independent
   review, repair, simplify and the complete Wave 2 verification gate.

Present Wave 2 completion and preserve all Wave 3 findings. If Wave 3 actionable
work is authorized, use the same bounded implementation, independent review,
simplify and complete local verification cycle before its acceptance report.
Document explicitly deferred waves and unresolved architectural decisions with
rationale; stop after all authorized work.

## Step 4: Cleanup

For each wave, confirm ownership, preservation of changes and all artifacts
(including ignored/untracked plans, handoffs and evidence), and local integration
before removing its worktree. Use the git-workflow skill's preservation checks.

```bash
git worktree list --porcelain
git -C /absolute/path/to/worktree status --short --untracked-files=all
git -C /absolute/path/to/worktree ls-files --others --ignored --exclude-standard
git merge-base --is-ancestor remediate/<slug> <integration-branch>
# Only after ownership, preservation and integration are established:
git worktree remove /absolute/path/to/worktree && git branch -d remediate/<slug>
```

If any check fails or cleanup refuses, retain the branch/worktree and record why.
Other tasks' worktrees and branches must survive. No remote deletion is needed
because remediation branches were never published. Deferred work needs no worktree.

## Step 5: Report

Generate a remediation report at `docs/agents/remediation-report.md`:

```markdown
# Remediation Report
> Generated on [date] | Branch: `[branch]` | [N] findings processed
>
> Pre-launch report: `[report-path]`

## Summary
- Findings processed: [N] (Wave 1: X, Wave 2: Y, Wave 3: Z)
- Local findings recorded: [N]
- Findings resolved (integrated): [N] (Wave 1: X, Wave 2: Y, Wave 3: Z)
- Open follow-ups (not fixed): [Z] (explicit deferral or new decision required)
- Halted (recommendation unsafe, alternative or decision pending): [N]
- Tests added: [N]
- Files modified: [N]
- Local gate status: PASSING / FAILING
- Remote status: NOT PUBLISHED / PENDING / PASSING / FAILING

## Wave 1: Before launch (must-fix)
| # | Finding ID | Title | Severity | Tests Added | Commit | Status |
|---|------------|-------|----------|-------------|----|--------|

## Wave 2: After launch
| # | Finding ID | Title | Severity | Tests Added | Commit | Status |
|---|------------|-------|----------|-------------|----|--------|

## Wave 3: Later / strategic (resolved or explicitly open)
| # | Finding ID | Title | Severity | Status | Evidence/Record | Rationale |
|---|------------|-------|----------|--------|-----------------|-----------|

## Final Verification
- [ ] Wave 1 integrated locally, full local gate green
- [ ] Wave 2 integrated locally, full local gate green (or explicitly deferred)
- [ ] Wave 3 authorized fixes verified; explicit open dispositions preserved
- [ ] simplify final pass complete for waves that ran
- [ ] Owned worktrees safely removed or retention reasons recorded

## Deferred Items (if any)
[Waves the user chose to defer with timeline]
```

Apply the durable handoff contract in the report, including base/current state,
check/candidate identity, every finding's disposition, deviations, risks and next
entry conditions. Present the summary to the user.

## Rules

- **Complete finding coverage.** Process every finding in all five severity tiers.
  Resolve every confirmed actionable fix within authorized scope. Record evidence
  for false positives and explicit reasons/next actions for deferred waves or new
  architectural decisions. No severity tier is an automatic exemption.
- **Wave ordering.** Process Waves in order: 1 → 2 → 3. Never
  interleave waves.
- **Per-wave verification.** Each wave goes through the full merge →
  verify → full local gate cycle before the next wave begins.
- **User can defer waves.** After any wave, user may ship and schedule
  the next wave separately. Pass `wave=N` in the request to resume.
- **TDD mandatory.** Each agent writes a failing test before
  implementing. The exception is non-behavioral documentation or a genuinely non-testable
  change with a recorded verification rationale; executable CI/configuration
  behavior still requires a regression oracle.
- **Recommendation is a hypothesis.** Verify the finding's assumptions in
  real code before implementing (worktree step b). The guard test asserts
  the invariant the fix could break, not just the finding's symptom. A
  recommendation that fails verification or trades away a correctness,
  security, or UX invariant halts its dependent edit. Return evidence to the
  integration owner; a safe in-scope correction needs no repeated approval, while
  an unresolved architecture/scope decision does.
- **Agents do NOT push** (Central Commit Rule). Only the orchestrator
  may publish the completed integration branch once. Worktree agents commit
  locally; the orchestrator integrates and verifies locally.
- **Sequential merges.** Integrate local branches one at a time and test after each.
- **File ownership enforced.** Two agents must never modify the same
  file. If findings overlap files, group them into one work unit.
- **Branch verification before every commit.** Run
  `git branch --show-current` and verify the result (Error #33).
- **simplify scope.** Review each completed work unit and the integrated result
  per wave. Reuse unchanged scope's valid evidence; report changed files and
  invalidated checks to the verification owner.
- **CI accountability.** Inspect every expected workflow after an authorized
  integration push. Diagnose and repair failures locally; no rerun/re-push loop.
- **Clean exit.** Preserve every artifact before removing owned worktrees;
  retain anything whose ownership or integration cannot be established.
- **Never weaken a test.** If a test fails after merge, fix the source
  code, not the test.
- **No working-branch PRs.** All remediation branches remain local.
- Run verification commands sequentially, never as parallel Bash calls.

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
