<!-- rpi-overlay: skill=rpi-update-docs; written-against=b1bd71232ee3 -->
# Project overlay for rpi-update-docs

## Procedure

- summon ships no version invariant script. The mechanical backstop for version
  drift is the version-vs-tag equality gate in `.github/workflows/release.yml`,
  which fails the release when `package.json` and the tag disagree.

Moved from the managed `.claude` and `.agents` copies of this skill on 2026-11-14 (summon commit 5227241).
