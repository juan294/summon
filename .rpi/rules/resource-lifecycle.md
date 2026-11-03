---
description: Local resource ownership, Docker stack lifetime, cleanup and retained-data handoffs
paths:
  - "**/Dockerfile*"
  - "**/compose*.yml"
  - "**/compose*.yaml"
  - "**/docker-compose*"
  - "**/supabase/**"
---

# Local Resource Lifecycle

Apply before starting, reusing, stopping or removing local stacks, containers, volumes, networks or task services, including database tests in repositories without a Dockerfile. Installation of this rule grants no deletion authority and does not install a cleanup daemon.

## Establish ownership before allocation

- Read the project's resource contract linked from AGENTS.md. Use its existing commands and preservation rules. During setup, document missing project facts in `docs/development/resource-lifecycle.md` (or link an existing equivalent); do not invent commands, overwrite local policy or require a new framework.
- Classify the environment as **disposable** (task fixtures with approved disposal), **reusable** (kept until explicit finish), or **persistent/recovery** (protected data). Unknown existing resources are protected. Names, age, stopped state, empty contents, missing worktrees and Docker's reclaimable count do not prove disposability.
- Verify the actual local Docker context/daemon, project identity and workdir. Record the task, lifecycle class, ownership and intended teardown before allocation; capture exact container/network IDs and volume names plus creation identity as they appear. Keep the record outside any directory that cleanup will remove. Reuse an existing project receipt rather than add a parallel registry; never record credentials.
- Give concurrently mutable tasks unique project identities. A Git worktree alone does not isolate a database. Never reset, stop or delete a shared stack merely because the current directory is a worktree. Reusing an environment requires its documented access/consumer rules.
- Start only services required by the task while preserving the required test coverage. Delegation briefs include the resource scope and teardown obligation; the coordinator accounts for resources left by interrupted delegates.

## Execute the lifecycle

- Prefer an existing one-shot command that creates, runs, captures evidence and cleans up. Put normal completion, error and catchable-signal cleanup in the owning command (`finally`/exit handling); preserve the original failure and any cleanup failure separately. For direct disposable container jobs, use `--rm` where appropriate, with results retained outside the container. This does not dispose of named volumes or other stack services.
- Before removal, re-inspect the same daemon and recorded identities, mounts, project/workdir labels and all consumers, including stopped containers. Remove only resources within the approved scope. A replacement with the same name is not the recorded resource. Ownership mismatch, new consumers, another live owner, an active consumer lease or a recovery hold blocks automatic disposal of that resource; report it without blocking unrelated safe work.
- Stop owned unused services to release runtime resources; remove approved disposable data to release storage. These are separate actions. Never use host-wide `docker system prune`, `volume prune`, `container prune`, `network prune`, `supabase stop --all`, or prefix/age matching as ordinary task teardown. Image and build-cache maintenance are host-level policies, not a task's permission to remove shared caches.
- Compose teardown normally preserves volumes. `down --volumes`, `docker rm -v`, `docker volume rm` and Supabase `stop --no-backup` can delete data: use them only through an ownership-verified, authorized disposable lifecycle. Ordinary Supabase stop preserves data; it is not proof of storage cleanup. Confirm installed CLI behavior and actual project identity before execution.
- On failure, preserve necessary diagnostics with a reason, owner and review/expiry condition. Stop only verified owned services that no live consumer needs. An expiry can make an already authorized disposable resource eligible for reinspection; it never converts protected data into disposable data. Reusable resources need explicit finish, not automatic age-based deletion.

## Completion and interruption recovery

Before reporting completion, removing a task worktree or restoring its database identity, verify the owned inventory. Report resources as removed, deliberately retained (with reason, owner and next review/finish action), or cleanup failed (with exact remaining identities). A passing test with failed teardown is not a successful one-shot lifecycle. Keep ownership records and required workdirs available until disposal or a verified handoff completes.

Exit handlers cannot recover from every process kill or host failure. Reuse the existing host maintenance service when available; do not silently install one per project. A host inventory must include containers, networks and volumes, report unknown resources without deleting them, and distinguish inspection failure from a clean inventory. Approved automatic disposal uses the project's ownership checks, rechecks live consumers/holds and acts on exact identities. Age alone or a vanished process is insufficient. Surface retained-resource reminders and cleanup failures through the existing reporting channel.

## Project contract and verification

Keep project-specific facts in the project-owned contract, not in edited copies of this managed rule: exact start/test/inspect/finish commands and workdirs; identity/port allocation; persistent/shared/recovery resources; receipt location; reusable-consumer coordination; failure retention and host maintenance integration (or its absence). Link it from AGENTS.md. Preserve these facts during cc-rpi updates; a rule update is not resource disposal or host activation.

When implementing or changing an executable lifecycle, verify that successful tasks leave no owned disposable resources, failure/interruption has a visible recovery disposition, repeated cleanup is safe, and concurrent consumers, replaced identities, shared data and recovery holds remain protected. Instruction delivery tests prove distribution only; they do not prove actual Docker cleanup or native agent compliance.
