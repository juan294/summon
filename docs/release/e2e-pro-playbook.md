# E2E Pro Release Verification Playbook — Cross-Project Implementation Template

> Template version: 1.0
>
> Intended audience: implementation agents and maintainers adapting this quality system to
> another repository, environment model, and technology stack.

This is a cc-rpi blueprint template. Copy it into a target project and adapt it. It is
intentionally comprehensive; the 200-line limit it prescribes applies to the *finished* project's
day-to-day release procedure, not to this adoption-and-architecture template.

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

## How to Use This Template

1. Copy this document into the target repository.
2. Replace every `<PLACEHOLDER>` with a verified project-specific value.
3. Delete sections that are genuinely inapplicable and record why they are inapplicable.
4. Create the machine-readable artifacts described here; this document alone is not the
   finished system.
5. Keep the hard invariants intact. Adapt commands, paths, tools, and environment tiers—not
   the evidence standard.
6. Create a project epic that tracks each implementation wave and links to the resulting
   artifacts.

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

Complete this table using repository evidence before implementing anything.

| Area | Project value |
|---|---|
| Project | `<PROJECT_NAME>` |
| Repository visibility | `<PRIVATE_OR_PUBLIC>` |
| Primary product type | `<WEB_APP_API_MOBILE_DESKTOP_CLI_LIBRARY_MONOREPO_OTHER>` |
| Package/build system | `<PACKAGE_MANAGER_AND_BUILD_SYSTEM>` |
| Integration branch | `<INTEGRATION_BRANCH>` |
| Production branch | `<PRODUCTION_BRANCH>` |
| Merge strategy | `<MERGE_COMMIT_SQUASH_REBASE_OTHER>` |
| Release artifact | `<COMMIT_IMAGE_PACKAGE_BINARY_APP_BUNDLE_OTHER>` |
| Deployment provider | `<DEPLOY_PROVIDER>` |
| Local test target | `<LOCAL_TARGET>` |
| Preview target | `<PREVIEW_TARGET_OR_NONE>` |
| Staging target | `<STAGING_TARGET_OR_NONE>` |
| Production target | `<PRODUCTION_TARGET>` |
| Test runner(s) | `<TEST_RUNNERS>` |
| Unit command | `<UNIT_TEST_COMMAND>` |
| Integration command | `<INTEGRATION_TEST_COMMAND>` |
| E2E command | `<E2E_COMMAND>` |
| Typecheck command | `<TYPECHECK_COMMAND_OR_NONE>` |
| Lint command | `<LINT_COMMAND_OR_NONE>` |
| Build command | `<BUILD_COMMAND>` |
| Release-report command | `<RELEASE_REPORT_COMMAND>` |
| Primary datastore | `<DATASTORE_OR_NONE>` |
| Object/media storage | `<OBJECT_STORE_OR_NONE>` |
| Queue/event system | `<QUEUE_EVENT_SYSTEM_OR_NONE>` |
| Authentication | `<AUTH_PROVIDER_OR_INTERNAL>` |
| Payments/entitlements | `<PAYMENT_PROVIDER_OR_NONE>` |
| Email/notifications | `<NOTIFICATION_PROVIDERS_OR_NONE>` |
| Other external vendors | `<EXTERNAL_VENDORS_OR_NONE>` |
| Observability | `<LOGS_TRACES_METRICS_ERROR_TRACKING>` |
| Hardware/real-device surfaces | `<SURFACES_OR_NONE>` |
| Agent command directory | `<AGENT_COMMAND_DIRECTORY>` |
| Capability registry owner | `<TEAM_OR_ROLE>` |
| Release approver | `<ROLE>` |
| Rollback authority | `<ROLE>` |

### Environment truth table

Do not infer an environment's fidelity from its name.

| Environment | Exact artifact? | Real auth? | Real datastore? | Real vendors? | Safe writes? | Main limitations |
|---|---:|---:|---:|---:|---:|---|
| Local | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<LIMITATIONS>` |
| CI | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<LIMITATIONS>` |
| Preview | `<YES_NO_NA>` | `<YES_NO_NA>` | `<YES_NO_NA>` | `<YES_NO_NA>` | `<YES_NO_NA>` | `<LIMITATIONS>` |
| Staging | `<YES_NO_NA>` | `<YES_NO_NA>` | `<YES_NO_NA>` | `<YES_NO_NA>` | `<YES_NO_NA>` | `<LIMITATIONS>` |
| Production | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<YES_NO>` | `<LIMITATIONS>` |

If production is the first full-integration environment, record that as an open release risk and
prioritize a safer full-fidelity environment or cost-bounded synthetic production probes.

---

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

- use synthetic, run-scoped fixtures such as `<PROJECT_FIXTURE_PREFIX>-<RUN_ID>`;
- operate only within the charter's authorization;
- avoid real user data;
- avoid live charges, email, messages, destructive mutations, or hardware actions without
  explicit authorization;
- clean up only their own fixtures;
- record fixture identifiers and prove zero unexpected residue;
- observe and report findings rather than opportunistically changing production or code.

### Wave C — Build the Capability Registry

The registry is the durable inventory from which coverage is generated and audited.

#### C1. Registry schema

Use YAML, JSON, TOML, or another schema-validated format. Example:

```yaml
schemaVersion: 1
capabilities:
  - id: account.member-invitation
    name: Invite a member
    owner: identity-team
    risk: critical
    description: An authorized member invites another actor into a scoped resource.

    surfaces:
      - web
      - api
      - email

    actors:
      - owner
      - existing-member
      - invitee
      - unauthorized-user

    states:
      resource:
        - active
        - archived
      invitation:
        - absent
        - pending
        - accepted
        - expired
        - revoked

    factors:
      locale: [en, es]
      auth: [fresh, expired]
      vendorOutcome: [success, timeout, rejected]

    invariants:
      - id: invitation.no-privilege-escalation
        statement: Acceptance never grants permissions beyond the invitation scope.
      - id: invitation.no-duplicate-active-token
        statement: Retrying creation does not create multiple usable invitations.
      - id: invitation.copy-matches-state
        statement: User-visible confirmation reflects the persisted invitation outcome.

    transitions:
      - from: absent
        action: create
        to: pending
      - from: pending
        action: accept
        to: accepted
      - from: pending
        action: expire
        to: expired

    oracles:
      - type: ui
        assertion: Confirmation and next action match the resulting state.
      - type: http
        assertion: Response status and body match the transition contract.
      - type: datastore
        assertion: Exactly one scoped invitation is persisted.
      - type: outbound-event
        assertion: At most one invitation event is emitted.
      - type: cleanup
        assertion: Synthetic actors and invitations are removed.

    tiers:
      pullRequest: [unit, integration]
      release: [preview, production-smoke]
      nightly: [real-vendor]

    cadence:
      criticalManualArc:
        intervalDays: 30
        blocksWhenOverdue: true

    safety:
      productionWrites: synthetic-only
      outwardEffects: explicit-authorization
```

#### C2. Invariant design rules

Invariants MUST describe observable truth without depending on a particular implementation.

Good:

```text
Retrying the same payment event does not grant the entitlement twice.
```

Weak:

```text
Function processWebhook calls repository.upsert once.
```

Each critical capability SHOULD include invariants for:

- authorization and isolation;
- data integrity;
- idempotency;
- error recovery;
- concurrency or repeat behavior;
- copy versus outcome;
- cleanup or reversibility;
- vendor degradation;
- privacy and security;
- product validity: whether the resulting state should be allowed to exist.

#### C3. Census gate

CI MUST detect when a change adds or materially changes any of the following without registry
coverage or an explicit, reviewed exemption:

- user-facing route, screen, command, or workflow;
- mutating endpoint or public API operation;
- background job, scheduled task, queue consumer, or webhook;
- external vendor seam;
- feature flag;
- actor or permission type;
- persisted state or enum value;
- release-critical infrastructure surface.

The census begins with a measured baseline and ratchets toward zero unexplained gaps. New gaps
fail immediately.

### Wave D — Add Constrained Combination Coverage

Exhaustive Cartesian testing is usually too expensive. Hand-picked happy paths are too weak.
Use risk-aware constrained interaction testing.

#### D1. Factor inventory

For every capability, identify only factors that can change behavior:

| Factor class | Examples |
|---|---|
| Actor | anonymous, owner, member, admin, expired session |
| Resource state | new, active, partially complete, archived, deleted |
| Operation | create, edit, retry, cancel, restore, merge |
| Input mode | typed, uploaded, imported, recorded |
| Vendor outcome | success, timeout, malformed, rejected, duplicate callback |
| Client context | locale, viewport, OS, network, SDK version |
| Concurrency | one session, two sessions, duplicate request, stale client |
| Entitlement | free, paid, trial, expired, refunded |
| Delivery state | queued, sent, bounced, acknowledged |

Use project-specific factors. Do not include values that cannot affect the behavior merely to
inflate coverage.

#### D2. Coverage strength

Generate constrained pairwise scenarios for ordinary factor interactions.

Create explicit three-way scenarios for known-dangerous interactions. The initial danger catalog
SHOULD consider:

```text
actor × resource-state × operation
creation-mode × enhancement × vendor-outcome
locale × auth × return-to
payment × webhook × retry
media-source × mix-state × consuming-surface
error × edit × retry
source-roles × destination-roles × consolidate-or-reopen
```

Replace or extend these with the target project's historical bug classes.

#### D3. Constraints

Encode invalid combinations explicitly:

```yaml
constraints:
  - if:
      actor: anonymous
    thenNot:
      entitlement: paid-existing-account

  - impossible:
      resourceState: deleted
      operation: edit
```

Constraints MUST distinguish:

- impossible state;
- unsafe or unauthorized test;
- unsupported environment;
- valid negative scenario.

A valid negative scenario is a test, not a constraint to remove.

#### D4. Reproducibility

Generated plans MUST record:

- generator version;
- input registry revision;
- seed, if randomized;
- constraints revision;
- selected interaction strength;
- resulting stable scenario IDs.

The same inputs MUST reproduce the same plan.

### Wave E — Build the Per-Release Plan Compiler

The compiler turns the fixed release diff into an executable obligation list.

#### E1. Inputs

At minimum:

```text
last release reference
candidate commit or artifact digest
changed paths and dependency graph
capability registry
scenario catalog
combination constraints
environment capabilities
test cadence and last-run records
historical escape mappings
active, unexpired exceptions
```

#### E2. Impact mapping

Map changed code to capabilities through one or more verified methods:

- explicit path ownership in the registry;
- dependency graph;
- route or endpoint ownership;
- service/module manifests;
- test-to-source metadata;
- migration or schema ownership;
- vendor integration ownership;
- reviewed fallback classification for unmapped changes.

An unmapped user-affecting change MUST fail plan compilation or require an explicit reviewed
classification. It MUST NOT silently produce an empty plan.

#### E3. Output

The plan contains:

```yaml
release:
  baseline: <LAST_RELEASE_REF>
  candidate: <CANDIDATE_SHA_OR_DIGEST>
  generatedAt: <UTC_TIMESTAMP>

obligations:
  - scenarioId: account.member-invitation.vendor-timeout-retry
    capabilityId: account.member-invitation
    required: true
    reason:
      - changed-path
      - critical-three-way-interaction
    environment: staging
    runner: <COMMAND_OR_TEST_SELECTOR>
    safetyClass: synthetic-write
    expectedOracles: [http, datastore, outbound-event, cleanup]
    status: pending
```

For each obligation, capture:

- stable scenario ID;
- capability;
- why it was selected;
- required or optional status;
- environment;
- command or runner;
- safety and authorization class;
- expected oracles;
- result;
- evidence links or paths;
- fixture and cleanup record;
- exception reason and expiry, if allowed.

#### E4. Compiler failure conditions

Compilation or final analysis fails when:

- the candidate is missing or mutable;
- an impacted path has no capability mapping;
- no scenario is selected for an impacted critical capability;
- a required environment is unavailable without an approved exception;
- a critical TTL obligation is overdue;
- a required result is missing, failed, or skipped;
- evidence references another candidate;
- cleanup is unverified;
- zero checks passed.

### Wave F — Improve Environment and Vendor Fidelity

#### F1. Test-tier allocation

Use the cheapest tier that can prove the invariant, but use a real seam where only the real seam
can provide proof.

| Tier | Primary purpose | Typical required evidence |
|---|---|---|
| Unit/property | Pure rules, parsers, generators, state invariants | Assertions and reproducible inputs |
| Component/service integration | Datastore, queue, filesystem, protocol boundaries | Request plus durable readback |
| Local stub/emulator | Deterministic vendor shapes and fault injection | Success, timeout, malformed, rejection, retry |
| Preview/staging E2E | Deployed artifact across application layers | Artifact identity plus multi-layer oracles |
| Production smoke | Public routing, real deployment, narrowly safe critical paths | Version, response, readback, cleanup |
| Scheduled real-vendor | Credentials, contracts, quotas, provider behavior | Cost-bounded request and provider-side evidence |
| Real device/hardware | Physical, OS, permission, media, or peripheral behavior | Timestamped device evidence |

#### F2. Permanent local stubs

Each critical vendor seam SHOULD have a stable local substitute that:

- matches the provider's relevant response and error shapes;
- supports deterministic success and fault legs;
- records calls for assertions;
- supports delay, timeout, malformed output, rejection, and duplicate delivery where relevant;
- does not require a live credential;
- is safe for every contributor and CI.

A stub proves application behavior against the modeled contract. It does not prove the real
provider still honors that contract.

#### F3. Scheduled live probes

Each critical real seam SHOULD have a cost-bounded scheduled probe that:

- uses a synthetic account or sandbox where possible;
- sets explicit cost, rate, and timeout ceilings;
- verifies provider response and downstream application state;
- includes at least the highest-value fault or retry leg that the provider permits safely;
- emits evidence and alerts;
- does not turn a provider outage into silent quarantine;
- has a documented escalation path.

#### F4. Staging gap handling

If staging intentionally disables or throws on a critical integration:

1. mark that capability's staging tier as unsupported;
2. prevent reports from counting it as full-integration coverage;
3. move deterministic behavior to a local stub or sandbox;
4. add a narrow real-seam probe at the safest available tier;
5. track provisioning of a representative environment as structural work.

Do not normalize "first full integration happens in public production" as acceptable permanent
architecture.

### Wave G — Add Model-Based and State-Machine Verification

Use model-based testing where behavior depends on sequences rather than isolated inputs.

Priority domains:

- roles, sharing, membership, invitations, and access revocation;
- create/edit/publish/archive/restore lifecycle;
- subscription, payment, entitlement, refund, and retry;
- upload/record/process/mix/play media lifecycle;
- notification enqueue/send/retry/bounce/read;
- merge, consolidation, migration, and reopen flows;
- offline/online, reconnect, and multi-session behavior.

For each model:

1. define valid states;
2. define allowed actions;
3. define transition preconditions;
4. define observable postconditions;
5. define invariants that must hold after every transition;
6. generate action sequences, including repeats and interruptions;
7. shrink failures to a minimal reproducible sequence;
8. preserve escaped sequences as permanent regressions.

The model describes product truth. The adapter performs actions through the current stack.

### Wave H — Enforce Cadence and TTL

Not every critical scenario can run on every commit. Frequency therefore becomes an executable
contract.

Example:

```yaml
cadence:
  - obligationId: mobile.real-device.audio-recording
    capabilityId: media.recording
    risk: critical
    intervalDays: 14
    blocksWhenOverdue: true
    owner: mobile-team

  - obligationId: payment.real-provider.renewal
    capabilityId: billing.entitlement
    risk: high
    intervalDays: 7
    blocksWhenOverdue: true
    owner: billing-team
```

Record:

- last successful run;
- exact candidate or environment version;
- executor;
- evidence;
- next due date;
- result;
- exception and expiry.

"Manual" MUST NOT mean "optional and untracked."

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

## 8. Release Procedure Template

Keep the operational version of this section at 200 lines or fewer. Link to capability runbooks
instead of expanding it indefinitely. In cc-rpi, the tag/publish step (8) is executed by
`/release`; this procedure produces the verified evidence that `/release` gates on.

### 1. Preflight

- Confirm authorized release scope and approver.
- Confirm the integration and production branches match `<BRANCH_POLICY>`.
- Confirm the worktree is clean or that unrelated changes are isolated.
- Reconcile CI and deployment status.
- Determine `<LAST_RELEASE_REF>`.
- Fix `<CANDIDATE_SHA_OR_DIGEST>`.

### 2. Compile obligations

```sh
<COMPILE_RELEASE_PLAN_COMMAND> \
  --baseline <LAST_RELEASE_REF> \
  --candidate <CANDIDATE_SHA_OR_DIGEST> \
  --output <PLAN_PATH>
```

- Review impacted and unmapped capabilities.
- Resolve compiler failures.
- Confirm overdue critical cadence checks are included.

### 3. Run deterministic gates sequentially

```sh
<TYPECHECK_COMMAND>
<LINT_COMMAND>
<UNIT_TEST_COMMAND>
<INTEGRATION_TEST_COMMAND>
<BUILD_COMMAND>
<RELEASE_REQUIRED_TEST_COMMAND>
```

Do not combine commands in a way that masks an earlier exit status.

### 4. Verify a deployed candidate

- Deploy or promote the fixed candidate using `<DEPLOY_COMMAND>`.
- Verify the deployed SHA, digest, or version.
- Stop if deployed identity differs from the candidate.
- Run the required environment probes.

### 5. Run exploratory release charters

```text
<EXPLORE_RELEASE_COMMAND> <LAST_RELEASE_REF> <CANDIDATE_SHA_OR_DIGEST>
```

- Use fresh independent contexts.
- Complete every maneuver table.
- Triage every finding.
- Resolve skipped high-risk areas.
- Verify fixture cleanup.

### 6. Complete cadence-bound arcs

- Run due device, hardware, rotation, or manual obligations.
- Attach current evidence.
- Stop for overdue critical obligations.

### 7. Analyze evidence

```sh
<ANALYZE_RELEASE_COMMAND> \
  --plan <PLAN_PATH> \
  --evidence <EVIDENCE_MANIFEST_PATH>
```

The analyzer MUST fail for:

- zero passes;
- any required failure or skip;
- missing required evidence;
- missing or failed cleanup;
- candidate/deployment mismatch;
- unexplained unmapped impact;
- overdue critical obligations;
- untriaged exploratory failures or skipped high-risk areas.

### 8. Authorize and tag

- Present the complete report to `<RELEASE_APPROVER>`.
- Obtain any explicit authorization required by repository policy.
- Create the release tag only now (via `/release`).
- Push the tag using `<TAG_COMMAND>`.
- Record release, deployment, report, and rollback references.

### 9. Rollback

Trigger rollback on `<ROLLBACK_CONDITIONS>`.

Use:

```sh
<ROLLBACK_COMMAND>
```

After rollback:

- verify the restored artifact identity;
- verify health and critical reads;
- prevent the failed candidate from being retagged;
- preserve evidence and open incident follow-up.

---

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

Every production escape or manual-tester discovery produces at least one durable update:

1. a regression scenario;
2. a new or refined invariant;
3. a factor or dangerous interaction;
4. an oracle requirement;
5. an impact-mapping rule;
6. an exploratory charter heuristic;
7. a cadence change.

Record:

```yaml
escape:
  id: <INCIDENT_OR_ISSUE_ID>
  capability: <CAPABILITY_ID>
  missedBecause: <WHY_EXISTING_SYSTEM_DID_NOT_SELECT_OR_DETECT_IT>
  interaction:
    - <FACTOR_VALUE>
    - <FACTOR_VALUE>
  permanentCoverage:
    - <SCENARIO_OR_INVARIANT_ID>
```

Do not stop at adding a one-off regression if the real gap was scenario selection or evidence
quality.

---

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

## 15. Definition of Done

The implementation is not complete because this template was copied or because a longer playbook
exists. It is complete when:

- the project profile and environment truth table are verified;
- release procedures no longer contradict each other;
- zero-pass, required-skip, and required-failure cases fail mechanically;
- required probes are runnable in the declared workflow;
- release obligations are generated for a fixed candidate;
- changed critical behavior cannot silently remain unmapped;
- combination selection covers ordinary pairs and declared dangerous triples;
- independent exploratory charters produce complete maneuver evidence;
- expected datastore, storage, event, vendor, telemetry, and cleanup oracles are checked;
- vendor seams have deterministic fault coverage and appropriately scheduled real probes;
- manual or hardware obligations have enforced TTLs;
- high-risk stateful domains have a model-based coverage plan;
- the final report identifies the exact tested and deployed artifact;
- tagging occurs only after the complete evidence and authorization gate;
- a full rehearsal has demonstrated both a passing release and deliberate blocked cases.

At that point, the playbook has become an executable quality system rather than a memory aid.
