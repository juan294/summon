# ADR: Schema Migration Strategy for Versioned JSON Files

**Status:** Accepted  
**Date:** 2026-05-09  
**Issue:** #324

## Context

Summon writes versioned JSON files to disk for two subsystems:

- **Status files** (`~/.config/summon/status/<project>.json`) — track workspace PID, uptime, and active/stopped state.
- **Snapshot files** (`~/.config/summon/snapshots/<project>.json`) — store git state, layout, and branch at save time.

Both include a top-level `"version": 1` field. As summon evolves, the schema of these files may need to change. Without a migration policy, old files written by previous versions of summon may fail to parse or produce incorrect behavior on upgrade.

## Decision

### Version field

Every versioned JSON file must include a top-level `"version"` field set to a positive integer. The current version is `1`.

### When to bump the version

A version bump is **required** when:
- An existing field is removed.
- An existing field's type or semantics change (e.g., a string becomes a number, or a flag's meaning is inverted).

A version bump is **not required** when:
- A new optional field is added with a sensible default that older readers can safely ignore.

### Backward compatibility window

After a version bump, the reading code must support migrating files from version `N-1` to `N` for at least one major release of summon. Files older than one major version may be rejected with a clear error message prompting the user to delete the stale file.

### Migration implementation pattern

When reading a versioned file, check the `version` field before deserializing:

```typescript
if (data.version === 1) {
  // migrate to version 2
  data = migrateV1toV2(data);
}
// now data is version 2 shape
```

Migration functions must be pure and side-effect-free. They transform the raw parsed object in place (or return a new object) and must not write to disk — the write happens as part of normal operation after a successful migration.

### Documenting bumps

Each schema version bump must be documented as a new ADR in `docs/decisions/` describing:
- Which file(s) are affected.
- What changed and why.
- The migration path from the previous version.

## Consequences

- Users upgrading summon across a schema-bumping version will have their files automatically migrated on first read.
- Files that are too old (more than one major version behind) will require manual deletion, with summon printing a helpful error message.
- Adding new optional fields remains low-friction — no ADR needed, no migration code needed.
