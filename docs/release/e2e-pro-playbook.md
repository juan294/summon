# E2E Pro Release Verification Playbook — summon

> Adapted from cc-rpi template version 1.0 (upstream `9b6aa4a`) on 2026-07-28.
> Seeded byte-identical in commit `1e42539`, then adapted; see
> `docs/plans/2026-07-28-e2e-pro-release-verification.md`.
>
> Audience: maintainers and agents reasoning about summon's release-verification
> architecture.

**This is the architecture and decision document, not the procedure.** The
day-to-day release procedure is `docs/release/release-checklist.md`, which is
kept under 200 lines per D02. This file explains *why* the gate is shaped the
way it is; the checklist says what to run.

Waves A and B are implemented. Waves C-H are dispositioned with reasons in
Section 6 — read those before proposing to build any of them.

## Where This Fits in cc-rpi

E2E Pro is the release-**verification** layer. It answers "did every required check actually run
and pass against the exact artifact we are about to tag?" It does **not** replace the release
machinery cc-rpi already ships — it plugs an evidence gate in front of the tag step and delegates
to the existing commands:

- **`/release`** stays the single tagging and versioning authority. E2E Pro's release procedure
  (Section 8) delegates the actual tag/publish step to `/release`; it does not restate a
  divergent tag process. This is decision D01 applied to cc-rpi itself.
- **`/pre-launch` + `/remediate`** remain the static code-quality audit. They inspect the code as
  written; E2E Pro's exploratory charters (Wave B) exercise the *deployed candidate's behavior*.
  The two are complementary, not duplicates.
- **`methodology/testing.md`** defines the automated-over-manual hierarchy. E2E Pro's oracle model
  (Section 7) is a superset for release evidence; follow testing.md for everyday test design.
- The machine-readable requiredness contract and fail-closed analyzer (Wave A2) are the same
  pattern as cc-rpi's contract layer (`validate-findings.py`, `verify-edit.sh`, the
  `BLOCKED/WHY/FIX` convention). Reuse that convention and its telemetry rather than inventing a
  second gate style.
- **`/explore-release`** (blueprint command) runs Wave B charters.

### Adoption scaling: Wave A is the floor, C–H are by risk

Do not cargo-cult the full program into a small project. The mandatory floor for **every** project
is **Wave A** — a release gate that cannot lie (zero-pass fails, required skip/fail blocks,
candidate identity is fixed, tag is last). It is cheap and mechanical.

Waves C–H (capability registry, combination engine, plan compiler, staging fidelity, model-based
tests, TTL automation) are structural and expensive. Adopt them **by project risk**, not by
default. Use the MUST/SHOULD/MAY language below and the "delete inapplicable sections and record
why" rule to right-size each adoption.

## Adoption status

This copy is adapted, not a blank template. Remaining `<PLACEHOLDER>` tokens
appear only inside the report templates of Sections 7, 9, 13 and 14, where they
are filled per release rather than once.

Delivered artifacts:

```text
docs/release/release-checklist.md         procedural authority (D01/D02)
docs/release/evidence/schema.md           evidence manifest schema v1
docs/release/evidence/cadence.json        the one TTL obligation
docs/release/charters/                    exploratory charter reports
scripts/release/analyzer.mjs              the invariant, as pure logic
scripts/release/analyze-release.mjs       the gate (BLOCKED/WHY/FIX, exit 1)
scripts/release/build-manifest.mjs        vitest JSON -> evidence manifest
scripts/release/validate-charter.mjs      maneuver-completeness enforcement
src/release/probes.test.ts                8 release-required probes
src/release/no-skip.test.ts               bans the skip that caused the bug
src/release/rehearsal.test.ts             2 positive + 10 blocking rehearsals
.claude/commands/explore-release.md       Wave B protocol, wired in
```

Hard invariants were kept intact; commands, paths, tiers, and wave scope were
adapted. The evidence standard was not weakened.

Suggested destination:

```text
docs/plans/e2e-pro-implementation.md
```

Suggested durable artifacts after implementation:

```text
docs/release/release-playbook.md
docs/runbooks/
quality/capabilities.yaml
quality/scenarios/
quality/constraints.yaml
quality/cadence.yaml
quality/evidence/
scripts/quality/compile-release-plan
scripts/quality/analyze-release-run
<AGENT_COMMAND_DIRECTORY>/explore-release.md
```

Paths are illustrative. Use the target repository's conventions.

---

## 1. Purpose

E2E Pro is a release-verification system that turns operational knowledge into executable,
auditable evidence.

It must answer five questions for every release:

1. What changed?
2. Which capabilities and risk interactions could that change affect?
3. Which checks were therefore required?
4. Did every required check actually run and pass against the intended artifact?
5. Is the evidence complete enough to authorize tagging or release?

The goal is not merely a larger E2E suite. The goal is dependable release judgment across:

- deterministic automated tests;
- integration boundaries and real vendor seams;
- state transitions and failure recovery;
- dangerous combinations of otherwise-working features;
- independent exploratory testing;
- deployment, data, and observability readbacks;
- manual or hardware-only scenarios with enforceable cadence.

## 2. The Core Diagnosis

An operational playbook can contain excellent institutional memory and still be an unreliable
quality system.

The failure mode is usually structural:

- prose says what should happen, but nothing proves it happened;
- a green report can hide that everything important skipped;
- feature-by-feature coverage misses interactions between features;
- tests inherit the implementer's assumptions;
- UI success is treated as proof while persistence, events, storage, or vendors disagree;
- manual checks are listed without an owner, timestamp, expiry, or blocking rule;
- release commands drift away from the authoritative procedure;
- tagging occurs before the evidence is complete;
- production becomes the first environment where the full integration is exercised.

E2E Pro converts those weaknesses into mechanical contracts.

### Illustrative first-pass state

A realistic first hardening pass — the mechanical gates a project should reach before it calls
itself E2E Pro — looks like this:

- release instructions reconciled around one source of truth, one merge semantics, and tag-last
  ordering;
- zero-pass reports made mechanically impossible;
- a small `@release-required` baseline (chosen from the project's own critical paths) connected to
  CI, with required skips and failures blocking production reports even when quarantined;
- contradictory operational documentation corrected.

The structural layers that follow — the capability registry, release-plan compiler, constrained
combination engine, representative staging, model-based harnesses, and TTL enforcement — are the
remaining program, not the entry price.

Copy the decisions, not any particular probe count or capability name. Each project's required
baseline must be chosen from its own critical paths and be runnable from day one.

## 3. Normative Language

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are requirements:

- **MUST / MUST NOT**: release-safety invariant; do not weaken during adaptation.
- **SHOULD**: default design; deviation needs a documented reason.
- **MAY**: optional based on the target system.

## 4. Current Decision Ledger

These decisions are the agreed baseline for all adaptations.

| ID | Decision |
|---|---|
| D01 | The release playbook is the single procedural source of truth. Commands and agent prompts delegate to it rather than restating a divergent process. |
| D02 | The procedural playbook stays short—target 200 lines or fewer—and contains ordering, authorization gates, commands, rollback, and links. Feature detail belongs in runbooks and registries. |
| D03 | A run with zero passing checks MUST fail. "0 passed, N skipped" is never a pass. |
| D04 | A release-required check that fails or skips MUST block the release. Quarantine does not excuse a required miss. |
| D05 | Requiredness is machine-readable, not inferred from prose or test names. |
| D06 | The candidate artifact or commit is fixed before release evidence is collected. Evidence MUST identify the exact candidate. |
| D07 | The release tag is created only after every mechanically required obligation has passed and all other automated probes, exploratory findings, manual arcs, evidence checks, and production checks have passed or received an authorized, recorded exception. Required misses are not excepted at report time. |
| D08 | Deterministic tests are the reproducible go/no-go foundation. Exploratory agents complement them; they do not replace them. |
| D09 | Exploratory release charters run in fresh contexts, separate from the implementation agents, to reduce shared-assumption blindness. |
| D10 | Every exploratory charter uses the same high-yield maneuver set and reports every maneuver as PASS, FAIL, or N/A with a reason. Silent omission is forbidden. |
| D11 | Ordinary parameter space uses constrained pairwise coverage. Known-dangerous interactions receive explicit three-way scenarios. |
| D12 | Capabilities are registered in a machine-readable inventory with implementation-independent invariants, transitions, factors, oracles, environment tiers, and cadence. |
| D13 | Each release receives a generated execution plan derived from the diff between the last release and the fixed candidate. |
| D14 | Evidence is multi-layered. UI behavior alone is insufficient when HTTP, datastore, object storage, events, vendors, telemetry, or cleanup can contradict it. |
| D15 | Local vendor stubs and real-vendor probes are complementary: response-shaped permanent stubs provide deterministic fault legs; cost-bounded scheduled probes validate the real seam. |
| D16 | Manual, device, rotation, and hardware arcs have a last-run timestamp and TTL. An overdue critical arc blocks release. |
| D17 | High-risk domains SHOULD gain model-based or state-machine tests, particularly access control, lifecycle state, entitlements, media, notifications, retries, and consolidation flows. |
| D18 | If staging cannot exercise the real integration, the gap is explicit. A deliberately disabled staging seam MUST NOT be represented as full-integration coverage. |
| D19 | Test data is synthetic, run-scoped, identifiable, and cleaned up with residue evidence. Agents MUST NOT touch real user data. |
| D20 | Production-affecting or outward-facing actions—live charges, email, messages, destructive writes, hardware actions—require the repository's explicit authorization boundary. |

### Agreed sequencing

When delivery time is constrained:

1. Land the immediate mechanical gates first: zero-pass failure, release-required enforcement,
   one release source of truth, fixed-candidate evidence, and tag-last ordering.
2. Add fresh-context exploratory charters early. They are inexpensive and specifically target
   the behavior gaps that deterministic suites commonly miss.
3. Build the capability registry, plan compiler, constrained-combination engine, staging
   improvements, model-based harnesses, and TTL automation as the structural program.

Deadline pressure may change when the structural layers land. It does not justify removing the
immediate gates.

---

## 5. Project Adaptation Profile

Verified against repository evidence on 2026-07-28. Research:
`docs/research/2026-07-28-e2e-pro-release-verification.md`.

| Area | Project value |
|---|---|
| Project | summon (npm `summon-ws`) |
| Repository visibility | public |
| Primary product type | CLI, macOS only |
| Package/build system | pnpm 10.29.2, tsup, TypeScript 6 |
| Integration branch | `develop` (repo default) |
| Production branch | `main` |
| Merge strategy | merge commit for `develop` -> `main`; feature PRs may still squash |
| Release artifact | npm tarball `summon-ws-<version>.tgz` |
| Deployment provider | npm registry (no hosting provider) |
| Local test target | Node >=20.19 on macOS |
| Preview target | NONE -- no preview infrastructure exists |
| Staging target | NONE |
| Production target | npm `latest` dist-tag plus end-user Macs |
| Test runner(s) | Vitest 4 |
| Unit command | `pnpm test` |
| Integration command | NONE distinct -- all suites are unit-level, `child_process` mocked |
| E2E command | `pnpm test:e2e` (advisory) and `pnpm test:release` (the gate) |
| Typecheck / Lint / Build | `pnpm typecheck` / `pnpm lint` / `pnpm build` |
| Release-report command | `pnpm release:manifest` then `pnpm analyze:release` |
| Primary datastore | NONE -- flat files under `~/.config/summon/` |
| Object storage / Queue / Auth / Payments / Email | NONE |
| Other external vendors | Ghostty.app, osascript/System Events, macOS TCC, git, starship, brew/npm |
| Observability | NONE -- no telemetry, error tracking, or crash reporting |
| Hardware/real-device surfaces | the maintainer's Mac: GUI session plus a TCC Accessibility grant |
| Agent command directory | `.claude/commands/` |
| Capability registry owner | maintainer (sole) |
| Release approver | maintainer |
| Rollback authority | maintainer |

### Environment truth table

Do not infer an environment's fidelity from its name. summon's ceiling is low,
and that is the central constraint on this whole adoption.

| Environment | Exact artifact? | Real auth? | Real datastore? | Real vendors? | Safe writes? | Main limitations |
|---|---:|---:|---:|---:|---:|---|
| Local (dev Mac) | YES | N/A | N/A | YES | YES | the only place the product runs end to end |
| CI ubuntu (`checks`, `test`, `Release probes`) | source, not tarball | N/A | N/A | NO | YES | `child_process` mocked in unit tests; the package cannot even be installed (`EBADPLATFORM`) |
| CI macOS (`e2e-applescript`) | source | N/A | N/A | NO | YES | Ghostty installs, dictionary stays unreachable; advisory only |
| Preview | N/A | N/A | N/A | N/A | N/A | does not exist |
| Staging | N/A | N/A | N/A | N/A | N/A | does not exist |
| Production (npm + user Macs) | YES | N/A | N/A | YES | NO | publish is irreversible; no telemetry, so failures are invisible unless a user reports them |

**OPEN RELEASE RISK -- production is the first and only full-integration
environment.** Three independent blockers make a real Ghostty launch impossible
in hosted CI, each individually sufficient:

1. macOS TCC Accessibility cannot be granted non-interactively -- no CLI, no
   plist, no env var (`src/utils.ts:165-176`).
2. There is no GUI session; Ghostty must be running and windowable, and the
   script drives it via System Events keystrokes (`src/script.ts:349`).
3. The AppleScript dictionary is not resolvable after `brew install --cask
   ghostty` on a headless runner (empirically confirmed).

The mitigation is the TTL-bound manual arc `ghostty.real-launch`
(`docs/release/evidence/cadence.json`), which blocks the release when overdue.
This gap is recorded rather than papered over, per D18.


## 6. Implementation Waves

### Wave A — Make the Existing Release Gate Truthful

This wave is mandatory before calling the system E2E Pro. In cc-rpi terms, Wave A is the floor
every project adopts; Waves C–H are adopted by project risk.

#### A1. Reconcile all release instructions

Inventory:

- the main release playbook;
- slash commands and agent prompts;
- CI/CD workflows;
- package scripts and shell scripts;
- branch-protection and deployment rules;
- release issue templates;
- rollback instructions;
- documentation that describes release sequencing.

For each duplicated instruction, either:

- delete it and link to the source of truth; or
- generate it from the source of truth.

Search specifically for stale:

- merge strategy;
- branch names;
- environment names;
- approval pauses;
- feature gates;
- test commands;
- deployment commands;
- tag timing;
- rollback targets.

#### A2. Enforce a non-empty pass

The release analyzer MUST implement this invariant:

```text
passed_count > 0
```

Reference logic:

```text
required_misses =
  results where result.required is true and result.status is not "passed"

blocking_failures =
  results where result.status is "failed" and result is not an authorized non-required exception

release_ok =
  passed_count > 0
  and blocking_failures is empty
  and required_misses is empty
```

Required regression cases:

| Case | Expected |
|---|---|
| At least one pass, no blocking failures, no required misses | PASS |
| Zero pass, all skipped | FAIL |
| Required test skipped | FAIL |
| Required test failed but quarantined | FAIL |
| Optional test skipped with valid reason and expiry | Policy-defined, never silently PASS |
| Optional test failed | Follow the project's explicit exception policy |

#### A3. Establish the initial required probe set

Mark checks as release-required using test metadata such as:

```text
@release-required
```

or a framework-native equivalent.

Choose the initial set by risk, not by convenience. It SHOULD cover:

- deployed candidate identity or version;
- public and authenticated health;
- one critical read path;
- one critical state-changing path;
- authorization denial for a protected action;
- persistence or datastore readback;
- cleanup or rollback of synthetic data;
- the most important external integration seam;
- the highest-risk regression from recent production history.

Every required probe MUST:

- be selectable by the release runner;
- execute in at least one declared release environment;
- produce evidence tied to the candidate;
- fail closed when its prerequisites are absent;
- have a named owner.

#### A4. Fix release ordering

The release flow MUST:

1. identify the candidate;
2. run pre-deployment gates;
3. deploy or promote that candidate;
4. verify the deployed identity;
5. run environment-appropriate required probes;
6. run exploratory and manual obligations;
7. check evidence completeness;
8. obtain any required approval;
9. create and push the release tag.

Tagging before steps 1–8 is forbidden. In cc-rpi, steps 8–9 are performed by `/release` — this
playbook feeds it a complete, verified evidence set; it does not re-implement tagging.

### Wave B — Add Independent Exploratory Release Charters

Exploratory testing targets unknown and interaction failures that scripted assertions do not yet
encode. In cc-rpi, this wave is executed by the `/explore-release` command.

#### B1. Charter generation

Generate charters from:

```text
<LAST_RELEASE_REF>..<CANDIDATE_SHA>
```

Create:

- one charter for a tiny, isolated diff;
- two to four charters for a normal release;
- more only when justified by distinct high-risk capability groups.

Do not pad the count. Each charter names:

- changed capability;
- affected actors or roles;
- affected surfaces;
- relevant states;
- external seams;
- primary risk hypothesis;
- authorized environments and operations.

Prioritize:

- outward writes;
- new or changed state transitions;
- vendor or retry behavior;
- authorization boundaries;
- changed copy that promises an outcome;
- new multi-surface flows;
- recent escape classes.

#### B2. Fresh-context execution

Each charter MUST be executed by a fresh agent context that:

- did not implement the change;
- receives the candidate, charter, safety boundaries, and evidence format;
- does not receive the implementer's untested assumptions as facts;
- works independently from other charter agents;
- reports findings without fixing them during the charter.

#### B3. Mandatory maneuver table

Every charter attempts all eight maneuvers in risk-first order:

| # | Maneuver | Required intent |
|---:|---|---|
| 1 | Try the action twice | Find double-submit, repeat, duplicate, and idempotency failures. |
| 2 | Edit after every error | Verify error recovery, stale state clearing, and successful resubmission. |
| 3 | Interrupt mid-flow | Use back, refresh, close/reopen, resume, timeout, or reconnect as applicable. |
| 4 | Use a second session or role | Find stale authorization, propagation, isolation, and concurrency errors. |
| 5 | Switch locale and viewport/device | Find formatting, truncation, direction, responsive, and state-transfer failures. |
| 6 | Compare copy with outcome | Verify that messages, labels, and promises match actual behavior. |
| 7 | Read back downstream state | Inspect authorized HTTP, datastore, storage, event, or telemetry evidence. |
| 8 | Ask "should this exist?" | Challenge unsafe, contradictory, confusing, or impossible product behavior. |

For non-visual systems, adapt "viewport/device" to the relevant execution context, such as:

- OS or architecture;
- API version;
- shell;
- network condition;
- client SDK;
- tenant configuration;
- input encoding.

Each row MUST be reported as:

- `PASS` with evidence;
- `FAIL` with reproduction and evidence; or
- `N/A` with a concrete reason.

Omitted rows invalidate the charter.

#### B4. Timebox and stopping rules

Default timebox:

```text
<DEFAULT_CHARTER_MINUTES, recommended 30>
```

Agents work in highest-yield order and report where time expired. A timebox does not turn an
untested high-risk area into a pass.

The release is blocked when:

- any charter reports a failure;
- a high-risk maneuver or area was skipped;
- cleanup evidence is missing;
- a finding lacks triage;
- an accepted exception is not recorded before tagging.

#### B5. Safety contract

Exploratory agents MUST:

- use synthetic, run-scoped fixtures named `summon-rel-<RUN_ID>-<n>`, matching
  `src/release/helpers.ts` and `.claude/commands/explore-release.md`;
- operate only within the charter's authorization;
- avoid real user data;
- avoid live charges, email, messages, destructive mutations, or hardware actions without
  explicit authorization;
- clean up only their own fixtures;
- record fixture identifiers and prove zero unexpected residue;
- observe and report findings rather than opportunistically changing production or code.

### Waves C-H — scoped out, with reasons

Template rule 3: *delete sections that are genuinely inapplicable and record why
they are inapplicable.* Wave A is the mandatory floor and is implemented; Wave B
is implemented via `/explore-release`. The structural waves are dispositioned
here rather than cargo-culted.

| Wave | Disposition | Reason |
|---|---|---|
| C — Capability registry | **Inapplicable at this scale** | 20 subcommands, one product surface, one maintainer. The 8-probe required set under `src/release/` *is* the inventory, and it is machine-readable by directory membership. Revisit if the command surface roughly doubles or a second maintainer joins. |
| D — Combination engine | **Inapplicable** | The real factor space is shell x terminal size x Node version x layout, already covered by the CI matrix and charter maneuver 5. There are no actor, entitlement, tenant, or vendor-outcome dimensions to combine -- summon has no auth, no roles, and no remote API. |
| E — Plan compiler | **Deferred, blocked on C** | A compiler maps changed paths to capabilities via the registry. Without one it would emit the same 8 probes for every diff, which is what `pnpm test:release` already does unconditionally. Unconditional execution is strictly safer than a compiler that could select nothing. |
| F — Environment/vendor fidelity | **Partially applicable, hard-blocked** | There is no staging and none can be built: TCC cannot be granted non-interactively. Rather than claim coverage, the gap is stated in the environment truth table above and covered by the `ghostty.real-launch` TTL arc. This is D18 applied honestly. |
| G — Model-based tests | **Inapplicable** | No lifecycle state machine exists. The nearest analogue -- a workspace being active or stopped -- has two states and one transition each way, already covered by `src/status.test.ts`. There are no sharing, entitlement, media, or notification lifecycles. |
| H — Cadence/TTL automation | **Minimally adopted** | Exactly one obligation exists (`ghostty.real-launch`). It is enforced by the analyzer's `OVERDUE_ARC` block and stored in `docs/release/evidence/cadence.json`. A general TTL framework for a single obligation would be more machinery than obligation. |

If any disposition above stops being true, the corresponding wave should be
reopened rather than worked around.


---

## 7. Evidence Model

### Required oracle layers

Select every layer capable of disproving the user-visible result:

| Oracle | What it can prove |
|---|---|
| UI/client | Rendering, interaction, copy, navigation, visible state |
| HTTP/RPC | Status, schema, headers, authorization, protocol behavior |
| Datastore | Durable state, uniqueness, scope, isolation, ordering |
| Object/filesystem | Artifact existence, metadata, generation, integrity |
| Queue/event | Emission, deduplication, ordering, consumption |
| Vendor | Provider acceptance, contract, remote identifier, failure mode |
| Telemetry | Error absence/presence, trace completion, unexpected retries |
| Cleanup | Synthetic fixtures and side effects were removed |

The capability registry declares expected oracles. The result analyzer verifies that their
evidence exists.

### Evidence manifest

Use a machine-readable manifest:

```yaml
schemaVersion: 1
release:
  baseline: <LAST_RELEASE_REF>
  candidate: <CANDIDATE_SHA_OR_DIGEST>
  deployedIdentity: <DEPLOYED_SHA_OR_DIGEST>
  environment: <ENVIRONMENT>

results:
  - scenarioId: <STABLE_SCENARIO_ID>
    required: true
    status: passed
    startedAt: <UTC_TIMESTAMP>
    finishedAt: <UTC_TIMESTAMP>
    runner: <RUNNER_ID>
    evidence:
      http: <PATH_OR_URL>
      datastore: <PATH_OR_QUERY_RECORD>
      screenshot: <PATH_OR_NONE>
      trace: <TRACE_ID_OR_NONE>
      cleanup: <PATH_OR_RECORD>
    fixtures:
      - id: <SYNTHETIC_FIXTURE_ID>
        cleanupStatus: removed

exceptions: []
```

Evidence MUST be:

- attributable to a stable scenario;
- tied to the fixed candidate and environment;
- timestamped;
- durable for the repository's audit period;
- redacted of secrets and personal data;
- sufficient for another maintainer to verify the conclusion.

### Exception format

Exceptions are explicit release decisions, not analyzer tricks:

```yaml
- id: <EXCEPTION_ID>
  scenarioId: <OPTIONAL_SCENARIO_ID>
  reason: <CONCRETE_REASON>
  risk: <LOW_MEDIUM_HIGH>
  approvedBy: <AUTHORIZED_ROLE_OR_ID>
  createdAt: <UTC_TIMESTAMP>
  expiresAt: <UTC_TIMESTAMP>
  followUp: <ISSUE_OR_WORK_ITEM>
```

Rules:

- required checks cannot be excused by quarantine;
- exceptions expire;
- critical exceptions require the project's named authority;
- an expired exception is absent;
- the final report displays exceptions prominently.

---

## 8. Release Procedure

**The operational procedure lives in `docs/release/release-checklist.md`** (158
lines, under the 200-line cap). It is the single procedural authority (D01/D02);
restating it here is exactly the drift this system exists to remove.

Implemented shape, for orientation only:

1. Preflight -- clean tree, ask for the version, determine the baseline.
2. Prepare on `develop` -- bump, CHANGELOG, canonical chain, diff approval.
3. Merge `develop` -> `main` with a merge commit, verifying required checks.
4. **Fix the candidate**: the post-merge `main` SHA. All evidence binds to it.
5. **Verify**: `pnpm test:release` -> `pnpm release:manifest` ->
   `pnpm analyze:release`, which must exit 0.
6. Cadence arcs -- `ghostty.real-launch` blocks when overdue.
7. Authorize, then tag. The annotated tag is the last action before the GitHub
   Release, which triggers the automated publish.
8. Post-publish -- assert the SLSA provenance `gitCommit` equals the candidate.
9. Rollback -- `npm deprecate` plus a `latest` dist-tag revert; never re-tag a
   failed candidate.

Tagging before steps 1-7 is forbidden and mechanically prevented: the release
workflow runs the analyzer before publish with no `continue-on-error`, and
`src/release/rehearsal.test.ts` (B10) regresses that ordering.


## 9. Required Reports

### Release evidence report

```markdown
# Release Evidence — <RELEASE_OR_CANDIDATE>

- Baseline: <LAST_RELEASE_REF>
- Candidate: <CANDIDATE_SHA_OR_DIGEST>
- Deployed identity: <DEPLOYED_SHA_OR_DIGEST>
- Environments: <ENVIRONMENTS>
- Generated: <UTC_TIMESTAMP>

## Decision

<PASS_OR_BLOCKED>

## Coverage

| Required | Passed | Failed | Skipped | Optional expired |
|---:|---:|---:|---:|---:|
| <N> | <N> | <N> | <N> | <N> |

## Impacted capabilities

| Capability | Risk | Selection reason | Result |
|---|---|---|---|
| <ID> | <RISK> | <REASON> | <RESULT> |

## Deterministic results

<RESULT_TABLE_AND_EVIDENCE>

## Exploratory charters

<CHARTER_SUMMARIES_AND_EVIDENCE>

## Cadence obligations

<DUE_AND_OVERDUE_TABLE>

## Cleanup

<FIXTURE_AND_RESIDUE_EVIDENCE>

## Exceptions

<NONE_OR_EXPLICIT_EXPIRING_EXCEPTIONS>

## Tag authorization

- Approved by: <IDENTITY_OR_ROLE>
- Approved at: <UTC_TIMESTAMP>
- Tag: <TAG_OR_PENDING>
```

### Exploratory charter report

```markdown
# Exploratory Charter — <CHARTER_ID>

- Candidate: <CANDIDATE_SHA_OR_DIGEST>
- Capability: <CAPABILITY_ID>
- Actors: <ACTORS>
- Surfaces: <SURFACES>
- Environment: <ENVIRONMENT>
- Timebox: <MINUTES>
- Executor context: <FRESH_CONTEXT_ID>

## Risk hypothesis

<WHAT_COULD_FAIL_AND_WHY>

## Maneuvers

| # | Maneuver | Result | Evidence or N/A reason |
|---:|---|---|---|
| 1 | Try the action twice | <PASS_FAIL_NA> | <EVIDENCE> |
| 2 | Edit after every error | <PASS_FAIL_NA> | <EVIDENCE> |
| 3 | Interrupt mid-flow | <PASS_FAIL_NA> | <EVIDENCE> |
| 4 | Use a second session or role | <PASS_FAIL_NA> | <EVIDENCE> |
| 5 | Switch locale and viewport/device | <PASS_FAIL_NA> | <EVIDENCE> |
| 6 | Compare copy with outcome | <PASS_FAIL_NA> | <EVIDENCE> |
| 7 | Read back downstream state | <PASS_FAIL_NA> | <EVIDENCE> |
| 8 | Ask "should this exist?" | <PASS_FAIL_NA> | <EVIDENCE> |

## Findings

<FINDING_REPRO_SEVERITY_EVIDENCE_AND_ISSUE>

## Skipped high-risk areas

<NONE_OR_BLOCKING_LIST>

## Fixtures and cleanup

<FIXTURE_IDS_AND_ZERO_RESIDUE_EVIDENCE>

## Charter decision

<PASS_OR_BLOCKED>
```

---

## 10. Stack-Specific Adaptation Guidance

### Web applications

Include:

- browser behavior and accessibility;
- HTTP/server actions;
- datastore and object-storage readbacks;
- multiple viewport classes;
- multiple sessions and roles;
- navigation, refresh, back, resume, and stale tabs;
- client/server copy consistency;
- preview/staging/production artifact identity.

### APIs and backend services

Replace visual checks with:

- contract and schema assertions;
- authentication and authorization matrices;
- idempotency and replay;
- concurrency and ordering;
- database and event readbacks;
- rate limits, timeouts, and partial dependency failure;
- client-version compatibility.

### Mobile or desktop applications

Add:

- OS and version factors;
- foreground/background/interruption;
- offline/reconnect;
- permissions denied then granted;
- upgrade and persisted-state migration;
- real-device cadence;
- app-binary identity;
- server/client compatibility windows.

### CLIs

Add:

- shell and operating-system factors;
- exit codes;
- stdout/stderr contracts;
- non-interactive behavior;
- malformed configuration;
- interrupted operations and resumability;
- filesystem permissions;
- upgrade and backwards compatibility.

### Libraries and SDKs

Treat consumers as the E2E surface:

- supported runtime/compiler versions;
- public API compatibility;
- package installation;
- minimal consumer applications;
- serialization and protocol contracts;
- error types and retry semantics;
- published-package identity rather than source-tree identity.

### Monorepos

The compiler MUST:

- map changed packages to transitive consumers;
- distinguish deployable artifacts;
- generate obligations per affected artifact;
- verify each deployed artifact's identity;
- avoid declaring the whole release safe from an unaffected package's green suite.

### Infrastructure and data systems

Add:

- plan/apply or migration separation;
- reversible change checks;
- drift detection;
- backup/restore evidence;
- access-policy verification;
- partial rollout and rollback;
- schema forward/backward compatibility;
- load, capacity, and failure-injection obligations where risk warrants.

---

## 11. Historical Escapes Become Coverage

Real escape classes from summon's history (200 `fix:` commits plus the agent
reports), each mapped to the coverage that now catches it. Where nothing
automated can catch it, that is stated rather than implied.

| # | Escape class | Evidence | Now covered by |
|---|---|---|---|
| 1 | **Ghostty window/tab creation races** -- repaired repeatedly: retry+verify (`b2a7afd`), `session --all` new-tab hardening (`b40560e`, #523), recoverable `TabOpenError` (`60ff42b`), 200ms inter-launch delay, failure sentinels (`launcher.ts:180-188`) | most-repaired area in the codebase | **Manual arc only** (`ghostty.real-launch`). No automated tier can reach it -- see the environment truth table. This is the largest residual risk and the reason the arc blocks when overdue. |
| 2 | **Atomic-write / orphan-file bugs** -- shared tmp name collision (`fa46b44`, #524), orphaned `.tmp` producing phantom list entries (`24f5866`, BE-M4 #605), default mode `0o600` (`85a5393`, #574) | concurrent-write corruption | `release.state-isolation` probe (registry round-trip, state confined to sandbox) plus existing unit coverage |
| 3 | **Trust-path normalization drift** -- `isTrusted` hashed an un-normalized path while keying by realpath (BE-H1 #590, fixed `e9e4a92`) | authorization bypass | `release.trust-enforcement` probe: block -> trust -> revoke-on-edit, end to end through the real CLI |
| 4 | **Flag-set / help / completions drift** -- no single source of truth across `parse.ts`, help text, `CLI_FLAGS`, and three completion generators (FE-M2) | **structurally still open** | `release.cli-contract` probe covers exit codes and stderr routing, but NOT flag-set parity. Recorded as a known gap; a census gate would need Wave C. |
| 5 | **Monitor/TUI lifecycle** -- frame-skip broke overlay dismissal (FE-B1, a launch-blocker shipped by a perf release); SIGWINCH lost after error recovery | shipped regression | charter maneuvers 3 and 5 (interrupt mid-flow; narrow terminal). Not automated. |
| 6 | **Parser/validation semantics** -- `parseInt("3000abc") === 3000` (BE-H2 #591), config inline-comment truncation (#532) | silent misparse | existing unit coverage; `release.cli-contract` guards the error-path contract |
| 7 | **Release-engineering failures** -- 21 `fix(ci)` commits, notably `53ad23e`/`ec85584` where the SBOM step aborted the job *before publish*, leaving a tag and GitHub Release with nothing on npm | D07 violation, realized | `release.yml` reordering (verify -> analyze -> publish -> assert provenance), rehearsal B10, and the explicit SBOM-absence warning |
| 8 | **Schema/shape validation gaps** -- snapshot reader not validating inner fields (BE-M1 #592), future-version JSON silently dropped (BE-M5 #606) | silent data loss | `release.state-isolation` probe asserts schema `version` presence; migration policy in `docs/decisions/schema-migration-strategy.md` |

Two further escapes are release-process rather than code, and are regressed
directly in `src/release/rehearsal.test.ts`:

- **`v1.8.0` was tagged against two different trees** ten minutes apart
  (`12d59df` failed to publish, tag recreated on `53ad23e`) -> rehearsal B5
  (`DEPLOYED_MISMATCH`).
- **`v1.4.0` has a tag and a GitHub Release but was never published**
  (`npm view summon-ws@1.4.0` returns 404) -> rehearsal B10 (tag cannot precede
  the evidence gate).

Per the template: do not stop at a one-off regression when the real gap was
scenario selection or evidence quality. Items 1, 4, and 5 above remain
uncovered by automation, and that is recorded deliberately.


## 12. Anti-Patterns This System Rejects

- An append-only release document that grows without becoming executable.
- A green run in which every relevant test skipped.
- Required checks whose credentials or fixtures may be absent without failure.
- Quarantining a required check and still releasing.
- Tagging before release evidence is complete.
- Running tests against one commit and deploying another.
- Treating UI confirmation as durable-state proof.
- Testing features independently while ignoring their interactions.
- Letting implementers perform the only exploratory review.
- Omitting maneuver rows instead of reporting N/A with a reason.
- Treating "manual" as unowned and timeless.
- Calling a disabled staging integration "covered."
- Using permanent mocks without a real-provider contract probe.
- Using only real providers, making fault injection costly and nondeterministic.
- Chaining verification commands so an early failure is masked.
- Allowing newly added routes, states, jobs, or vendors to bypass the capability inventory.
- Generating a release plan that silently ignores unmapped changes.
- Using real customer data for release verification.
- Cleaning broad shared data rather than run-owned fixtures.
- Accepting exceptions with no owner, follow-up, or expiry.

---

## 13. Project Epic Template

```markdown
# Implement E2E Pro executable release verification

## Problem

The current release process contains operational knowledge but cannot prove that all checks
required by a release actually ran. It undercovers cross-feature interactions, recovery paths,
and independent exploratory behavior.

## Outcome

For every fixed release candidate, the repository generates an auditable execution plan from
changed capabilities, blocks on required failures/skips or zero passes, captures multi-layer
evidence, runs fresh-context exploratory charters, enforces cadence obligations, and tags only
after the evidence is complete.

## Non-negotiable decisions

- [ ] One short release source of truth; subordinate commands delegate to it
- [ ] Zero-pass runs fail
- [ ] Required skip/fail blocks; quarantine does not excuse it
- [ ] Candidate identity is fixed and verified after deployment
- [ ] Tag is the last release action after evidence and authorization
- [ ] Fresh-context exploratory charters use all eight maneuvers
- [ ] Synthetic fixtures and cleanup evidence are mandatory
- [ ] Capability invariants are implementation-independent
- [ ] Pairwise ordinary coverage plus explicit dangerous triples
- [ ] Manual/device arcs have blocking TTLs

## Wave A — Truthful immediate gates

- [ ] Audit and de-drift release instructions
- [ ] Add zero-pass enforcement and regression test
- [ ] Define and tag the initial required probe set
- [ ] Enforce required failures and skips
- [ ] Move tagging after all evidence
- [ ] Verify CI can execute the required set from day one

## Wave B — Exploratory charters

- [ ] Add diff-driven charter generation
- [ ] Run one fresh context per charter
- [ ] Require all eight maneuver rows
- [ ] Require findings, skipped-high-risk, and cleanup sections
- [ ] Block tagging on failures or skipped high-risk areas

## Wave C — Capability registry

- [ ] Define and validate the schema
- [ ] Inventory critical capabilities first
- [ ] Register actors, states, factors, invariants, transitions, and oracles
- [ ] Add ownership, environment tiers, safety, and cadence
- [ ] Add a census gate for new uncovered surfaces

## Wave D — Combination engine

- [ ] Define factor domains and validity constraints
- [ ] Generate deterministic constrained pairwise scenarios
- [ ] Add explicit three-way scenarios for dangerous interactions
- [ ] Map historical escapes to interactions

## Wave E — Release plan compiler

- [ ] Map changed paths and dependencies to capabilities
- [ ] Generate stable per-release obligations
- [ ] Fail on unmapped user-affecting changes
- [ ] Emit required/optional status, environment, runner, oracles, and safety class
- [ ] Validate result and evidence completeness

## Wave F — Environment and vendor fidelity

- [ ] Publish the environment truth table
- [ ] Add response-shaped permanent local stubs and fault legs
- [ ] Add cost-bounded scheduled real-vendor probes
- [ ] Provision representative staging or explicitly handle the gap

## Wave G — State-machine coverage

- [ ] Select the highest-risk lifecycle domains
- [ ] Define models, transitions, and invariants
- [ ] Generate and shrink action sequences
- [ ] Preserve escaped sequences as regressions

## Wave H — Cadence and TTL

- [ ] Make manual/device obligations machine-readable
- [ ] Persist last-run evidence and next-due dates
- [ ] Block on overdue critical obligations

## Acceptance criteria

- [ ] A zero-pass synthetic report fails
- [ ] A required skip fails
- [ ] A quarantined required failure fails
- [ ] An unmapped critical change fails plan compilation
- [ ] A candidate/deployment mismatch fails
- [ ] Missing required oracle evidence fails
- [ ] Missing cleanup evidence fails
- [ ] An overdue critical arc fails
- [ ] An exploratory report missing a maneuver fails
- [ ] Tagging cannot occur before the complete evidence gate
- [ ] The same compiler inputs reproduce the same scenario plan
- [ ] At least one real release rehearsal completes end to end
```

---

## 14. Agent Implementation Brief

Give this brief to the implementation agent in the target project:

```markdown
Implement the repository's E2E Pro epic using
`<PATH_TO_ADAPTED_E2E_PRO_DOCUMENT>` as the decision source.

Before editing:

1. Read the repository's agent instructions, release process, test rules, deployment rules, and
   architecture documentation completely.
2. Inspect the actual branches, workflows, commands, environments, providers, routes, jobs,
   persisted states, role model, existing tests, and release-report code. Do not trust stale docs.
3. Complete or verify the Project Adaptation Profile and environment truth table.
4. Identify dirty-worktree or concurrent-agent changes and preserve them.

Implementation rules:

- Follow the epic waves and repository phase gates.
- Implement Wave A before structural work.
- Use tests for every analyzer, compiler, and gate invariant.
- Keep the release procedure short and make other commands delegate to it.
- Do not weaken required-check, zero-pass, candidate-identity, cleanup, cadence, or tag-last
  invariants to make a suite green.
- Use project-native tools and schemas where they meet the contract.
- Treat production-affecting and outward-facing actions as authorization boundaries.
- Use synthetic run-scoped fixtures and remove only those fixtures.
- Report unsupported environments truthfully.
- Run verification commands sequentially.

For each wave, deliver:

- code and documentation;
- regression tests;
- generated or machine-readable artifacts;
- exact verification evidence;
- remaining coverage gaps;
- migration or rollout notes.

Stop at the repository's required phase boundaries and do not tag or release unless that action
is explicitly authorized.
```

---

## 15. Definition of Done — audit

Walked 2026-07-28 against the template's own checklist. "Scoped out" is not
"done"; it is recorded as deliberately not built.

| Criterion | Status | Evidence |
|---|---|---|
| Project profile and environment truth table verified | **MET** | Section 5, from `docs/research/2026-07-28-e2e-pro-release-verification.md` |
| Release procedures no longer contradict each other | **MET** | `docs/release/release-checklist.md` is the single authority; 28 contradictions resolved |
| Zero-pass, required-skip, required-failure fail mechanically | **MET** | `scripts/release/analyzer.mjs`; rehearsals B1, B2, B3 |
| Required probes runnable in the declared workflow | **MET** | `Release probes` job, ubuntu, 8 probes, none skippable |
| Release obligations generated for a fixed candidate | **PARTIAL** | The probe set is fixed rather than generated -- Wave E is scoped out. Unconditional execution is safer than a compiler that could select nothing. |
| Changed critical behavior cannot silently remain unmapped | **NOT MET** | Requires the Wave C census gate. Recorded gap: a new subcommand adds no probe automatically. |
| Combination coverage: ordinary pairs plus dangerous triples | **SCOPED OUT** | Wave D -- no actor/entitlement/vendor dimensions exist |
| Independent exploratory charters produce complete maneuver evidence | **MET** | `/explore-release` repaired and wired; `validate-charter.mjs` enforces all 8 rows |
| Expected oracles checked | **MET** | Analyzer blocks on `MISSING_ORACLE`; cleanup on `DIRTY_FIXTURE` |
| Vendor seams have fault coverage and scheduled real probes | **NOT MET, BLOCKED** | The only real seam is Ghostty, unreachable from CI. Covered by the manual arc instead; stated in the truth table. |
| Manual/hardware obligations have enforced TTLs | **MET** | `ghostty.real-launch`, 30 days, `blocksWhenOverdue: true`; rehearsal B8 |
| High-risk stateful domains have a model-based plan | **SCOPED OUT** | Wave G -- no lifecycle state machine exists |
| The final report identifies the exact tested and deployed artifact | **MET** | Manifest binds to the candidate; `release.yml` asserts SLSA provenance `gitCommit` post-publish |
| Tagging occurs only after the evidence and authorization gate | **MET** | Checklist step 7; analyzer runs before publish with no `continue-on-error`; rehearsal B10 |
| A full rehearsal demonstrates passing and deliberate blocked cases | **MET** | `src/release/rehearsal.test.ts`: 2 positive, 10 blocking, re-run every commit |

### Known residual risks

1. **The Ghostty launch path has no automated coverage at any tier.** Three
   independent blockers, none removable without a self-hosted macOS runner with
   a persistent TCC grant. Mitigated only by the 30-day manual arc.
2. **Flag-set parity is unguarded** (escape class 4). `parse.ts`, help text,
   `CLI_FLAGS`, and three completion generators can still drift apart.
3. **No census gate.** A newly added subcommand acquires no probe automatically;
   the required set grows only when someone extends `src/release/`.

These are stated so the system is not mistaken for more complete than it is.
