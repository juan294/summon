---
name: "rpi-update-docs"
description: "Refresh documentation, diagrams, version references and existing inline documentation from verified changes since the last release."
argument-hint: "[request]"
disable-model-invocation: true
---
The request is supplied as literal arguments: $ARGUMENTS


# Update All Documentation

Use the requested change range, or the last release when no range is supplied,
to update affected documents, diagrams, version references and existing inline
documentation. Read controlling project instructions/contracts completely and
revalidate the actual worktree before reusing a prior update plan.

## Step 1: Discovery

Cover the applicable discovery lenses below, recording when a lens has no
relevant surface. A narrow docs update can stay with the parent; a broad update
can group compatible lenses into independent read-only assignments. Each names
its objective, permitted actions/files, evidence/output, resource limits and
completion condition. Stay within available slots and report missing or failed
results as coverage gaps. No product files are modified during discovery.

### Discovery lenses

These are coverage areas, not a fixed number of agents:

1. **change-analyst** -- Find the last release tag (or first commit if no tags). Get the full
   diff and commit log since then. Categorize all changes by area: new features, bug fixes,
   refactors, config changes. For each changed file, summarize what changed and why (from commit
   messages). Identify breaking changes, new APIs, and removed functionality.

2. **doc-inventory** -- Find ALL documentation in the project:
   - Markdown files (`*.md`) and their purpose (user guide, API docs, architecture, etc.)
   - RST/txt doc files if they exist
   - README, GUIDE, CHANGELOG, CONTRIBUTING, API docs
   - Doc site configs (docusaurus.config.js, mkdocs.yml, vitepress, etc.)
   - Inline doc patterns: JSDoc blocks, Python docstrings, Rust `///` doc comments, Go doc comments
   - Map each doc to what code or feature it documents
   - Flag docs that reference changed files or modules

3. **diagram-analyzer** -- Find all diagrams in the project:
   - Mermaid code blocks in markdown files (` ```mermaid `)
   - Standalone diagram files (`*.mmd`, `*.mermaid`)
   - For each diagram: identify what components, modules, or flows it depicts
   - Cross-reference with changed files: which diagrams show stale information?
   - Identify diagrams that need new or removed nodes/edges

4. **version-scanner** -- Find all version references in the project:
   - Search for current version string across all files
   - Search for previous version strings that may be stale
   - Find shield.io/badge URLs with version numbers
   - Find installation instructions with version-pinned examples
   - Find constants files (`__version__`, `VERSION`, `version.ts`, `version.go`)
   - Find docker tags, CI matrix versions, compatibility tables
   - Classify each reference as: current, stale, or intentionally pinned

### Synthesis

Inspect each required discovery result and resolve any coverage gap, then
synthesize the findings into an update plan using actual values:

```markdown
## Documentation Update Plan

### Changes Since [last-tag]:
[Categorized summary from change-analyst]

### Documents to Update:
| Document | Reason | Update Type |
|----------|--------|-------------|
| README.md | New feature X not documented | Content + badge |
| docs/architecture.md | Module Y refactored | Content + diagram |
| src/api.ts | JSDoc for methodZ is stale | Inline docs |

### Diagrams to Update:
| Location | Diagram Type | Change Needed |
|----------|-------------|---------------|
| docs/arch.md:45 | Mermaid flowchart | Add new service node |

### Version References:
| File:Line | Current | Should Be | Status |
|-----------|---------|-----------|--------|
| README.md:4 | v1.5.0 | v1.7.0 | stale |

### No Update Needed:
[List docs that were checked and are already current]
```

Present the concrete update plan and proceed within the existing documentation
request. Ask only when a proposed change requires new scope or a material decision.

## Step 2: Documentation Updates

Update documents one at a time within the authorized documentation request.

For each document in the update plan:

1. Read the document in full unless an unchanged complete prior read is available.
2. Apply content updates: document new features, changed behavior, removed items.
3. Update Mermaid diagrams to match the current code structure.
4. Update version references and counts. Run the project's invariant scripts
   to catch references a manual sweep misses. Discover the complete local gate
   from repository instructions and CI; do not run it once per document. In cc-rpi,
   finalization uses `bash scripts/verify-local.sh`, including counts, versions,
   skills and generated distribution drift. Adopters use their actual gate.
   Fix every stale location the applicable checks report.
5. Preserve existing document structure, voice, and formatting.
6. For inline docs (JSDoc, docstrings, doc comments):
   - Update `@param`, `@returns`, `@example` to match current signatures.
   - Update Python docstrings (match existing style: Google, NumPy, or Sphinx).
   - Update Rust `///` and Go `//` doc comments.
   - Do NOT add new docstrings to functions that do not already have them.
     Scope is refresh, not expansion.
7. Run the project's configured Markdown checks; do not invent markdownlint
   defaults where no configuration exists.

For diagrams that cannot be confidently updated, add a comment:
`<!-- [NEEDS REVIEW] Diagram may not reflect recent changes to [component]. -->`
and include it in the final report.

Present the resulting change summary and complete final verification before
requesting any still-required publication approval.

## Step 3: Finalization

Obtain independent review of the changed documentation against actual behavior
and the update plan. Inspect every required reviewer result; missing review stays
an acceptance gap. Repair confirmed findings, preserve evidence for rejected false
positives, and run the native simplify pass or Codex helper on the changed scope
before final verification. An implementation parent may own this review/gate;
return exact changed files and invalidated evidence rather than claiming its pass.

1. Run verification commands sequentially (chain with `&&` or aggregate failures explicitly, never parallel Bash calls):

   Discover the project's complete applicable local gate and run it, including
   configured Markdown/link checks. Reuse evidence only for unchanged tested inputs.

2. Present the full diff of all changed files.

3. Save the update report to `docs/agents/update-docs-report.md`:

   ```markdown
   # Documentation Update Report
   > Generated on [date] | Branch: [branch] | Changes since [last-tag]

   ## Summary
   - [N] documents updated
   - [N] diagrams refreshed
   - [N] version references corrected
   - [N] inline doc blocks updated
   - [N] items flagged [NEEDS REVIEW]

   ## Changes by File
   [For each file: what was changed and why]

   ## Flagged for Review
   [List of [NEEDS REVIEW] items with context]
   ```

4. Apply the [durable handoff](references/handoff.md) contract in the update report,
   then commit the reviewed local changes when
   included in the request; otherwise present the complete diff for review.
   - Recommend running `rpi-release` next if a new version is being prepared.
   - If any items are flagged `[NEEDS REVIEW]`, advise the user to review those diagrams
     before running `rpi-release`.
   - Mention that `rpi-pre-launch` catches issues that `rpi-update-docs` does not (security,
     performance, accessibility).

## Rules

- **Read-only discovery.** Agents in Step 1 MUST NOT modify any files -- they audit and report.
- **Present plan before changes.** Existing authorization covers routine
  documentation updates; preserve the boundary for new scope or publication.
- **Preserve voice and structure.** Update content within the existing document format. Do not rewrite the style or reorganize sections.
- **Refresh, not expand.** Do NOT create new documentation files unless changes clearly warrant it (e.g., a major new feature with no existing docs). Do NOT add new inline docstrings -- only update existing ones.
- **Flag uncertainty.** Mark diagrams as `[NEEDS REVIEW]` rather than guessing when the change is too complex to confidently update.
- **Trace to real changes.** Every update must trace back to an actual code change. No speculative or cosmetic updates.
- **Sequential verification.** Run verification commands sequentially, never as parallel Bash calls.
- **Save the report.** Always write the update report to `docs/agents/update-docs-report.md`.

## Execution and acceptance

Use the scope and authorization already supplied in the request. Resolve routine
implementation choices from repository evidence. Complete authorized local work,
review, repair and applicable verification before its acceptance gate. An explicit
instruction can authorize continuation across phases; otherwise stop at the stated
phase boundary. Production, publication, destructive actions and new scope retain
their actual authorization requirements. Preserve durable artifacts before cleanup.
