# Notes: Rex workspace picker

Plan: `docs/plans/2026-11-18-rex-workspace-picker.md` (gitignored in the primary checkout).

## Handoff

- Objective: a Rex palette action that lists registered projects and opens the chosen one through `summon open <name>` in a focused launcher tab.
- Approved scope: the owner said "resume work" on 2026-11-19 after updating Rex. Read as authorization for Phase 1. Phases 2 and 3 are not started. No push, no release.
- Base: `develop` at `0bd8224`. Worktree: `/Users/juan/code/summon-list-json`, branch `feat/list-json`.
- Runtime on 2026-11-19: Rex CLI and server `0.1.0-preview.21`, API revision 18. App `0.1.0 (2042)` connected. `rex.ui.pick` is a function in the CLI script runtime (Lua 5.1, no `jit`). Native prompt rendering is not yet observed.

## Phase 1: `summon list --json`

- TDD: `src/commands/project-list.cli.test.ts` ran against the unsplit bundle under a synthetic HOME. Before the change, the 2 human-output baselines passed and the 6 JSON cases failed (stdout was the human list).
- Change: `handleListCommand` takes the command context (default `{ values: {} }` for zero-argument callers) and, with `--json`, writes `JSON.stringify([{name, directory}...])` plus a newline through `process.stdout.write`. Help (`summon list [--json]`, overview line) and the shared `--json` completion description (`Print JSON (inspect, list)`) document it.
- Independent review: no correctness findings. Three low-severity test gaps were repaired: completion description now asserted, a launched registration (with a status record) is compared with a never-launched one, and a positive control proves the sentinel `rex` is found first on PATH and records a call. The reviewer also confirmed by hand that `doctor` trips the sentinel and `list --json` does not.
- Not covered, by design (reported as read; the action validates): CRLF registries, duplicate keys (Map keeps first position, last value), empty key.
- Deviation: none from the phase file.
- Gate on the committed tree, sequential: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build` 0, `pnpm test` 0 (100 files, 3845 passed, 20 skipped). `pnpm test:coverage`: statements 97.21, branches 92.91, functions 98.24, lines 98.57 (thresholds 95/90/95/95). The pre-commit hook re-ran typecheck, lint, build and test, all passing.
