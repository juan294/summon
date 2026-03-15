# Documentation Update Report
> Generated on 2026-03-15 | Branch: `develop` | Changes since v0.8.0

## Summary
- 6 documents updated
- 1 diagram refreshed (Mermaid dependency graph)
- 2 test count references corrected
- 0 items flagged [NEEDS REVIEW]

## Changes by File

### `CLAUDE.md`
- Added `completions.ts` to Project Structure (was missing)
- Updated `setup.ts` description: "Interactive setup wizard, visual layout builder (template gallery, grid builder, live preview)"
- Updated `utils.ts` description: added `promptUser`, `getErrorMessage`
- Updated `validation.ts` description: added `validateIntFlag`, `validateFloatFlag`

### `docs/architecture.md`
- **Mermaid dependency graph**: Added `config --> layout` edge; added `walkLeaves` to tree annotation; updated setup annotation with `runLayoutBuilder`, `selectGridTemplate`, `runGridBuilder`, `PreviewRenderer`, `GRID_TEMPLATES`
- **Wizard flow**: Added step 2 "custom" option, noted custom layouts skip editor/sidebar/shell selection, fixed step numbering (two "8"s → 8, 9, 10)
- **Visual Layout Builder**: Added new subsection documenting template gallery, arrow-key grid builder, command assignment with live preview, and validation
- **Bundle size**: ~60 KB → ~68 KB
- **Default panes**: "default 3" → "default 2"
- **`full` preset label**: Removed "(default)" — `pair` is the actual default

### `docs/publishing.md`
- Changed header from "TODO Before First Publish" to "Publishing a New Version" (first publish was v0.7.0)
- Changed intro text to note publication date

### `docs/agents/pre-launch-report.md`
- Test count: 789 → 796

### `content/producthunt/LAUNCH-PLAN.md`
- Test count: 713 → 796

### `MANUAL_TESTBED.md`
- Fixed stale "server" → "shell" reference (line 641)
- Replaced Section Z (7 old tests for text-based builder) with 10 new test groups (50+ checkboxes) covering: template gallery, template selection flow, in-place live preview, arrow-key grid builder, cancel/escape, command validation, save/launch, edge cases, visual consistency, small terminal handling

## Flagged for Review
None.
