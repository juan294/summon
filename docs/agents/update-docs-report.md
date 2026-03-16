# Documentation Update Report
> Generated on 2026-03-16 | Branch: `develop` | Changes since v0.8.0

## Summary
- 5 documents updated
- 1 diagram refreshed (dependency graph export annotations)
- 1 version reference updated (SECURITY.md supported versions)
- 0 inline doc blocks updated (no existing JSDoc was stale)
- 0 items flagged [NEEDS REVIEW]

## Changes by File

### CHANGELOG.md
- Expanded [Unreleased] section with all post-v0.8.0 changes
- Added: sidebar removal, unlimited grid, truncation indicator, name prompt example, parsePositiveFloat, command validation with typo detection
- Changed: doctor exit code, layout show error, ANSI-aware centering, parallel detectTools, @internal annotations
- Tests section: 817 total tests (was 677)

### CLAUDE.md
- Updated `validation.ts` description to include `parsePositiveFloat`

### SECURITY.md
- Added `1.x` row to supported versions table (ahead of upcoming release)

### docs/architecture.md
- Updated dependency graph Mermaid diagram:
  - `config.ts` exports: added `removeConfig`, `deleteCustomLayout`, `isCustomLayout`, `CONFIG_DIR`
  - `starship.ts` exports: added `resetStarshipCache`
  - `setup.ts` exports: added `gridToTree`, `renderLayoutPreview`, `renderMiniPreview`, `renderTemplateGallery`, `findClosestCommand`, `centerLabel`, `visibleLength`, `buildPartialGrid`
  - `validation.ts` exports: added `parsePositiveFloat`
- Updated bundle size from ~68 KB to ~84 KB

### docs/user-manual.md
- Updated `layout create` description to mention visual builder, template gallery, arrow-key grid sculptor, and unlimited columns/panes

## Flagged for Review
None.
