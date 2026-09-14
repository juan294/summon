---
name: "rpi-release"
description: "Prepare and publish the explicitly requested version after complete local integration and release gates, exact-commit remote verification and publication authorization."
argument-hint: "[request]"
disable-model-invocation: true
---
The request is supplied as literal arguments: $ARGUMENTS


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

1. Read the project's adapted playbook and enforce Wave A's truthful gate. Every
   claimed pass must name candidate identity, check selection and evidence. Missing
   tools, zero inspected inputs, skipped required cases or tests against another
   candidate do not count as passing.
2. Obtain required Wave B exploratory-charter evidence and selected structural
   Waves C-H according to the adaptation profile. Each charter covers all eight
   maneuvers, risk-based N/A reasons, synthetic fixture authorization, finding
   disposition and cleanup evidence. An untriaged FAIL or skipped high-risk area
   blocks publication. Record any explicitly accepted exception before tagging.
3. Discover and run every applicable local test, coverage, typecheck, lint, build,
   repository-invariant and deployment-preflight command. Preserve every exit;
   run resource-intensive checks sequentially. Reuse valid evidence only for the
   same candidate inputs and check selection. Do not invent application checks
   for a documentation project or skip the project's own invariant scripts.
4. Obtain independent review, inspect every required reviewer result and repair
   all confirmed actionable findings. A missing result is an acceptance gap.
   Preserve evidence-backed false-positive rejections and explicit architectural
   exceptions. Simplify changed content and verify changed inputs. Commit the complete preparation on its task-owned
   local branch, integrate locally, and bind final evidence to that integrated
   candidate. If the integration tip moved, reconcile and revalidate locally.
5. Preserve the plan, findings, notes and handoff outside disposable worktree-only
   state. Report candidate commit, version, notes, local gate results, remaining
   limitations and expected remote actions as the concrete publication candidate.

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
