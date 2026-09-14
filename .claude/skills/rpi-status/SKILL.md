---
name: "rpi-status"
description: "Report concise project orientation and read-only RPI installation diagnostics, including instruction size, model evidence, drift and native hook trust."
argument-hint: "[request]"
---
The request is supplied as literal arguments: $ARGUMENTS


Report project orientation and installation health, then stop. This workflow
never repairs files, changes native settings, enables services or publishes work.

## Project orientation

Inspect the current branch, latest commits and working tree with read-only Git
commands. Read the shared root instructions and current handoff for open items.
If existing CI is relevant, inspect the exact branch and candidate SHA; report
unavailable, missing, pending and completed results separately. Do not trigger
hosted jobs.

Present a concise summary: branch, last commit, working tree, known CI state and
open items. Do not infer a production branch from its name alone.

## Installation diagnostics

Resolve the actual installed engine or the verified source/runtime receipt.
Use its read-only `diagnose` operation with explicit project target and current
working directory. From a verified source or extracted runtime root:

```bash
python3 templates/scripts/rpi-distribution.py diagnose --help
```

Use `--target` for the actual project root, `--cwd` for this pane's working
directory and `--source` for the verified package/source root. The standalone
`templates/scripts/rpi-diagnostics.py` supports the same diagnostic arguments.
Installed direct engines may live under `.rpi/scripts/`; inspect their actual
receipt and dependencies rather than inventing a cache path.

Report these distinctions from the structured result:

- Expected native skill roots/package versus filesystem candidates and supplied
  native discovery; duplicates, legacy aliases, missing resources and drift.
- Codex's selected global and root-to-cwd instruction files, configured fallback
  names and byte limit; count complete file bytes including managed markers.
  Report the managed root's 8 KiB budget separately from the whole chain. The
  32 KiB default is an unverified assumption when actual configuration is unknown.
- Claude's ancestor instruction candidates, imports, cycles and missing/depth-
  limited/external imports. Surface native-setting and rule-loading limitations;
  a filesystem graph is not proof of the active session's loaded context.
- Requested model/effort and source versus session-bound observed identity,
  including evidence source/client version. Unavailable remains unavailable.
- Hooks configured, native-reported trust and observed execution as separate
  facts. An enabled untrusted hook is not enforcement. A changed or missing hash
  prevents an observed claim. Absent telemetry is unobserved, not zero violations.
- Actual Git state, documented topology and available verification prerequisites.

`--global-instruction` accepts repeated `claude=PATH` or `codex=PATH` selections;
otherwise the diagnostic inspects conventional configured native homes. A supplied
`--max-instruction-bytes` describes the effective limit the caller identified;
the flag alone does not verify native provenance. Never truncate instructions,
raise limits automatically or rewrite the owner's global profile/statusline.
A root-started task must obtain essential obligations from the root instructions;
do not depend on a nested file loading before the task reaches that directory.

`--native-observation` accepts a captured JSON envelope with `source`, `target`,
`cwd`, `session_id`, timezone-qualified `observed_at` and `clients`. Only fresh,
bound observations are considered. Each client may supply `version`, native
`skill_roots`/`skills`, `hooks`, and a session-bound `model_observation` envelope.
Hook records distinguish native `currentHash`/`trustStatus` from an actual
invocation's `observed_hash`; `source_sha256` binds the captured source bytes.
The helper filters fields but cannot authenticate a caller's capture. Supplied
native evidence is never an approval receipt. Do not read credentials or print
full settings, command bodies, private instructions or raw events.

Local scheduling remains the default. Native goals, advisor modes, dynamic
workflows, cloud routines and Agent Teams are optional owner-selected capabilities;
status never installs or activates them. Report limitations and concrete next
steps without starting unrelated work.
