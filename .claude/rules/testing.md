---
description: TDD protocol and testing philosophy -- red-green-refactor, regression tests, verification hierarchy
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
  - vitest.config*
  - jest.config*
  - pytest.ini
  - pyproject.toml
---

# Testing

## TDD Protocol

All code changes follow Red-Green-Refactor:

1. **Red** -- Write a failing test FIRST
2. **Green** -- Minimum code to pass
3. **Refactor** -- Clean up with green tests

No exceptions. Bug fixes need a regression test.
Refactors need existing coverage. No "tests later."

Before chaining onto an API, confirm the method/type actually
exists -- docs, types, or a tiny probe (don't assume, e.g., that
`.abortSignal()` exists on a Supabase `.single()` call). Run the
targeted test BEFORE committing the first attempt, not after --
a revert costs more than the probe would have.

## Verification Sequencing

Run checks sequentially, never as parallel Bash calls
(hook enforced). The canonical chain, matching `.husky/pre-commit`
and `CLAUDE.md`:

```bash
pnpm typecheck ; pnpm lint ; pnpm build ; pnpm test
```

`build` is not optional -- it is the only check that catches
build-only breakage, which is why the pre-commit hook includes it.
`docs/release/release-checklist.md` is the authority for this chain.
