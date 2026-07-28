# Implementation notes — `2026-07-28-e2e-pro-release-verification`

## Deviations

### Phase 1 — `.gitignore` exception for `docs/release/evidence/` not needed

- **Plan said:** add a `.gitignore` exception so `docs/release/evidence/` is tracked (D-D).
- **Found:** `docs/release/` was never ignored. `git check-ignore -v docs/release/evidence/schema.md`
  returns non-zero — the directory is already tracked by default. Only `docs/agents/`,
  `docs/plans/`, `docs/research/`, `docs/decisions/`, `docs/prs/` are excluded.
- **Chose:** no exception added for evidence. Instead changed `docs/plans/` to `docs/plans/*` plus
  `!docs/plans/*-notes.md`, so this notes file survives worktree teardown for `/validate`.
- **Why:** adding a redundant negation would imply an exclusion that does not exist, and git cannot
  re-include a path whose parent directory is excluded — the `docs/plans/*` form is required for
  the notes file to be trackable at all.

### Phase 2 — vitest JSON reporter instead of a custom reporter

- **Plan said:** `src/release/manifest-reporter.ts`, a vitest custom reporter emitting the manifest.
- **Found:** Vitest 4's reporter interface changed shape, and a custom reporter registered in
  `vitest.config.ts` would attach to every run, not just release runs.
- **Chose:** `pnpm test:release` runs the built-in `--reporter=json` alongside `--reporter=default`,
  and `scripts/release/build-manifest.mjs` transforms that output into the manifest. Fixture
  cleanup state, which the JSON reporter cannot carry, travels in a `.release-fixtures.json`
  sidecar written by the probe suite's `afterAll`.
- **Why:** the built-in JSON output is a stable contract, the transformation stays a plain
  importable function (`groupIntoProbes`), and no global config is perturbed.

### Phase 2 — generated manifests are not committed

- **Plan said:** evidence tracked in-repo under `docs/release/evidence/` (D-D).
- **Found:** committing a manifest per CI run would add a SHA-named file on every push, and each
  is stale the moment its commit is superseded.
- **Chose:** `docs/release/evidence/schema.md` is tracked and `docs/release/evidence/` remains a
  tracked directory; per-run manifests are written to an explicit `--out` path (CI artifact,
  90-day retention) and only a real release's manifest is attached to its GitHub Release. The raw
  intermediates `.release-results.json` / `.release-fixtures.json` are gitignored.
- **Why:** preserves D-D's intent (evidence outlives Actions log retention and is reviewable)
  without turning the repo into a per-commit evidence dump.

### Phase 2 — probes run against an immutable CLI snapshot

- **Plan said:** probes invoke the built CLI at `dist/index.js`.
- **Found:** under the full suite this is flaky. `src/index.test.ts:14` runs `execSync("pnpm build")`
  in its `beforeAll`, and tsup cleans the output folder first, so `dist/` briefly disappears while
  the probes are spawning it. Caught by the pre-commit hook: 8 probes failed with
  "Cannot find module dist/index.js" even though an isolated `pnpm test:release` had passed.
- **Chose:** `helpers.ts` snapshots `dist/` to a per-worker temp directory on first use (with
  retry across the rebuild window) and every probe spawns that copy. Cleaned up in `afterAll`.
- **Why:** a required probe that flakes on a concurrent rebuild is exactly the unreliability this
  system exists to eliminate. Verified with three consecutive clean full-suite runs.

### Phase 3 — fail-closed decision extracted so it is testable

- **Plan said:** make the E2E fail when `SUMMON_E2E_REQUIRED=1` and the dictionary is unreachable.
- **Found:** on a Mac with Ghostty installed the dictionary IS reachable, so the failure branch --
  the single most important one -- could never be exercised by the suite itself.
- **Chose:** extracted `decideE2E(mode, dictionaryAvailable) -> "run" | "skip" | "fail"` as a pure
  function and unit-tested all six combinations, alongside the real suite.
- **Why:** proves the fail-closed invariant on any machine, without uninstalling Ghostty. The
  three-state contract is now verified rather than asserted.

### Phase 3 — release.yml gained a Ghostty install step

- **Plan said:** reorder release.yml so verification precedes publish.
- **Found:** `release.yml` ran `pnpm test:e2e` with no Ghostty install step at all, so unlike
  ci.yml it skipped 100% of the time by construction, not just in practice.
- **Chose:** added the same best-effort `brew install --cask ghostty` step ci.yml already had.
- **Why:** gives the advisory probe a chance to assert something; costs nothing when it fails.
