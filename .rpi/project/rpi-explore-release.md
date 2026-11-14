<!-- rpi-overlay: skill=rpi-explore-release; written-against=a3c686faf4f7 -->
# Project overlay for rpi-explore-release

## Procedure

summon is a macOS CLI that drives Ghostty through AppleScript. It has no
browser, datastore, auth or vendor API. The rules below refine the generic steps
of the stock skill.

### Maneuver adaptation

| # | Generic | summon |
|---:|---|---|
| 1 | Try the action twice | Launch the same project twice. No duplicated panes and no corrupted status records. |
| 2 | Edit after every error | After a failed launch, fix the config and relaunch. Stale state must clear. |
| 3 | Interrupt mid-flow | SIGINT during launch and Ctrl-C at a prompt. No orphaned `.tmp`, `.pid` or `.active` files. |
| 4 | Second session or role | Two concurrent `summon` invocations. Check concurrent-write safety (the #524 class). |
| 5 | Locale and viewport | Shell, terminal size and Node version: zsh vs bash, a narrow terminal (monitor TUI truncation), Node 22 vs 24. |
| 6 | Compare copy with outcome | Error messages match real behavior. `summon doctor` claims match reality. |
| 7 | Read back downstream state | Inspect `~/.config/summon/**` inside the isolated home: schema `version` present, no leaked keys, no residue. |
| 8 | Should this exist? | Challenge unsafe behavior, for example the install-software-on-launch prompt (`ensureCommand` in `src/command-install.ts`). |

### Safety additions

- Use synthetic fixtures named `summon-rel-<RUN_ID>` (`FIXTURE_PREFIX` in
  `src/release/helpers.ts`).
- Run against an isolated `HOME`, never the real `~/.config/summon`.
  `ensureConfig()` creates config files on the first read and the cache flushes
  at exit, so even `list` and `config` mutate the maintainer's state. Reuse the
  `makeIsolatedHome()` harness in `src/release/helpers.ts`.
- Out of bounds without explicit authorization: `summon trust` against a real
  project directory (it grants execution rights); accepting the install-software
  prompt (`npm install -g ...`, `brew install ...`), which mutates the global
  toolchain; `summon doctor --fix`, which rewrites `~/.config/ghostty/config`;
  any `npm publish`, `git tag` or `git push`.
- Real-Ghostty charters run only on the maintainer's Mac. Their findings are
  observations, not fixes.

### Wiring charters into the release gate

For each charter:

1. Write the report to `docs/release/charters/<candidate>-<charterId>.md`.
2. Validate it. A report missing a maneuver row is not a charter:

   ```bash
   node scripts/release/validate-charter.mjs docs/release/charters/<file>.md
   ```

3. Add one result row per charter to the evidence manifest so the release
   analyzer sees it:

   ```jsonc
   { "probeId": "charter.<id>", "required": true,
     "status": "passed",                       // "failed" if the charter is BLOCKED
     "oracles": { "report": "docs/release/charters/<file>.md" },
     "fixtures": [ { "id": "summon-rel-<RUN_ID>-1", "cleanupStatus": "removed" } ] }
   ```

`pnpm analyze:release` then blocks on a failed charter (`REQUIRED_MISS`), missing
cleanup evidence (`DIRTY_FIXTURE`) or an expired exception. Hand the evidence to
`rpi-release`; see `docs/release/release-checklist.md`.

Moved from the managed `.claude` and `.agents` copies of this skill on 2026-11-14 (summon commit 5227241).
