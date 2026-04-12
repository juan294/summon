# Pre-Launch Codebase Audit

Senior cross-functional launch-readiness audit before any public release.
8 parallel specialists, 16-section deep-dive report, 3-wave remediation
handoff.

Model tier: **opus** — Claude Opus 4.6. All specialists: `model: "opus"`.

## Mindset

> Assume this product will be publicly launched soon and judged by users
> and engineers with high standards. Be skeptical. Look for hidden
> complexity, inconsistent craftsmanship, operational fragility, and
> scaling risks. Do not give the benefit of the doubt where the code or
> structure does not justify it. Prefer systemic findings over isolated
> nitpicks — if the same issue appears in 5 places, report it once as a
> systemic pattern, not five times as nitpicks.

## Input

Optional `$ARGUMENTS`: focus area hint (e.g., "focus on backend"). Biases
synthesis emphasis — does not disable any specialist.

## Step 1: The Team

Spawn all 8 as parallel background Task agents (`subagent_type:
general-purpose`, `model: "opus"`, tools: Read/Grep/Glob/Bash —
read-only commands only).

Each specialist opens with the **system-map-first preamble**:

> Before judging details in your domain, build a mental model: identify
> entry points, map data/control flow within your scope, and note the
> major boundaries. Report this model in your finding set under a
> `## Domain Model` subsection.

**Specialist 1 — Principal Architect** (`architect`, AR)

Scope: system-wide architecture, module boundaries, coupling, dependency
health, circular deps, dead code detection, typecheck.
Commands: `$TYPECHECK_CMD`, `$PKG_MANAGER outdated`.
Excludes: FE-specific and BE-specific code concerns (delegated to
Staff FE and Staff BE).

**Specialist 2 — Staff Frontend Engineer** (`staff-frontend`, FE)

Scope: component structure, state management, routing, client-side perf,
hydration, bundle composition, FE-specific patterns.
Commands: read FE source tree, bundle analyzer output if available.
Excludes: visual design and a11y (UX Lead), backend API shape (Staff BE).

**Specialist 3 — Staff Backend Engineer** (`staff-backend`, BE)

Scope: API design, validation, error handling, retry/idempotency, DB
access patterns, transactions, queues, background jobs, service
boundaries.
Commands: read BE source tree, schema files, migration directory.
Excludes: deployment/CI (DevOps/SRE Lead), latency profiling
(Performance Engineer).

**Specialist 4 — Performance Engineer** (`performance-eng`, PE)

Scope: bundle sizes, unused exports, code splitting, p95/p99 latency
risks, cache strategy, hot-path identification, startup cost,
CPU/memory/IO/network inefficiencies.
Commands: `$BUILD_CMD` (parse output for sizes and signals).

**Specialist 5 — DevOps / SRE Lead** (`devops-sre`, DO)

Scope: deployment safety, rollback strategy, env config, secrets
handling, migrations, CI/CD, health checks, observability, tracing,
logging, alerting, runbook readiness, incident response readiness.
Commands: `gh run list --branch <integration-branch> --limit 5`, audit
env var docs vs actual usage, verify error pages exist, check git state
clean.

**Specialist 6 — Security Reviewer** (`security-reviewer`, SE)

Scope: `$PKG_MANAGER audit`, hardcoded secrets, auth/authz gaps,
sensitive-data handling, injection (SQL/XSS/SSRF/CSRF), unsafe defaults,
CORS, dependency licenses.
Commands: `$PKG_MANAGER audit`, grep for secret patterns.
Note: A dedicated security review is still required before launch. This
audit catches obvious issues only.

**Specialist 7 — QA / Reliability Lead** (`qa-reliability`, QA)

Scope: `$TEST_CMD` + `$TYPECHECK_CMD` + `$LINT_CMD`; coverage of
critical workflows; graceful degradation; failure modes;
retry/idempotency coverage; high-risk untested files.
Commands: `$TEST_CMD` (full suite — the ONE specialist authorized;
Rule #73).
Rule #73: other 7 specialists MUST NOT run `$TEST_CMD` in parallel.

**Specialist 8 — Product Designer / UX Lead** (`ux-lead`, UX)

Scope: visual hierarchy, screen-to-screen consistency, component reuse,
design-system signals, spacing/typography/control consistency,
interaction conventions, messaging/voice, empty/loading/error states,
responsiveness, accessibility (ARIA, focus, keyboard nav,
`prefers-reduced-motion`, alt text), perceived performance, UX friction,
conversion blockers.
Commands: read UI source tree, component library, design tokens.

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
- **Expected impact:** <what improves after the fix>
- **Effort estimate:** S | M | L | XL
```

Finding ID format: `<DOMAIN>-<SEVERITY_LETTER><COUNTER>`

- DOMAIN: `AR` | `FE` | `BE` | `PE` | `DO` | `SE` | `QA` | `UX`
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

### Cross-Domain Notes (optional)

Findings touching another specialist's domain — noted briefly, referenced
by target domain.

## Step 3: Synthesis

After all 8 specialists complete, write `docs/agents/pre-launch-report.md`
with this structure:

```markdown
      # Pre-Launch Codebase Audit
      > Generated on [date] | Branch: `[branch]` | 8 parallel specialists
      > Focus: $ARGUMENTS or "comprehensive"

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
      - Key user flows reviewed (from $ARGUMENTS or inferred)
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
      Index only. /remediate uses this section to drive wave ordering.

      ## 15. Open Questions / Assumptions
      - Assumptions made during the audit
      - Missing context that limited stronger conclusions
      - Questions for the human before remediation starts
      Not findings. /remediate ignores this section.

      ## 16. Final Verdict
      - Verdict (repeat from §1 for parser): READY | CONDITIONAL | NOT READY
      - What would most worry you about shipping today?
      - What gives you confidence?
      - Next 5 actions (ordered)
```

## Step 4: After the Audit

The following describes what `/remediate` will do — do not execute
during the audit.

Run `/remediate` to process findings in 3 waves, driven by Section 14:

- **Wave 1 (Before launch)** — all findings marked `Before launch` in
  Section 14. Typically launch-blockers + high severity. Must pass
  before release.
- **Wave 2 (After launch)** — all findings marked `After launch` in
  Section 14. Typically medium severity. Post-release sprint; user may
  defer to a separate `/remediate` run.
- **Wave 3 (Later / strategic)** — all findings marked `Later` in
  Section 14. Typically low + strategic. GitHub issues filed; no
  worktree fix agents. Requires human architectural judgment.

Rule #58 100% coverage preserved: every finding gets a GitHub issue.
Wave 3 items are filed but not auto-fixed — the one documented exception
to Rule #58.

## Rules

### Critic Mode

Assume public launch under load and scrutiny. Do not give benefit of the
doubt.

### Execution

- All 8 specialists are read-only. No modifications during the audit.
- All 8 run in parallel as background Task agents.
- Only QA / Reliability Lead runs the full `$TEST_CMD`. Other 7 use
  scoped reads and non-test commands. (Rule #73)
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
- Not committed to git (Rule #70)
- Markdown only. No XML tags.
- Finding IDs are the `/remediate` parse anchor — never reuse an ID,
  never list a finding without an ID.
