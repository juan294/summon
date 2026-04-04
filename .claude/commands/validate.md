Validate the implementation against the plan.

Model tier: **sonnet** — Sonnet 4.6 (1M context) session.

Process:
1. Locate the plan (provided path or search recent git history).
2. Gather evidence: git log, git diff, run test suites.
3. For each phase:
   - Verify marked-complete items are actually done.
   - Run every automated verification command.
   - Think about edge cases.
4. Generate a validation report with:
   - Implementation status per phase
   - Automated verification results
   - Code review findings (matches, deviations, issues)
   - Manual testing required (only if automation impossible — explain WHY)
   - Recommendations
5. If code quality issues are found (reuse opportunities, inefficiencies,
   dead code), recommend running `/simplify` to fix them in one pass.
