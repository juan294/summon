<!-- rpi-overlay: skill=rpi-release; written-against=034673a9ed50 -->
# Project overlay for rpi-release

## Procedure

`docs/release/release-checklist.md` is this project's release procedure for
`summon-ws` releases (E2E Pro D01). Do not restate its steps here. Read it
completely before touching anything, and follow its preparation, merge,
candidate-fixing, evidence gate, cadence arc, tagging, post-publish verification
and rollback steps. The local-first gates and publication authorization of the
stock skill still apply to every remote action it lists. The gates in the stock
skill still apply. Where
`docs/release/release-checklist.md` is less strict than a stock gate, the stock
gate applies; report the difference to the owner.

- The branching strategy is fixed, not detected:
  `develop` -> `main` merge commit, then an annotated tag on `main`. Never squash
  the release PR. Feature PRs into `develop` may still squash.
- The release is BLOCKED unless `pnpm analyze:release` exits 0. There is no
  override, and an exception can never excuse a required probe.
- The tag is the last action before the GitHub Release, never the first. Before
  tagging, present the evidence summary and confirm that the publication
  authorization names this exact candidate.
- Creating the GitHub Release auto-publishes to npm through
  `.github/workflows/release.yml`, so the authorization to create it must also
  name npm publication. Do not run `npm publish` afterwards. The
  manual path in `docs/publishing.md` is an emergency fallback that loses
  provenance.
- Never use `--delete-branch` on a `develop` -> `main` release PR. `develop` is
  a permanent integration branch.
- Check for an existing PR before `gh pr create`. Verify the PR's required
  checks with `gh pr checks <n> --required`, not `gh run list --branch develop`:
  the latter returns the latest branch run, not what gates the merge.

Moved from the managed `.claude` and `.agents` copies of this skill on 2026-11-14 (summon commit 5227241).
