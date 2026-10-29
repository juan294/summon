# Release New Version

Model tier: **sonnet** — Sonnet 5 (1M context) session.

Cut and publish a new `summon-ws` release.

> **This command deliberately does not restate the release procedure.** The single
> procedural authority is `docs/release/release-checklist.md` (E2E Pro D01).
> Follow it step by step. What is below is only orientation and the gates that
> must hold — duplicating the steps here is how the four contradictory versions
> of this process came to exist in the first place.

## Step 1: Orientation

1. Read `docs/release/release-checklist.md` completely before touching anything.
2. Current version: `node -p "require('./package.json').version"`.
3. Baseline: `git describe --tags --abbrev=0`.
4. Changes since then: `git log <baseline>..HEAD --oneline`, categorized by type.
5. Ask the user for the target version. **Never guess or auto-increment.**
   Suggest a bump from commit types (feat = minor, fix = patch, breaking = major).
6. **Identify every version-bearing file.** Do not rely on memory or a static list:

   ```bash
   V=$(node -p "require('./package.json').version")
   git grep -n -F "$V"; git grep -n -F "v$V"    # both bare and v-prefixed
   ```

   Commonly missed: README/docs shields.io badges, where the version can appear
   three times on ONE line (label text, the `img.shields.io` URL, and the
   `releases/tag/` href). Also install instructions, constants, and compatibility
   tables. Re-grep after the bump and confirm only dated CHANGELOG history remains.

7. **Retirement review.** Ask what rules, errors, or instructions came out of this
   cycle and should be recorded before the release is cut.

8. Present findings to the user: current version, commits since baseline,
   version-bearing files, and the proposed target version.

## Step 2: Execute the checklist

Work through `docs/release/release-checklist.md` in order. It owns preparation,
the merge, fixing the candidate, the evidence gate, cadence arcs, tagging,
post-publish verification, and rollback.

The branching strategy is not detected — it is fixed: `develop` -> `main` merge
commit, annotated tag on `main`. The checklist encodes it. Never squash the
release PR; feature PRs into `develop` may still squash.

Two hard stops are built in. Honour both:

- **After presenting the diff** (checklist step 2) — wait for explicit approval.
- **Before tagging** (checklist step 7) — present the evidence summary and wait
  for explicit approval.

## Rules

- The release is BLOCKED unless `pnpm analyze:release` exits 0. There is no
  override, and a required probe can never be excused by an exception.
- The tag is the **last** action before the GitHub Release, never the first.
- Creating the GitHub Release auto-publishes to npm via
  `.github/workflows/release.yml`. Do **not** run `npm publish` afterwards — it
  has already happened. The manual path in `docs/publishing.md` is an emergency
  fallback that loses provenance.
- Annotated tags only (`git tag -a`). Never `git push --tags`; push by name
  (Error #44).
- Never `--body` with `gh release create` — use `--notes` (Error #20).
- Never `--delete-branch` on a `develop` -> `main` release PR; `develop` is a
  permanent integration branch.
- Check for an existing PR before `gh pr create` (Error #53).
- Verify the PR's required checks with `gh pr checks <n> --required`, not
  `gh run list --branch develop` — the latter returns the latest branch run,
  not what actually gates the merge.
- ALWAYS present the diff before committing.
- Run verification commands sequentially, never as parallel Bash calls.
