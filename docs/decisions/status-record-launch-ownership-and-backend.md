# ADR: Status record launch ownership and backend fields

**Status:** Accepted
**Date:** 2026-10-29
**Status notes:** 2026-10-31, see the end of this record
**Plan:** `docs/plans/2026-10-29-rex-backend.md` (P6, P12, P13, P16; §3 "Status write protocol")

## Context

Summon records each workspace in `~/.config/summon/status/<project>.json` and derives liveness from two sidecars the root shell writes (`<project>.active`, `<project>.pid`). The record and the sidecars were keyed by project only, so two launches of the same project shared every artifact: a cleanup trap from an earlier shell could delete the marker of a newer launch, and its unconditional `summon snapshot save` could overwrite a newer snapshot. The Rex backend adds a second terminal whose workspaces are durable sessions, so the record also has to say which backend owns a workspace and which exact Rex resources belong to it.

## Decision

### Fields (schema version stays 1)

The status record gains four optional fields. Readers written for the previous shape ignore them, and records written by the previous shape stay valid, so the version is not bumped (see `schema-migration-strategy.md`: additive optional fields need no bump).

| Field | Type | Meaning |
| --- | --- | --- |
| `launchId` | UUID v4 | Launch generation. Absent on legacy records. |
| `backend` | `"ghostty"` or `"rex"` | Owning terminal. Absent means Ghostty. Any other value is dropped with a warning. |
| `rex` | object | Exact Rex identity: `server` (`unix://`, `tcp://` or `https://`), `hostId`, `sessionId`, `windowId`, `rootBlockId` (`<kind>:<36 chars>`), and `blocks` (unique pane-name to block-id pairs; every name is one of `panes`; the list may be a subset while pane files are still appearing). |
| `endedAt` | ISO 8601 | Set by lifecycle reconciliation once a workspace ended; absent while live. |

`native` (Ghostty surface identity) and `rex` are mutually exclusive. The effective backend decides which one survives parsing: a Rex record drops `native`, a Ghostty record drops `rex`, each with a warning.

### Per-launch artifacts

Every launch of both backends gets a `launchId`. Its artifacts live under `status/<project>.launches/`:

```
<project>.json                       shared record (written only by Node, under the lock)
<project>.json.lock/                 withFileLock directory while a writer holds it
<project>.launches/
  <launchId>.json                    Rex manifest, written by the launcher BEFORE session.create
  <launchId>.pid                     "$$" of the root shell; written by the bootstrap, removed by the trap
  <launchId>.active                  holds the launchId; written by the bootstrap, removed by the trap
  <launchId>.pane.<name>             "<REX_SESSION>\n<REX_BLOCK>\n", written by THAT pane's shell (.tmp then mv)
<project>.active, <project>.pid      legacy paths: used only by records without launchId
```

- The cleanup trap deletes only its own `.pid` and `.active`. It never names the pane files, the manifest, the shared record or the legacy paths, so a partial Rex session stays recoverable and a late trap cannot damage a newer launch.
- The root pane's file is the Rex ownership token. Token, manifest and pane files are kept until the session is confirmed gone on the manifest's server (Phase 3 adoption, Phase 5 cleanup).
- A record with `launchId` is live when its own `.active` names it and its own `.pid` is alive (Ghostty), or when the Rex session state says so (Phase 3). It never reads the legacy paths. A legacy record keeps the previous rule on the legacy paths.

### Write protocol

Shell code never writes the record. Every record write goes through `withOwnedRecord(project, expectation, action, afterWrite?)`, which runs inside `withFileLock(status/<project>.json)` and compares the current record with an expectation before doing anything:

| Expectation | Holds when |
| --- | --- |
| `{ launchId: null }` | No record file exists. A legacy record, or a malformed file, is a present record and fails it. |
| `{ launchId: g }` | A record exists and its `launchId` is `g`. A legacy record has none and never matches. |
| `"replace"` | Always. Used only by the launcher: a user-initiated launch always publishes. |

A mismatch returns `superseded` and runs nothing. Otherwise `action(current)` runs under the lock, may write side files (snapshot, per-launch files) and returns the next record or `null` (`unchanged`). `afterWrite(outcome, record)` then runs, still under the lock, for idempotent cleanup; its errors are collected into `afterErrors`, never rethrown, and never change the outcome. It does not run on `superseded`. The trap's `summon snapshot save --launch <id>` is such a writer: the snapshot is written only while the record still belongs to that launch, and a superseded call exits 0 silently.

A launcher `replace` that overrides another live launch of the same project is a user decision (two launches were issued). The overridden launch keeps its manifest and token and is reported as an extra session until it is closed.

### Upgrade window

A shell started by a previous Summon version still runs the old trap. It can only remove the legacy `<project>.active` and `<project>.pid`, which records with a `launchId` do not use, so it cannot change the liveness of a new launch. Its unconditional `summon snapshot save` may overwrite the project snapshot once. This is the only documented effect of the upgrade window, and it ends when that shell exits.

## Consequences

- The schema stays at version 1; `summon status`, the monitor and the briefing keep reading old records unchanged.
- Liveness sidecars are per launch, which removes the same-project trap race entirely instead of narrowing it. The Phase 1 real-process tests (`src/launch-identity.interleave.test.ts`) execute the generated bootstrap and trap text, and the pinned pre-revision trap text, with the system `/bin/sh` to prove it.
- `summon snapshot save` reads `--dir`, `--project`, `--layout` and `--launch` as ordinary parsed flags. The global parser used to reject `--dir` and validated `--layout` as a launch preset, so the trap's snapshot save had been failing silently; registering the flags and moving the preset validation to the launch paths is part of this decision because the generation-checked write depends on it.
- The backend seam (`src/backend.ts`, `src/backend-detect.ts`, `src/backends/`) resolves the backend right after config and before any Ghostty-specific step; this version still refuses the Rex result with "Rex backend is not available in this version".

## Status Notes (2026-10-31)

These notes record later changes. The decision text above stays as written.

- **Concurrent Rex launches (BE-L1).** The Write protocol section says a launcher `replace` that overrides another live launch of the same project is a user decision. For Rex this no longer happens through two plain launches: `exclusiveLaunch` in `src/backends/rex/backend.ts` holds a per-project launch lock (`<project>.launch.lock/`) from a second P2 decision through `session.create` to the record's publication, and makes that decision again when the record changed since `beforeLaunch`. A second concurrent Rex launch of the same project then finds the first one's live session and switches to it. Only `--new-window` (which skips the switch in `maybeSwitchToExisting`) or a Ghostty launch (no `exclusiveLaunch`) still creates a second workspace, and the `replace` rule above applies to it unchanged.
- **The Rex backend shipped (2.0.0).** The last Consequences bullet says this version still refuses the Rex result. That is superseded: since 2.0.0 the seam dispatches a Rex result to the Rex `TerminalBackend` (`src/backends/select.ts`, `src/backends/rex/`), and the "Rex backend is not available in this version" refusal no longer exists in the source.
