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
(hook enforced). Fail fast with `typecheck && lint && test`, or collect every command status
and return failure if any check failed. A bare semicolon chain hides earlier
failures behind the last exit status.

## Mocking Boundary

Mock only what you do not own -- third-party APIs, network calls, the clock,
randomness, hardware. Code you own gets exercised for real: your modules, your
database, your file layout. Prefer a real object, an in-memory implementation
of your own interface, or a disposable fixture.

A mock of code you own encodes your belief about that code. The belief and the
code then drift independently, and the mock keeps passing after the real thing
changes. Where a mock is warranted, pin it to the real contract with at least
one probe against the real provider. A permanent mock with no contract probe is
an assumption, not a test.

## Assertions Must Be Able to Fail

Before accepting a test, name the change to production code that would make it
fail. If nothing would, the test measures nothing.

- **Tautological** -- asserts the implementation does what it does. Usually a
  symptom of writing the test after the code.
- **Disjunctive** -- `a or b or c` passes for the wrong reason. Assert the
  specific outcome the case exists to pin.
- **Registration-only** -- confirming a handler is imported, registered or
  wired proves the symbol exists, not that it behaves. Fire something at it and
  assert the result.
- **Over-broad** -- comparing whole objects or snapshots pulls in fields the
  invariant does not own (timestamps, access times, ordering) and fails for
  reasons unrelated to the behavior. Assert the fields the invariant covers.

Narrowing an assertion is a real change: say which invariant it still guards
and why the dropped fields were noise. Never weaken a valid test to hide a
defect.

## Coverage Is Evidence, Not a Target

Report coverage; don't defend it. An exclusion list that exists to keep a
global number above a threshold has inverted the measurement -- the number then
describes the exclusions, not the code.

When covered code falls below the bar, either write the missing tests or lower
the threshold and say so. A second config with a quieter threshold for the
untested files is the same evasion with more steps.
