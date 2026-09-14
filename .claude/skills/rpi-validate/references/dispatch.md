# Bounded assignment and audit handoffs

Use a structured handoff when coordinating delegated results or proving audit
coverage. A tiny parent-owned edit does not need a separate JSON artifact. The
parent still checks the applicable phase, review and verification requirements.

The bundled `scripts/rpi-dispatch.py` checks a completed JSON handoff. It does not
create agents, run commands, verify the truth of evidence strings, measure the
worktree, grant permissions or replace an adopter's release charter. In particular,
it never relaxes a project's eight-maneuver release validator. Read referenced
evidence and compare actual changed scope before accepting a successful result.

## Invocation

Resolve the helper relative to the active installed skill directory. Run it with
the local handoff path; for pre-launch audits, also pass the Markdown report using
`--report`. The existing `validate-findings.py` remains usable independently with
its unchanged report argument and `--self-test` interface. Dispatch loads that
validator beside itself when a report or finding dispositions are supplied.

```sh
python3 scripts/rpi-dispatch.py docs/agents/dispatch.json --report docs/agents/pre-launch-report.md
```

On resume, measure the actual candidate using the project's candidate helper or
documented equivalent and pass its identity with `--current-candidate`. An omitted
argument performs structural checks only; it cannot prove that the saved handoff
still matches the checkout. A mismatch invalidates the saved acceptance claim.
Follow the [durable handoff procedure](handoff.md) before continuing.

Exit 0 means the supplied structure is complete, 1 reports acceptance gaps, and 2
reports unreadable or malformed input. None of these exit codes authorizes work.

## Schema version 1

The top-level object has `schema_version: 1`, nonempty `objective` and `candidate`,
`phase`, `approved_phases`, `resource_limit`, `assignments` and `results`.

- `phase` is one of `research`, `assess`, `plan`, `implement`, `pre-launch`,
  `remediate`, `simplify`, `update-docs`, `release`, `validate`. It must occur in
  `approved_phases`, which records the existing authorized scope. If `next_phase`
  is supplied, it must also be approved; otherwise stop at the acceptance boundary.
- `candidate` identifies the tested source inputs, including relevant uncommitted
  changes. A commit hash alone does not identify a dirty worktree.
- `resource_limit` is the effective simultaneous **implementer** limit, an integer
  from 1 through 3 after accounting for available slots and resource contention.
  It is not an investigator quota or a requirement to use three agents.
- Each assignment has a unique `id`, `owner`, `role` (`investigator`, `implementer`
  or `reviewer`), `objective`, `allowed_actions`, `allowed_files`,
  `evidence_contract`, `resource_constraints`, `completion_condition`, `domains`,
  `root_causes`, and `concurrency_group`. Text fields are nonempty. Actions/files
  are nonempty string lists; domains/root causes may be empty lists. Domains use
  the existing AR/FE/BE/PE/DO/SE/QA/UX/AS tokens. Use the same concurrency group for
  assignments that may overlap in time. Different groups mean sequential work,
  not permission to hide simultaneous implementers from the limit.
  The limit counts distinct implementer owners, so one owner may hold multiple
  bounded work units without being counted as multiple agents.
- File scope uses literal repository-relative paths; a trailing slash includes a
  directory's descendants. Globs are not expanded. Absolute and traversal paths
  in changed-file results are rejected. Actions are descriptive names; `write`
  must be declared when reporting changed files. Audit actions are `read` or
  `check`, and must not mutate source. Runtime permission guards remain separate.
- Each result has `assignment_id`, `status`, `candidate`, `evidence`, `domains`,
  `root_causes`, `actions`, and `changed_files`. The last five fields are string
  lists; evidence must be nonempty. A result counts only if its status is
  `complete`, its candidate matches, and its claimed actions/files stay in scope.
  All assigned domains and root causes must be returned. Failed, stale, duplicate,
  missing or out-of-scope results block acceptance. Report a failed result rather
  than quietly removing its assignment or dropping the affected coverage.

Group failures by likely cause. Twenty tests broken by one fixture may belong to
one assignment with one `root_causes` token and evidence from all affected tests.
The parent verifies that grouping rather than equating test count with team size.
Implementation and remediation require a completed current-candidate `reviewer`
result from an owner who is not an implementer in this handoff. A failed reviewer
does not become a completed review because another agent completed their work.

## Audit coverage

Pre-launch handoffs add `audit.agent_surface` containing boolean `applicable` and
a nonempty `evidence` list recording inspected detection evidence or absence. All
eight core domains are required; AS is additionally required when applicable.
A domain with no corresponding implementation is still inspected and reported as
completed with the evidence of absence. Core domains cannot be dropped as N/A.
One investigator can cover multiple compatible domains, including all eight when
scope permits. This is coverage of domains, not a fixed number of model instances.

Pass `--report` for every audit. Finding IDs, required fields and `file:line`
references are validated without changing their existing grammar. Duplicate IDs
and empty required fields are rejected. AS findings require applicable completed
AS coverage. The report keeps its existing 16-section structure and remediation
anchors. An incomplete audit must not claim READY or a completed acceptance.

This complete example records one investigator covering a small command-line
project. Replace its factual claims with actual observations when using it.

```json
{
  "schema_version": 1,
  "objective": "Audit launch readiness of the local command-line parser",
  "phase": "pre-launch",
  "approved_phases": ["pre-launch"],
  "candidate": "parser-audit-snapshot-1",
  "resource_limit": 1,
  "audit": {
    "agent_surface": {"applicable": false, "evidence": ["src/main.py:1: command-line entry point; no agent tools"]}
  },
  "assignments": [{
    "id": "audit-core", "owner": "investigator", "role": "investigator",
    "objective": "Inspect all core domains, including evidence of absent UI and services",
    "allowed_actions": ["read", "check"], "allowed_files": ["src/", "tests/"],
    "evidence_contract": "Domain models, source references, local check results and findings",
    "resource_constraints": "One local check at a time; no remote compute",
    "completion_condition": "Return coverage and all findings for every assigned domain",
    "domains": ["AR", "FE", "BE", "PE", "DO", "SE", "QA", "UX"],
    "root_causes": [], "concurrency_group": "audit"
  }],
  "results": [{
    "assignment_id": "audit-core", "status": "complete", "candidate": "parser-audit-snapshot-1",
    "evidence": ["src/main.py:1", "docs/agents/parser-audit-checks.log"],
    "domains": ["AR", "FE", "BE", "PE", "DO", "SE", "QA", "UX"],
    "root_causes": [], "actions": ["read", "check"], "changed_files": []
  }]
}
```

## Applicable acceptance records

Record these fields when the corresponding work applies. The parent determines
applicability from the actual request and diff; omitting a record cannot excuse a
required check or create an exemption.

- Behavioral code changes: set `behavioral_change: true`, and supply
  `tdd: {regression, red: {sequence, evidence}, green: {sequence, evidence,
  candidate}}`. Sequence values are nonnegative integers, RED precedes GREEN,
  and GREEN matches the current candidate. Both evidence fields identify actual
  captured results for the named regression; an ordering claim alone is not TDD.
- Finding dispositions: `findings` is a list of `{id, disposition, evidence}`.
  Disposition is `resolved`, `rejected` with false-positive evidence, or
  `architectural_exception` with nonempty `owner_review` recording the actual
  decision. Supply the source report with `--report` to check every report ID has
  exactly one disposition. Unresolved actionable findings block acceptance.
  Explicitly deferred waves remain outside this completed-work artifact until
  their authorized work is done; do not label them resolved.
- Simplify: `simplify: {mode, changed_files, invalidated_checks, checks}` with mode
  `parent` or `standalone`. The parent mode returns exact changed scope and
  invalidated check IDs. Aggregate changed files must equal the union of changed
  files in successful scoped results; omitted or invented scope is rejected.
  Standalone requires each invalidated check in `checks`
  as `{id, status: "pass", candidate, evidence}` for the current candidate.
- Existing decisions: optional `context: {supplied_version, docs_authorized}`
  records the supplied version and boolean docs authorization. Optional
  `decisions_requested` lists pending decision names. `release_version` and
  `docs_authorization` are rejected there when already supplied. New production
  authorization remains a separate decision; these fields are never consent.

Adopter-specific release tests, permission approvals and full local verification
remain required independently of this artifact's structural validation.
