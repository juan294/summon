# Exploratory charter reports

One file per charter, named `<candidate>-<charterId>.md`, produced by
`/explore-release` and validated by `scripts/release/validate-charter.mjs`.

Each report must carry all six sections and all eight maneuver rows — a missing
row invalidates the charter (playbook D10). Validate before adding the charter's
`charter.<id>` row to the release evidence manifest:

```sh
node scripts/release/validate-charter.mjs docs/release/charters/<file>.md
```

The template is in `docs/release/e2e-pro-playbook.md`, Section 9.
