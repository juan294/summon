# Durable triage checkpoints

The bundled `scripts/rpi-triage-state.py` records discovery metadata in the
project's ignored `.rpi/local/triage-state.json`. It never processes reports,
queries GitHub, verifies completion claims or authorizes external actions.
Resolve its path relative to the active installed skill directory, not the
project's arbitrary current directory. Use Python 3.11+.

Run `scan --root <absolute-project-root>` before reading reports, saving stdout
to a task-owned JSON artifact under `.rpi/local/`. An explicit `--report` is a
Markdown path relative to `docs/agents/`; repeated flags define a partial scope.
The scan returns hashes/timestamps, selected paths, discovery issues and missing
prior retries. Read reports separately; metadata never embeds their contents.
The scan's state hash prevents an older run from overwriting a newer checkpoint.

After processing dependencies and reporting results, write completion JSON with
`outcomes`, `inventories` and `reported`. For example, a failed report remains a
retry even though all inventory queries succeeded:

```json
{
  "outcomes": {"quality-report.md": "failed"},
  "inventories": {
    "reports": "complete",
    "agent_failures": "complete",
    "code_scanning": "complete",
    "dependabot_alerts": "complete",
    "secret_scanning": "complete",
    "dependency_prs": "complete"
  },
  "reported": true
}
```

Replace example observations with actual evidence. Outcomes are `processed`,
`failed` or `unprocessed`; omitted selected reports remain unprocessed. An
inventory can be `failed` or `unprocessed`; only `complete` permits advancing
the global marker. A disabled/unavailable alert API is a discovery gap, not an
empty successful query. A completed inventory does not assert findings resolved.

Run `checkpoint --root <absolute-project-root> --scan <saved-scan.json>
--completion <completion.json>` using the same bundled helper. A full scan with
all inventories complete, no discovery gaps and completed reporting advances
`docs/agents/.last-triage` to the scan-start time. Partial/failed discovery keeps
that marker unchanged while saving report dispositions. New or changed reports
during processing remain eligible by inventory/hash/timestamp; failed or
unprocessed reports remain eligible regardless of age.

Exit 2 rejects malformed, stale or redirected input. Preserve prior state,
inspect the reported conflict and rescan after resolving it. A stale lock can
belong to another active process: establish that its owner has stopped before
removing that exact local lock. State metadata is operational evidence, never a
substitute for reading findings, checking actual changes or obtaining consent.
