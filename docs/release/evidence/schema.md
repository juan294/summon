# Release evidence manifest — schema v1

Machine-readable proof that a non-empty set of required probes ran and passed against one exact
candidate. Consumed by `scripts/release/analyze-release.mjs`, which is the gate `/release` must
clear before tagging.

Format is JSON, not YAML: zero-dependency parsing in Node, and it matches the existing `version: 1`
convention in `status/*.json` and `snapshots/*.json`. Subject to
`docs/decisions/schema-migration-strategy.md`.

## Shape

```jsonc
{
  "version": 1,

  "release": {
    "baseline":         "v1.8.0",             // last released ref
    "candidate":        "<40-hex sha>",       // post-merge main SHA — the fixed candidate
    "deployedIdentity": "<40-hex sha> | null",// SLSA provenance gitCommit; null before publish
    "environment":      "ci-ubuntu",          // ci-ubuntu | ci-macos | local-macos
    "generatedAt":      "2026-07-28T12:00:00Z"
  },

  "results": [
    {
      "probeId":    "release.candidate-identity", // stable, dotted
      "required":   true,
      "status":     "passed",                     // passed | failed | skipped
      "owner":      "maintainer",
      "startedAt":  "2026-07-28T12:00:00Z",
      "finishedAt": "2026-07-28T12:00:01Z",
      "runner":     "vitest",
      "oracles":    { "exitCode": 0 },             // required probes MUST have >=1 oracle
      "fixtures":   [ { "id": "summon-rel-<runId>-0", "cleanupStatus": "removed" } ]
    }
  ],

  "cadence": [
    {
      "obligationId":     "ghostty.real-launch",
      "risk":             "critical",
      "intervalDays":     30,
      "blocksWhenOverdue": true,
      "lastRunAt":        "2026-07-01T09:00:00Z"  // null means never run -> blocks
    }
  ],

  "exceptions": []
}
```

## Block codes

`analyze-release` exits 1 and prints `BLOCKED / WHY / FIX` when any of these hold:

| Code | Meaning |
|---|---|
| `ZERO_PASS` | No check passed. "0 passed, N skipped" is never a pass. |
| `REQUIRED_MISS` | A required probe failed or skipped. Quarantine does not excuse it. |
| `FAILURE` | A non-required probe failed without a valid exception. |
| `CANDIDATE_MISMATCH` | Evidence names a different commit than the one being released. |
| `DEPLOYED_MISMATCH` | Deployed identity differs from the candidate — tested one artifact, shipped another. |
| `MISSING_ORACLE` | A required probe recorded no evidence. |
| `DIRTY_FIXTURE` | A synthetic fixture was not cleaned up. |
| `OVERDUE_ARC` | A blocking cadence obligation is past due (or has never run). |
| `EXCEPTION_ON_REQUIRED` | An exception tried to excuse a required probe. |
| `EXPIRED_EXCEPTION` | An exception is past `expiresAt`. |
| `UNAPPROVED_EXCEPTION` | An exception has no `approvedBy`. |
| `SCHEMA_VERSION` | Manifest version is not 1. |
| `NO_RESULTS` | `results` is empty. |
| `MALFORMED` | Anything unparseable or structurally invalid. Fails closed. |

## Exceptions

Exceptions are explicit release decisions, never analyzer tricks. **Required probes can never be
excepted.**

```jsonc
{
  "id":         "EX-2026-07-28-01",
  "probeId":    "release.state-isolation",
  "reason":     "concrete reason",
  "risk":       "low",                      // low | medium | high
  "approvedBy": "maintainer",
  "createdAt":  "2026-07-28T12:00:00Z",
  "expiresAt":  "2026-08-28T12:00:00Z",     // required; an expired exception is absent
  "followUp":   "#123"
}
```

## Generating and checking

```sh
SUMMON_RELEASE_CANDIDATE=$(git rev-parse HEAD) pnpm test:release

node scripts/release/analyze-release.mjs \
  --manifest docs/release/evidence/$(git rev-parse HEAD).json \
  --candidate $(git rev-parse HEAD)
```
