Implement the plan at: $ARGUMENTS

Process:
1. Read the plan completely. Check for existing checkmarks.
2. Spawn Explore agents to gather relevant context.
3. Create tasks (TaskCreate) to track progress.
4. Check if remaining phases are marked `[batch-eligible]` in the plan.
   - If ALL remaining phases are batch-eligible, suggest using `/batch` to execute them in parallel (one worktree per phase, each opens a PR).
   - If user agrees, hand off to `/batch` with the plan reference. Done.
   - If user declines or phases have dependencies, continue sequentially below.
5. For the CURRENT phase only:
   a. Delegate implementation to subagents (up to 3).
   b. When done, submit to a reviewer subagent focused on PLAN COMPLIANCE:
      does the code match what the plan specified? Are all items addressed?
   c. If reviewer requests fixes, send back to implementer.
   d. Repeat until reviewer approves.
   e. Run `/simplify` on the changed files — this is Anthropic's native code quality pass
      (reuse, quality, efficiency). It spawns 3 specialized agents and applies fixes.
   f. Run ALL automated verification commands (tests, typecheck, lint, build).
   g. Update checkboxes in the plan file.
6. STOP. Report results and wait for human confirmation.
7. Do NOT proceed to the next phase without confirmation.

If plan doesn't match reality:
- STOP and present: Expected vs Found vs Why it matters.
- Ask how to proceed.
