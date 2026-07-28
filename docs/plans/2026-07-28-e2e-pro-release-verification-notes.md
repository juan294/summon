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
