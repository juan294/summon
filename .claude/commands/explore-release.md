# Exploratory Release Charters

Model tier: **opus** — Opus session for the orchestrator. Charter agents run as
parallel `general-purpose` background Tasks; tier them by cost (sonnet is usually
sufficient for a single charter's execution).

Independent, fresh-context exploratory testing of a fixed release candidate. This
is **Wave B** of the E2E Pro release-verification system
(`docs/release/e2e-pro-playbook.md`) — the cheap, high-yield layer that
targets interaction and recovery failures deterministic suites miss.

It complements, and does not replace:

- **`/pre-launch` + `/remediate`** — static, code-as-written audit. Charters
  exercise the *deployed candidate's behavior* instead.
- **`/release`** — the tagging authority. Charters feed evidence into the release
  gate; they never tag.

Read `docs/release/e2e-pro-playbook.md` Section 6 (Wave B) for the full
decision detail. This command is the executable protocol.

## Input

```text
/explore-release <LAST_RELEASE_REF> <CANDIDATE_SHA_OR_DIGEST>
```

If arguments are omitted, infer `<LAST_RELEASE_REF>` from the last release tag and
`<CANDIDATE_SHA>` from the fixed candidate under release. Confirm both with the
user before spawning agents — a charter run against the wrong candidate is wasted.

## Step 1: Fix the candidate and read the diff

1. Confirm the candidate is immutable (a specific SHA, tag, or artifact digest),
   not a moving branch. Stop if it is mutable (playbook D06).
2. Compute the change surface:

   ```bash
   git log --oneline <LAST_RELEASE_REF>..<CANDIDATE_SHA>
   git diff --stat <LAST_RELEASE_REF>..<CANDIDATE_SHA>
   ```

3. Map changed paths to user-facing capabilities, actors, surfaces, states, and
   external seams. Do not trust stale docs — inspect the actual routes, jobs, and
   providers touched.

## Step 2: Generate charters

Size the charter set to the diff — **do not pad the count**:

- tiny, isolated diff → 1 charter;
- normal release → 2–4 charters;
- more only for distinct high-risk capability groups.

Prioritize: outward writes, new/changed state transitions, vendor or retry
behavior, authorization boundaries, changed copy that promises an outcome, new
multi-surface flows, and recent escape classes.

Each charter names: changed capability, affected actors/roles, affected surfaces,
relevant states, external seams, primary risk hypothesis, and the authorized
environments and operations.

## Step 3: Execute each charter in a fresh context

Spawn one background Task per charter (`subagent_type: general-purpose`). Each
agent MUST be a fresh context that:

- did **not** implement the change;
- receives the candidate, its charter, the safety contract, and the report format
  — but not the implementer's untested assumptions as facts;
- works independently from the other charter agents;
- reports findings without fixing them mid-charter.

Every charter attempts all eight maneuvers, in risk-first order, and reports each
as `PASS` (with evidence), `FAIL` (with reproduction + evidence), or `N/A` (with a
concrete reason). **Omitting a row invalidates the charter.**

| # | Maneuver | Intent |
|---:|---|---|
| 1 | Try the action twice | Double-submit, repeat, duplicate, idempotency failures. |
| 2 | Edit after every error | Error recovery, stale-state clearing, successful resubmission. |
| 3 | Interrupt mid-flow | Back, refresh, close/reopen, resume, timeout, reconnect. |
| 4 | Use a second session or role | Stale authz, propagation, isolation, concurrency errors. |
| 5 | Switch locale and viewport/device | Formatting, truncation, direction, responsive, state-transfer failures. |
| 6 | Compare copy with outcome | Messages, labels, and promises match actual behavior. |
| 7 | Read back downstream state | Authorized HTTP, datastore, storage, event, or telemetry evidence. |
| 8 | Ask "should this exist?" | Challenge unsafe, contradictory, confusing, impossible behavior. |

### summon's maneuver adaptation

summon is a macOS CLI that drives Ghostty through AppleScript. There is no
browser, no datastore, no auth, and no vendor API. Read the maneuvers as:

| # | Generic | summon |
|---:|---|---|
| 1 | Try the action twice | Launch the same project twice -- no duplicated panes, no corrupted status records. |
| 2 | Edit after every error | After a failed launch, fix the config and relaunch; stale state must clear. |
| 3 | Interrupt mid-flow | SIGINT during launch; Ctrl-C at a prompt. No orphaned `.tmp`, `.pid`, or `.active` files. |
| 4 | Second session or role | Two concurrent `summon` invocations -- concurrent-write safety (the #524 class). |
| 5 | **Locale and viewport** -> **shell, terminal size, Node version** | zsh vs bash; a narrow terminal (monitor TUI truncation); Node 20 vs 24. |
| 6 | Compare copy with outcome | Error messages match real behavior; `summon doctor` claims match reality. |
| 7 | Read back downstream state | Inspect `~/.config/summon/**`: schema `version` present, no leaked keys, no residue. |
| 8 | Should this exist? | Challenge unsafe behavior -- e.g. the install-software-on-launch prompt (`launcher.ts:216-268`). |

Default timebox: **30 minutes** per charter. A timebox does not turn an untested
high-risk area into a pass — agents report where time expired.

## Step 4: Safety contract (non-negotiable)

Charter agents MUST:

- use synthetic, run-scoped fixtures (`summon-rel-<RUN_ID>`, matching `src/release/helpers.ts`);
- run against an **isolated `HOME`**, never the real `~/.config/summon`. This is
  not hygiene: `ensureConfig()` creates config files on the first read and the
  cache flushes at exit, so even `list` and `config` mutate the maintainer's
  state. Reuse the `makeIsolatedHome()` harness;
- operate only within the charter's authorization;
- never touch real user data;
- clean up only their own fixtures and prove zero unexpected residue;
- observe and report — never opportunistically change production or code.

For summon specifically, these are **out of bounds** without explicit
authorization (playbook D20):

- `summon trust` against a real project directory — it grants execution rights;
- accepting the install-software prompt (`npm install -g …`, `brew install …`)
  at `launcher.ts:216-268`, which mutates the global toolchain;
- `summon doctor --fix`, which rewrites `~/.config/ghostty/config`;
- any `npm publish`, `git tag`, or `git push`.

Real-Ghostty charters run only on the maintainer's Mac. Their findings are
observations, not fixes.

## Step 5: Report and gate

Each agent returns an **Exploratory Charter report** (playbook Section 9). The
orchestrator collects them and applies the block rule.

The release is **BLOCKED** when any of the following hold:

- any charter reports a FAIL;
- a high-risk maneuver or area was skipped;
- cleanup evidence is missing;
- a finding lacks triage;
- an accepted exception is not recorded before tagging.

Present a consolidated summary: per-charter decision, all findings with severity
and reproduction, skipped high-risk areas, and fixture/cleanup evidence. Every
finding gets tracked (file an issue) — do not silently drop low-severity ones.

### Wiring charters into the release gate

The block rule above is not advisory prose — it executes. For each charter:

1. Write the report to `docs/release/charters/<candidate>-<charterId>.md`.
2. Validate it. A report missing a maneuver row is not a charter:

   ```bash
   node scripts/release/validate-charter.mjs docs/release/charters/<file>.md
   ```

3. Add one result row per charter to the evidence manifest, so the release
   analyzer sees it:

   ```jsonc
   { "probeId": "charter.<id>", "required": true,
     "status": "passed",                       // "failed" if the charter is BLOCKED
     "oracles": { "report": "docs/release/charters/<file>.md" },
     "fixtures": [ { "id": "summon-rel-<RUN_ID>-1", "cleanupStatus": "removed" } ] }
   ```

`pnpm analyze:release` then blocks on a failed charter (`REQUIRED_MISS`), missing
cleanup evidence (`DIRTY_FIXTURE`), or an expired exception — no new gate logic
required.

Do not tag or release from this command. Hand the evidence to `/release`, which
gates on it via the analyzer. See `docs/release/release-checklist.md` step 5.

## Rules for this process

- Fixed, immutable candidate only.
- Fresh contexts only — the implementer does not review their own change here.
- All eight maneuver rows, every charter, or the charter is invalid.
- Synthetic run-scoped fixtures; clean up only what you created.
- Findings are reported, not fixed, during the charter.
