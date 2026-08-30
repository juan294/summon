# Release checklist — summon

The single procedural authority for releasing `summon-ws`. Everything else links here rather than
restating it (E2E Pro D01). Keep this file at or under 200 lines (D02); feature detail belongs in
runbooks and ADRs.

- Architecture and rationale: `docs/release/e2e-pro-playbook.md`
- Topology decision record: `docs/decisions/release-topology.md`
- Evidence schema: `docs/release/evidence/schema.md`
- Packaging detail: `docs/publishing.md`

## Canonical commands

The one verification chain. Run sequentially, never as parallel Bash calls.

```sh
pnpm typecheck ; pnpm lint ; pnpm build ; pnpm test
```

Order matches `.husky/pre-commit` and `CLAUDE.md` — the two that actually execute. `build` is not
optional: it is the only check that catches build-only breakage.

## Topology

| | |
|---|---|
| Integration branch | `develop` (repo default) |
| Production branch | `main` |
| Merge | merge commit for `develop` -> `main`; feature PRs may still squash |
| Candidate | the **post-merge `main` SHA** |
| Tag | annotated, on `main`, created **after** evidence passes |
| Publish | automatic, on GitHub Release `published` -> `.github/workflows/release.yml` |

`npm publish` is **not** run by hand. The workflow is the only supported path; it carries OIDC
provenance. The manual fallback in `docs/publishing.md` is an emergency path that loses provenance.

## 1. Preflight

- [ ] Working tree clean; `git branch --show-current` is `develop`
- [ ] Ask the maintainer for the version number — never guess or auto-increment
- [ ] Baseline: `git describe --tags --abbrev=0`
- [ ] Confirm no release PR is already open: `gh pr list --base main --head develop`
- [ ] Confirm `gh api repos/juan294/summon --jq .allow_merge_commit` returns `true`
- [ ] Fetch origin, then prove the promotion is conflict-free and produces the exact `develop` tree:

      ```sh
      git fetch origin
      test "$(git merge-tree --write-tree origin/main origin/develop)" = \
        "$(git rev-parse origin/develop^{tree})"
      ```

      Stop if this fails. Do not open or merge a release PR with unresolved branch drift.

## 2. Prepare on `develop`

- [ ] Bump `package.json` version. Do **not** use `pnpm version` — it tags at bump time, on the
      wrong branch, before verification. Bump the field, tag later (step 6).
- [ ] Add the CHANGELOG entry (`release.yml` fails without one)
- [ ] Update version references: README badges (all occurrences on a line), install instructions,
      docs. Re-grep the old version and confirm only dated CHANGELOG history remains.
- [ ] Run the canonical chain above
- [ ] Present the full diff to the maintainer. **STOP for approval.**

## 3. Merge to `main`

```sh
git add <files> && git commit -m "release: vX.Y.Z -- <summary>"
git push origin develop
gh pr create --base main --head develop --title "release: vX.Y.Z" --body "<changelog entry>"
```

- [ ] Verify the PR's **required checks**, not just the latest branch run:

      ```sh
      gh pr checks <number> --required --watch
      ```

- [ ] Merge. Never pass `--delete-branch` — `develop` is permanent.

      ```sh
      gh pr merge --merge --auto
      ```

- [ ] Wait for it to land: `gh pr view --json state`

## 4. Fix the candidate

```sh
git checkout main && git pull --rebase
CANDIDATE=$(git rev-parse HEAD)
DEVELOP_COMMIT=$(gh pr view <number> --json headRefOid --jq .headRefOid)
git merge-base --is-ancestor "$DEVELOP_COMMIT" "$CANDIDATE"
test "$(git rev-parse "$CANDIDATE^{tree}")" = "$(git rev-parse "$DEVELOP_COMMIT^{tree}")"
```

Everything downstream is evidence about this exact SHA. The merge creates a new commit object
that no pre-merge run evaluated, so CI re-runs on `main` and the evidence below binds to
`$CANDIDATE`. The ancestry and tree checks reject a squashed release or unexpected `main` content.

## 5. Verify — the gate

```sh
pnpm build
SUMMON_RELEASE_CANDIDATE=$CANDIDATE pnpm test:release
SUMMON_RELEASE_CANDIDATE=$CANDIDATE pnpm release:manifest --out release-evidence.json
pnpm analyze:release --manifest release-evidence.json --candidate "$CANDIDATE"
```

The analyzer must exit 0. It blocks on: zero passes, any required failure or skip, a
candidate/deployment mismatch, missing oracle evidence, uncleaned fixtures, an overdue cadence
arc, or an expired/unapproved exception. A required probe can never be excused by an exception.

- [ ] Analyzer exits 0
- [ ] Exploratory charters, if the diff warrants them: `/explore-release <baseline> $CANDIDATE`

## 6. Cadence arcs

- [ ] `ghostty.real-launch` due within 30 days? If overdue, it blocks — run it now.

### Real-Ghostty arc

CI cannot do this: TCC Accessibility cannot be granted non-interactively, there is no GUI session,
and the AppleScript dictionary is unresolvable on a hosted runner. On a Mac with Ghostty 1.3.1+:

- [ ] `SUMMON_E2E_REQUIRED=1 pnpm test:e2e` passes
- [ ] A real `summon .` launch creates the expected panes, tabs, and window
- [ ] The Accessibility prompt appears on a machine that has not granted it
- [ ] `summon session --all` opens every project without a tab-creation failure
- [ ] Record the run date in the manifest's `cadence[].lastRunAt`

## 7. Authorize and tag

**STOP.** Present the evidence summary to the maintainer. Only after approval:

```sh
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z          # never `git push --tags`
gh release create vX.Y.Z --notes "<changelog entry>"
```

Annotated tags only. Creating the GitHub Release triggers `release.yml`, which re-runs the gate
and then publishes. Do **not** run `npm publish` afterwards — it has already happened.

## 8. Post-publish

- [ ] `release.yml` green, including "Verify published provenance matches the candidate"
- [ ] `npm view summon-ws version` matches the tag
- [ ] Evidence manifest attached to the GitHub Release

No routine `main` -> `develop` back-merge is needed. The promotion merge preserves the release
head as an ancestor of the `main` candidate, so the next release starts from the correct merge base.

## 9. Rollback

Trigger when: the published package fails to install, `summon --version` misreports, a critical
path regresses, or provenance does not match the candidate.

```sh
npm deprecate summon-ws@X.Y.Z "Broken release, use X.Y.(Z-1)"   # npm unpublish is not available after 72h
npm dist-tag add summon-ws@<last-good> latest
```

Then: verify `npm view summon-ws version`, confirm a clean install of the restored version, open
an incident issue, and preserve the failing evidence manifest. Do not re-tag the failed candidate —
cut a new patch version.

## Known artifacts

- **`v1.4.0`** — tag and GitHub Release exist; the publish run failed and the version was never
  published (`npm view summon-ws@1.4.0` returns 404). Left in place deliberately; deleting a public
  tag would break anyone referencing it. The step-5 gate exists so this cannot recur.
- **Branch protection** — neither branch requires an approving review. `develop`'s 1-review
  requirement was removed on 2026-08-10: GitHub forbids self-approval, so on a sole-maintainer
  repo it could only ever be satisfied by an admin bypass, which is not a gate. **CI status
  checks are the gate on both branches** and are deliberately left in place (see the release
  topology ADR). The branches still differ in one way that matters: `main` has
  `enforce_admins: true`, so admin bypass does *not* work there — a red check on `main` is
  final. `develop` has it false.
