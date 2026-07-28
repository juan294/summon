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
| Merge | squash only (merge commits and rebase are disabled repo-side) |
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
      gh pr merge --squash --auto
      ```

- [ ] Wait for it to land: `gh pr view --json state`

## 4. Fix the candidate

```sh
git checkout main && git pull --rebase
CANDIDATE=$(git rev-parse HEAD)
```

Everything downstream is evidence about this exact SHA. Squash means it is a new commit object
that no pre-merge run evaluated, which is why CI re-runs on `main` and why the evidence below is
bound to `$CANDIDATE`.

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
- [ ] `git checkout develop && git merge main` if the release commit changed anything on `main`

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
- **Branch protection asymmetry** — `main` requires 0 approving reviews, `develop` requires 1.
  Deliberate for a sole-maintainer repo; CI is the gate on `main`.
