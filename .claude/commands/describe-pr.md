Generate a PR description for the current branch.

Process:
1. Identify the PR (current branch or ask user).
2. Get the full diff, commit history, and metadata.
3. Analyze changes thoroughly — user-facing vs internal, breaking changes.
4. For each verification step: run it if possible, mark pass/fail.
5. Generate description with: summary, changes, verification results.
6. Save and optionally update the PR via gh CLI.
