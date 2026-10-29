---
name: "rpi-pre-launch"
description: "Audit launch readiness across architecture, frontend, backend, performance, operations, security, QA and UX, plus applicable agent surfaces, and produce validated findings."
argument-hint: "[request]"
---
The request is supplied as literal arguments: $ARGUMENTS


# Pre-Launch Codebase Audit

Senior cross-functional launch-readiness audit before any public release.
Core domain coverage plus conditional agent-surface coverage, a 16-section
report and a three-wave remediation handoff. Staffing follows actual scope.

## Mindset

> Assume this product will be publicly launched soon and judged by users
> and engineers with high standards. Be skeptical. Look for hidden
> complexity, inconsistent craftsmanship, operational fragility, and
> scaling risks. Do not give the benefit of the doubt where the code or
> structure does not justify it. Prefer systemic findings over isolated
> nitpicks — if the same issue appears in 5 places, report it once as a
> systemic pattern, not five times as nitpicks.

### Second-order rule

A finding is a hypothesis, not a work order. Before you recommend a fix,
reason one step past it: what must stay true after the change, and what
could the fix break? A change that resolves your finding but regresses
another property is not an improvement — surface the trade instead of
presupposing the win is worth it. Prefer the narrowest fix that trades
nothing away. When a non-functional goal (perf, ISR, bundle size, build
time) conflicts with a correctness, security, or UX invariant, default to
the invariant and flag the conflict for a human decision — do not silently
trade correctness for a metric. Capture this reasoning in the finding's
**Regression risk** field; it is the anchor `rpi-remediate` verifies against
before implementing anything.

## Input

The request may provide a focus area hint (e.g., "focus on backend"). Biases
synthesis emphasis — does not disable any required domain.

## Step 1: Domain Coverage and Assignments

Inspect the actual source for an implemented agent-facing surface, including
WebMCP registration or a server MCP/tool contract. A possible search is
`rg -n 'modelContext|registerTool|toolname='` within relevant source paths; inspect
matches and use the project's actual server-tool conventions as well. Record
whether agent-surface coverage applies. Planned but unimplemented tools do not
produce `AS` findings in a code-as-written audit.

Cover the eight core domains listed below. Choose bounded read-only assignments
based on uncertainty, file ownership, domain overlap, available tools and CPU/API
contention. One agent can cover multiple domains; no fixed agent count is required.
Record assignment coverage and evidence of absent implementation within a domain;
all eight core domains remain required. AS alone is conditional.
Delegate independent work concurrently when useful, then await all results before
synthesis. Keep one owner for the full test selection; all other checks are scoped.

Every assignment states its objective, allowed actions/files, evidence/output
contract, resource constraints and completion condition. Use the
[bounded dispatch contract](references/dispatch.md) for the audit coverage artifact.
Failed or missing results remain explicit gaps; they cannot count as reviewed
domains or justify a READY verdict. Independent implementation review remains a
separate requirement when findings are later remediated.

Each domain investigation opens with the **system-map-first preamble**:

> Before judging details in your domain, build a mental model: identify
> entry points, map data/control flow within your scope, and note the
> major boundaries. Report this model in your finding set under a
> `## Domain Model` subsection.

**Architecture domain — Principal Architect** (`architect`, AR)

Scope: system-wide architecture, module boundaries, coupling, dependency
health, circular deps, dead code detection, typecheck.
Commands: the documented typecheck command, the package manager’s outdated-package inspection.
Excludes: FE-specific and BE-specific code concerns (delegated to
Staff FE and Staff BE).

**Frontend domain — Staff Frontend Engineer** (`staff-frontend`, FE)

Scope: component structure, state management, routing, client-side perf,
hydration, bundle composition, FE-specific patterns.
Commands: read FE source tree, bundle analyzer output if available.
Excludes: visual design and a11y (UX Lead), backend API shape (Staff BE).

**Backend domain — Staff Backend Engineer** (`staff-backend`, BE)

Scope: API design, validation, error handling, retry/idempotency, DB
access patterns, transactions, queues, background jobs, service
boundaries.
Commands: read BE source tree, schema files, migration directory.
Excludes: deployment/CI (DevOps/SRE Lead), latency profiling
(Performance Engineer).

**Performance domain — Performance Engineer** (`performance-eng`, PE)

Scope: bundle sizes, unused exports, code splitting, p95/p99 latency
risks, cache strategy, hot-path identification, startup cost,
CPU/memory/IO/network inefficiencies.
Commands: the documented build command (parse output for sizes and signals).

**Operations domain — DevOps / SRE Lead** (`devops-sre`, DO)

Scope: deployment safety, rollback strategy, env config, secrets
handling, migrations, CI/CD, health checks, observability, tracing,
logging, alerting, runbook readiness, incident response readiness.
Commands: `gh run list --branch <integration-branch> --limit 5`, audit
env var docs vs actual usage, verify error pages exist, check git state
clean.

**Security domain — Security Reviewer** (`security-reviewer`, SE)

Scope: the documented dependency audit, hardcoded secrets, auth/authz gaps,
sensitive-data handling, injection (SQL/XSS/SSRF/CSRF), unsafe defaults,
CORS, dependency licenses.
Commands: the documented dependency audit, grep for secret patterns.
Note: A dedicated security review is still required before launch. This
audit catches obvious issues only.

**QA domain — QA / Reliability Lead** (`qa-reliability`, QA)

Scope: the documented test selection + the documented typecheck command + the documented lint command; coverage of
critical workflows; graceful degradation; failure modes;
retry/idempotency coverage; high-risk untested files.
Commands: the documented test selection (full suite — the ONE specialist authorized;
Rule #73).
Rule #73: the other specialists MUST NOT run the documented test selection in parallel.

**UX domain — Product Designer / UX Lead** (`ux-lead`, UX)

Scope: visual hierarchy, screen-to-screen consistency, component reuse,
design-system signals, spacing/typography/control consistency,
interaction conventions, messaging/voice, empty/loading/error states,
responsiveness, accessibility (ARIA, focus, keyboard nav,
`prefers-reduced-motion`, alt text), perceived performance, UX friction,
conversion blockers.
Commands: read UI source tree, component library, design tokens.

**Agent-surface domain — Agent Surface Engineer** (`agent-surface`, AS) -- conditional: applies when inspection finds an implemented agent-facing surface

This domain applies only when the inspected implementation exposes tools to an
agent. Record the detection evidence or concrete reason it is not applicable.

Scope: tool inventory and overlap; tool naming against the
execute-vs-initiate distinction; input schemas versus in-handler
validation; error paths and whether their text is actionable
(recovery instructions, not stack traces); registration lifecycle
against page state; whether the pre-standard `document.modelContext`
global is confined to one adapter; presence and coverage of tool evals.
Commands: read the tool registration sites and their handlers. Read-only,
like the other specialists. Does not run the documented test selection — Rule #73 reserves
that for QA.
Excludes: general component structure and bundle composition, which stay
with Staff Frontend; server-side API design, which stays with Staff
Backend. The boundary is the tool contract itself.

Rule: All specialists are read-only. None may modify files. Commands run
sequentially within each specialist, never as parallel Bash calls
(Error #63, Rule #73).

## Step 2: Output Contract (Per Specialist)

Each specialist returns findings in this format:

### Domain Model

One paragraph: factual description of the domain boundary — entry points,
data flow, key files. System-map-first per D7.

### Findings

One entry per finding (use `####` heading + structured fields):

```markdown
#### <Finding-ID> <Title>
- **Severity:** launch-blocker | high | medium | low | strategic
- **Time horizon:** Before launch | After launch | Later
- **Evidence type:** [evidence] | [inference]
- **Files:** path/to/file.ts:42, path/to/other.ts:110-130
- **What's happening:** <factual description>
- **Why it matters:** <impact, tied to severity>
- **Recommendation:** <concrete fix direction>
- **Regression risk:** <invariants that must still hold after the fix, the
  assumptions the recommendation depends on, and any property the fix trades
  away. If the fix swaps one mechanism for another, state what the replacement
  must cover for the swap to be valid. Write "none — isolated/additive change"
  only after confirming nothing downstream depends on the behavior you touch.>
- **Expected impact:** <what improves after the fix>
- **Effort estimate:** S | M | L | XL
```

Finding ID format: `<DOMAIN>-<SEVERITY_LETTER><COUNTER>`

- DOMAIN: `AR` | `FE` | `BE` | `PE` | `DO` | `SE` | `QA` | `UX` | `AS`
  (`AS` only when agent-surface coverage ran)
- SEVERITY_LETTER: `B` (launch-blocker) | `H` (high) | `M` (medium)
  | `L` (low) | `S` (strategic)
- COUNTER: 1-indexed per (domain, severity) pair

Examples: `SE-B1` (first security blocker), `UX-M3` (third UX medium),
`BE-H2` (second backend high).

Rules:

- Every finding must include `file:line` refs — no refs = no finding.
- Evidence/inference labeling is mandatory on every finding.
- Prefer systemic findings: one pattern covering 5 instances > five
  separate nitpicks.
- **Regression risk** is mandatory and is not boilerplate. A blanket
  "none" on a finding that changes runtime behavior is a contract failure
  — name the invariant or the trade. This is the field `rpi-remediate`
  verifies before it implements your recommendation.

This contract is machine-checkable: `rpi-remediate` runs
the bundled [finding validator](scripts/validate-findings.py) against the report before parsing and
rejects any finding with a malformed or duplicate Finding-ID, a missing or empty
required field, or no `file:line` ref. Emit findings in exactly this format.

### Cross-Domain Notes (optional)

Findings touching another specialist's domain — noted briefly, referenced
by target domain.

## Step 3: Synthesis

After all assigned domain reviews complete,
write `docs/agents/pre-launch-report.md` with this structure:

```markdown
      # Pre-Launch Codebase Audit
      > Generated on [date] | Branch: `[branch]` | [actual assignments and covered domains; agent-surface applicability]
      > Focus: the request or "comprehensive"

      ## 1. Executive Summary
      - Overall assessment (1 paragraph, critic tone)
      - Top 3 strengths (concrete, evidence-backed)
      - Top 5 risks (ordered by blast radius)
      - Verdict: READY / CONDITIONAL / NOT READY with 2-3 sentence rationale

      ## 2. System Architecture Overview
      - High-level summary distilled from Principal Architect's Domain Model
      - Major modules and responsibilities
      - How the pieces connect (data/control/integration flow)
      - Architecture concerns (cross-specialist, systemic only)

      ## 3. End-to-End Flow Analysis
      - Key user flows reviewed (from the request or inferred)
      - Request/data/control flow observations
      - Integration and boundary risks

      ## 4. Frontend / UI Findings (Staff Frontend Engineer)
      [All FE findings using the finding template from Step 2]

      ## 5. Backend / API / Data Findings (Staff Backend Engineer)
      [All BE findings]

      ## 6. Performance and Scalability Findings (Performance Engineer)
      [All PE findings]

      ## 7. Reliability / DevOps / Observability Findings (DevOps / SRE Lead)
      [All DO findings]

      ## 8. Security / Privacy Findings (Security Reviewer)
      [All SE findings]

      ## 9. Code Quality / Maintainability Findings (Principal Architect)
      [All AR findings]

      ## 10. Testing / QA Findings (QA / Reliability Lead)
      [All QA findings]

      ## 11. UX Cohesion / Design System Findings (Product Designer / UX Lead)
      [All UX findings]

      ## 11a. Agent-Facing Surface Findings (Agent Surface Engineer)
      [All AS findings. Omit this section entirely when agent-surface coverage did
      not apply.]

      ## 12. Prioritized Action Plan
      Table: | ID | Domain | Title | Severity | Time Horizon | Effort | Impact |
      Sort: severity desc (blocker first), time horizon asc
      (Before < After < Later), then effort asc.

      ## 13. Top 10 Highest-ROI Improvements
      Ranked 1-10: ID, Title, Rationale, Expected impact.
      References finding IDs only — no content duplication. Never pad to 10.

      ## 14. Before Launch / After Launch / Later Strategic
      ### Before launch (Wave 1)
      - <finding-ID>: <one-line title>
      ### After launch (Wave 2)
      - <finding-ID>: <one-line title>
      ### Later / strategic (Wave 3)
      - <finding-ID>: <one-line title>
      Index only. rpi-remediate uses this section to drive wave ordering.

      ## 15. Open Questions / Assumptions
      - Assumptions made during the audit
      - Missing context that limited stronger conclusions
      - Questions for the human before remediation starts
      Not findings. rpi-remediate ignores this section.

      ## 16. Final Verdict
      - Verdict (repeat from §1 for parser): READY | CONDITIONAL | NOT READY
      - What would most worry you about shipping today?
      - What gives you confidence?
      - Next 5 actions (ordered)
```

Save assignment/results coverage in `docs/agents/pre-launch-coverage.json` using
the dispatch schema. Resolve the bundled [dispatch validator](scripts/rpi-dispatch.py)
from this installed skill and run it against that artifact with
`--report docs/agents/pre-launch-report.md`. Do not hand an incomplete report to
remediation as a completed audit. Inspect every required result and resolve each
coverage gap first; no finding in a domain does not mean that domain was skipped.

## Step 4: After the Audit

The following describes what `rpi-remediate` will do — do not execute
during the audit.

Run `rpi-remediate` to process findings in 3 waves, driven by Section 14:

- **Wave 1 (Before launch)** — all findings marked `Before launch` in
  Section 14. Typically launch-blockers + high severity. Must pass
  before release.
- **Wave 2 (After launch)** — all findings marked `After launch` in
  Section 14. Typically medium severity. Complete authorized actionable fixes;
  a separate run requires an explicit deferral of that scope.
- **Wave 3 (Later / strategic)** — all findings marked `Later` in
  Section 14. Typically low + strategic. Complete authorized actionable fixes.
  Findings that require a new architectural or scope decision receive a local
  disposition and owner review before dependent work.

Severity and time horizon order work; they do not automatically exempt a finding
from resolution. Rule #58 requires every confirmed actionable finding within the
authorized scope to be resolved, false positives rejected with evidence, and
architectural exceptions or explicitly deferred scope recorded locally for owner
review. External issues or comments require explicit authorization.

## Rules

### Critic Mode

Assume public launch under load and scrutiny. Do not give benefit of the
doubt.

### Execution

- All assigned domain reviewers are read-only.
  No modifications during the audit.
- Run bounded independent assignments concurrently when useful; do not require
  a minimum team size or omit any applicable domain.
- Only the assignment owning QA runs the full documented test selection. The other
  specialists use scoped reads and non-test commands. (Rule #73)
- Commands run sequentially within each specialist, never as parallel
  Bash calls. (Error #63)
- Every finding must include `file:line` refs. No refs = no finding.
- Evidence/inference labeling is mandatory on every finding.
- System-map-first: every specialist reports a Domain Model before
  listing findings.
- Do NOT auto-fix during the audit. Synthesis only.

### Verdict Thresholds

- Any `launch-blocker` finding → NOT READY
- No blockers, any `high` severity marked `Before launch` → CONDITIONAL
- No blockers, no `high` Before launch items → READY

### Report Output

- Path: `docs/agents/pre-launch-report.md`
- Commit policy follows repo visibility (Rule #70): gitignored on public
  repos, tracked on private repos
- Markdown only. No XML tags.
- Finding IDs are the `rpi-remediate` parse anchor — never reuse an ID,
  never list a finding without an ID.

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
