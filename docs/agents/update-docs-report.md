# Documentation Update Report
> Generated on 2026-03-16 | Branch: `develop` | Changes since v1.0.0 (post-release)

## Summary
- 4 documents updated
- 2 diagrams refreshed (dependency graph + data flow)
- 0 version references corrected (all current)
- 0 inline doc blocks updated (all current from remediation)
- 0 items flagged [NEEDS REVIEW]

## Changes by File

### CHANGELOG.md
- Added `[Unreleased]` section documenting all post-v1.0.0 changes
- 4 categories: Changed (8 items), Fixed (2), Tests (4 coverage improvements), Infrastructure (3)

### docs/architecture.md
- **Dependency graph**: Added `launcher -.-> setup` dynamic import edge
- **Module map**: Updated launcher.ts dependencies to include `setup (dynamic)`
- **Data flow diagram**: Added editor-check decision node with wizard redirect path (TTY → runSetup → re-resolve; non-TTY → exit with instructions)
- **Security section**: Updated shell metacharacter detection to note `on-start` is now checked from all sources (not just `.summon` files)
- **Build pipeline**: Corrected bundle size from ~84 KB to ~67 KB
- Added note about launcher.ts dynamically importing setup.ts for first-run redirect

### docs/user-manual.md
- **Security section**: Added `on-start (any source)` row to behavior table; updated explanation to note on-start is always checked regardless of source

### docs/agents/pre-launch-report.md + remediation-report.md
- Updated with current audit results (from this session's /pre-launch and /remediate runs)

## Verified Current (No Update Needed)
- `README.md` — editor default already updated to "set during setup" earlier in this session
- `CLAUDE.md` — project structure and commands current
- `docs/publishing.md` — no publish workflow changes
- `SECURITY.md` — supported versions current
- `CONTRIBUTING.md` — no workflow changes
- All inline JSDoc — standardized during remediation (#173)
- All version references — aligned to 1.0.0
