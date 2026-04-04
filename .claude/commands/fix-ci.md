Self-healing CI: diagnose and fix all failing tests autonomously.

Model tier: **sonnet** — Sonnet 4.6 (1M context) session. All subagents: `model: "sonnet"`.

Process:

1. Get the latest CI run for the current branch:
   `gh run list --branch $(git branch --show-current) --limit 1 --json databaseId,conclusion,status`
   If CI is green or still running, report status and stop.

2. Get the failure logs:
   `gh run view <run-id> --log-failed 2>&1 | tail -200`

3. Parse failures into individual test/check failures. Group by:
   - Type errors (typecheck)
   - Lint errors
   - Test failures (list each failing test)
   - Build failures

4. For each failing test, spawn a sub-agent (model: `"sonnet"`) to:
   a. Read the failing test file and the source file it covers
   b. Identify the root cause from the error message
   c. Fix the SOURCE code (never weaken or delete a test)
   d. Verify that specific test passes locally

5. For typecheck/lint/build failures, fix them directly (these are usually straightforward).

6. After all fixes, run the full test suite locally:
   `pnpm run typecheck 2>&1; pnpm run lint 2>&1; pnpm run test 2>&1`

7. If new failures appear, repeat the fix cycle (max 3 iterations).

8. When all checks pass, commit with message:
   `fix: resolve CI failures [auto]`
   Then push and spawn a background agent to verify CI passes.

Rules:
- Never weaken a test to make it pass — fix the source code.
- Never delete a test.
- If a failure is flaky (passes locally, fails in CI), note it but don't skip.
- If stuck after 3 fix cycles, stop and report what remains broken.
- Verify the current branch before committing — never push to main/master.
