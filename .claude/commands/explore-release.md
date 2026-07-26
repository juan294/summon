# Exploratory Release Charters

Model tier: **opus** — Opus session for the orchestrator. Charter agents run as
parallel `general-purpose` background Tasks; tier them by cost (sonnet is usually
sufficient for a single charter's execution).

Independent, fresh-context exploratory testing of a fixed release candidate. This
is **Wave B** of the E2E Pro release-verification system
(`templates/e2e-pro-playbook-template.md`) — the cheap, high-yield layer that
targets interaction and recovery failures deterministic suites miss.

It complements, and does not replace:

- **`/pre-launch` + `/remediate`** — static, code-as-written audit. Charters
  exercise the *deployed candidate's behavior* instead.
- **`/release`** — the tagging authority. Charters feed evidence into the release
  gate; they never tag.

Read `templates/e2e-pro-playbook-template.md` Section 6 (Wave B) for the full
decision detail. This command is the executable protocol.

## Input

```text
/explore-release <LAST_RELEASE_REF> <CANDIDATE_SHA_OR_DIGEST>
```

If arguments are omitted, infer `<LAST_RELEASE_REF>` from the last release tag and
`<CANDIDATE_SHA>` from the fixed candidate under release. Confirm both with the
user before spawning agents — a charter run against the wrong candidate is wasted.

## Step 1: Fix the candidate and read the diff

1. Confirm the candidate is immutable (a specific SHA, tag, or artifact digest),
   not a moving branch. Stop if it is mutable (playbook D06).
2. Compute the change surface:

   ```bash
   git log --oneline <LAST_RELEASE_REF>..<CANDIDATE_SHA>
   git diff --stat <LAST_RELEASE_REF>..<CANDIDATE_SHA>
   ```

3. Map changed paths to user-facing capabilities, actors, surfaces, states, and
   external seams. Do not trust stale docs — inspect the actual routes, jobs, and
   providers touched.

## Step 2: Generate charters

Size the charter set to the diff — **do not pad the count**:

- tiny, isolated diff → 1 charter;
- normal release → 2–4 charters;
- more only for distinct high-risk capability groups.

Prioritize: outward writes, new/changed state transitions, vendor or retry
behavior, authorization boundaries, changed copy that promises an outcome, new
multi-surface flows, and recent escape classes.

Each charter names: changed capability, affected actors/roles, affected surfaces,
relevant states, external seams, primary risk hypothesis, and the authorized
environments and operations.

## Step 3: Execute each charter in a fresh context

Spawn one background Task per charter (`subagent_type: general-purpose`). Each
agent MUST be a fresh context that:

- did **not** implement the change;
- receives the candidate, its charter, the safety contract, and the report format
  — but not the implementer's untested assumptions as facts;
- works independently from the other charter agents;
- reports findings without fixing them mid-charter.

Every charter attempts all eight maneuvers, in risk-first order, and reports each
as `PASS` (with evidence), `FAIL` (with reproduction + evidence), or `N/A` (with a
concrete reason). **Omitting a row invalidates the charter.**

| # | Maneuver | Intent |
|---:|---|---|
| 1 | Try the action twice | Double-submit, repeat, duplicate, idempotency failures. |
| 2 | Edit after every error | Error recovery, stale-state clearing, successful resubmission. |
| 3 | Interrupt mid-flow | Back, refresh, close/reopen, resume, timeout, reconnect. |
| 4 | Use a second session or role | Stale authz, propagation, isolation, concurrency errors. |
| 5 | Switch locale and viewport/device | Formatting, truncation, direction, responsive, state-transfer failures. |
| 6 | Compare copy with outcome | Messages, labels, and promises match actual behavior. |
| 7 | Read back downstream state | Authorized HTTP, datastore, storage, event, or telemetry evidence. |
| 8 | Ask "should this exist?" | Challenge unsafe, contradictory, confusing, impossible behavior. |

For non-visual systems, adapt maneuver 5 to the relevant execution context (OS,
API version, shell, network condition, client SDK, tenant config, input encoding).

Default timebox: **30 minutes** per charter. A timebox does not turn an untested
high-risk area into a pass — agents report where time expired.

## Step 4: Safety contract (non-negotiable)

Charter agents MUST:

- use synthetic, run-scoped fixtures (`<PROJECT_FIXTURE_PREFIX>-<RUN_ID>`);
- operate only within the charter's authorization;
- never touch real user data;
- never trigger live charges, email, messages, destructive mutations, or hardware
  actions without explicit authorization (playbook D20);
- clean up only their own fixtures and prove zero unexpected residue;
- observe and report — never opportunistically change production or code.

## Step 5: Report and gate

Each agent returns an **Exploratory Charter report** (playbook Section 9). The
orchestrator collects them and applies the block rule.

The release is **BLOCKED** when any of the following hold:

- any charter reports a FAIL;
- a high-risk maneuver or area was skipped;
- cleanup evidence is missing;
- a finding lacks triage;
- an accepted exception is not recorded before tagging.

Present a consolidated summary: per-charter decision, all findings with severity
and reproduction, skipped high-risk areas, and fixture/cleanup evidence. Every
finding gets tracked (file an issue) — do not silently drop low-severity ones.

Do not tag or release from this command. Hand the evidence to `/release`, which
gates on it.

## Rules for this process

- Fixed, immutable candidate only.
- Fresh contexts only — the implementer does not review their own change here.
- All eight maneuver rows, every charter, or the charter is invalid.
- Synthetic run-scoped fixtures; clean up only what you created.
- Findings are reported, not fixed, during the charter.
