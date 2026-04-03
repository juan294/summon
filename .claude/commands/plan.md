Create an implementation plan for: $ARGUMENTS

Model tier: **opus** — Opus session. All subagents: `model: "opus"`.

Process:
1. Read ALL mentioned files completely.
2. Spawn research subagents (Explore, model: `"opus"`) to find relevant code, patterns, and docs.
3. Read everything the subagents identify.
4. Present your understanding with focused questions — only ask what code can't answer.
5. After clarifications, spawn deeper research if needed.
6. Present design options with trade-offs.
7. Propose phase structure, get feedback.
8. Write detailed plan with separate phase files.
9. Use pseudocode notation for changes.
10. Separate automated vs. manual success criteria.
11. Identify batch-eligible phases: phases that are independent (no file overlap, no
    dependency on another phase's output) get marked `[batch-eligible]` in the plan.
    This tells `/implement` that `/batch` can execute them in parallel.
12. Maximum 3 [NEEDS CLARIFICATION] markers.
13. Iterate with user until all questions resolved.

Save to docs/plans/YYYY-MM-DD-[description].md
Phase files: docs/plans/YYYY-MM-DD-[description]-phases/phase-N.md

No unresolved questions in the final plan.
