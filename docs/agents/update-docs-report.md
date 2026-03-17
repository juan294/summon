# Documentation Update Report

> Generated on 2026-03-17 | Branch: develop | Changes since v1.2.0

## Summary

- 2 documents updated
- 2 diagrams refreshed
- 0 version references corrected (handled during /release)
- 0 inline doc blocks updated
- 0 items flagged [NEEDS REVIEW]

## Changes by File

### docs/architecture.md

1. **Module Map table (line 20)**: Updated `validation.ts` description to include `ENV_KEY_RE` and `parsePositiveFloat`, and corrected dependency from "none" to "utils".
2. **Dependency Graph annotation box (lines 104-107)**: Added `ENV_KEY_RE` to the validation.ts export list.
3. **Data Flow diagram (line 135)**: Removed `--theme` from the parseArgs flags list (flag was removed from the codebase).

### MANUAL_TESTBED.md

1. **Section AC (Ghostty Theme)**: Replaced full test section with a "REMOVED in v1.2.1" notice explaining why (Ghostty AppleScript API doesn't support per-surface themes) and workaround (global config).
2. **Section T (Doctor)**: Removed `window-save-state` from the recommended settings list (doctor no longer checks it).
3. **Section AD (Doctor --fix)**: Updated test instructions to use `notify-on-command-finish` instead of `window-save-state` for the missing-setting test scenarios. Updated expected assertion text.

## Already Up to Date

- README.md -- theme references already removed
- docs/user-manual.md -- theme and window-save-state already removed
- CHANGELOG.md -- [Unreleased] correctly documents theme removal
- CLAUDE.md -- accurate project structure
- CONTRIBUTING.md, SECURITY.md, publishing.md -- all current

## Flagged for Review

None.
