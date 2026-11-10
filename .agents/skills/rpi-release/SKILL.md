---
name: "rpi-release"
description: "Prepare and publish the explicitly requested version after complete local integration and release gates, exact-commit remote verification and publication authorization."
---

# Release the Requested Version

Use the version and release scope already supplied in the request. Ask for a
version only if absent; never guess or auto-increment. Prepare a concrete,
fully verified candidate before any still-required publication approval. Read the
[durable handoff](references/handoff.md) contract and revalidate actual worktree,
release version and candidate evidence when resuming; a prior summary is not a
new release authorization.

## Orientation and preparation

1. Read the project's shared instructions, release topology, previous release,
   complete diff/commit history and [release playbook](references/e2e-pro-playbook.md).
   Identify the actual version source: package.json, Cargo.toml, pyproject.toml,
   git tags, CHANGELOG or the project's documented equivalent.
2. Search the current bare and v-prefixed version across all tracked product files.
   Inventory manifests/lockfiles, README badges (label, image URL and tag URL),
   plugin/marketplace metadata, install instructions, constants, containers and
   compatibility tables. Distinguish intentionally pinned and historical values.
3. Inspect the actual integration/production topology, branch protection and remote
   workflow/deployment triggers. A working branch is not a publication target.
   Preserve required project merge semantics and permanent integration branches.
4. Review the retirement ledger and record what guidance was removed or retired
   this cycle, including "none" when appropriate. Keep stable rule/error identities.
5. Prepare all version-bearing files and a Keep a Changelog entry for the requested
   version/date, grouping actual changes as Added, Changed, Fixed or relevant
   categories. Include breaking changes and migration/support limits. If
   documentation is stale, complete authorized `rpi-update-docs` work first.
6. Present the release notes and full diff while completing the already-authorized
   local preparation. Apply user steering without adding an unnecessary pre-edit
   approval. Re-scan the old version and explain intentional historical/pinned
   references; fix every stale product occurrence.

## Local release gate

1. Read the project's adapted playbook and enforce Wave A's truthful gate on every
   release. Every claimed pass must name candidate identity, check selection and
   evidence, and every project check runs. Missing tools, zero inspected inputs,
   skipped required cases or tests against another candidate do not count as
   passing.
2. Keep release verification proportional. Run Wave B exploratory charters only
   when the project's adapted release profile selects them, for example for code
   that runs unattended or destructively on users' machines. Documentation-,
   template- and prose-only releases never need them. Waves C-H stay optional and
   run only when the same profile selects them.
3. When Wave B runs, run one round on the fixed candidate. Each charter covers all
   eight maneuvers, risk-based N/A reasons, synthetic fixture authorization,
   finding disposition and cleanup evidence. Give every finding a severity:
   - S1: data loss, a security boundary breach or a broken core workflow.
   - S2: a normal-use defect with no workaround, including a guardrail that
     falsely blocks ordinary work.
   - S3: a defect with a workaround, or a gap outside normal use.
   - S4: a cosmetic, wording or minor quality issue.

   Only S1 and S2 findings, an unclassified finding or a skipped high-risk area
   block publication. Record each S3 or S4 finding as an owner-approved accepted
   known issue in the release notes, with its severity and reason, and fix it in
   a later release. After repairs, verify only the repaired findings with
   targeted checks; a repair does not start a new full charter round. A
   best-effort guardrail, such as a shell-text policy hook, is not a security
   boundary: a new spelling that slips past it is S3 at most and never blocks a
   release. Record any explicitly accepted exception before tagging.
4. Discover and run every applicable local test, coverage, typecheck, lint, build,
   repository-invariant and deployment-preflight command. Preserve every exit;
   run resource-intensive checks sequentially. Reuse valid evidence only for the
   same candidate inputs and check selection. Do not invent application checks
   for a documentation project or skip the project's own invariant scripts.
5. Obtain independent review, inspect every required reviewer result and repair
   all confirmed actionable findings, or record an S3 or S4 finding as an
   owner-approved accepted known issue. A missing result is an acceptance gap.
   Preserve evidence-backed false-positive rejections and explicit architectural
   exceptions. Simplify changed content and verify changed inputs. Commit the complete preparation on its task-owned
   local branch, integrate locally, and bind final evidence to that integrated
   candidate. If the integration tip moved, reconcile and revalidate locally.
6. Preserve the plan, findings, notes and handoff outside disposable worktree-only
   state. Report candidate commit, version, notes, local gate results, accepted
   known issues, remaining limitations and expected remote actions as the
   concrete publication candidate.

## Authorized publication

1. Use explicit release/publication authorization already supplied. Ordinary
   implementation or integration publication does not authorize production.
   If required authority is absent, request it only after local preparation and
   gates are complete. Never push a working/release branch or create a feature PR.
2. Re-inspect workflow/deployment triggers for the final target and candidate.
   Never create Vercel Previews. If a push would create one, stop before pushing
   and use only a documented, non-destructive bypass. Do not change remote
   settings or bypass protection to publish. A required release PR is a
   publication constraint to report, not permission for a working-branch loop.
3. Publish the completed explicitly authorized branch once. For a main-only
   project whose release target is main, capture its exact commit before pushing:

   ```bash
   git rev-parse main
   git push origin main
   ```

4. Inspect every expected workflow/event/check for that exact pushed commit:

   ```bash
   gh run list --branch <published-branch> --commit <published-sha> \
     --json databaseId,headSha,name,status,conclusion
   ```

   Missing, pending, cancelled or failed required runs block the tag/release.
   Read existing logs and diagnose failures locally. Do not rerun hosted jobs or
   use iterative fix-and-repush publication as a debugging loop.
5. Only after all expected branch checks pass, create the annotated named tag at
   the verified published commit, push that tag by name and publish release notes:

   ```bash
   git tag -a <requested-tag> <published-sha> -m <requested-tag>
   git push origin <requested-tag>
   gh release create <requested-tag> --verify-tag --title <requested-tag> \
     --notes-file <reviewed-release-notes-path>
   ```

   Use safely quoted discovered values or structured tool arguments. Never use
   `git push --tags` or broad tag-following. The release CLI uses `--notes-file`,
   not the PR/issue `--body` flag. Inspect any expected tag-triggered runs as well.
6. Registry publication remains advisory unless separately authorized by the
   request; do not infer npm/cargo/PyPI publication from GitHub release authority.

## Completion

Update the durable handoff and report the version, exact commit/tag, release link,
local gate evidence and actual remote outcomes. Distinguish prepared, published,
pending and blocked states.
Retain unresolved diagnostics and recovery artifacts; a locally repaired failure
does not retroactively make a failed remote run green.
