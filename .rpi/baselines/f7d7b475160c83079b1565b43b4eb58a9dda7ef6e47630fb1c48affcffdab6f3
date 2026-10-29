Refine a raw idea into a validated design brief: $ARGUMENTS

Model tier: **opus** — Opus session. Conversational reasoning, no subagents by default.

The front end of RPI for greenfield or vague work. `/research` documents an
existing codebase; `/brainstorm` interrogates an idea that does not exist yet and
produces a design brief that `/plan` can consume. Use it when the request is a
goal, not a spec — when you could not yet write success criteria.

## When to use

- Greenfield feature or project with no clear spec.
- A vague request ("we should make X better") where scope is undefined.
- Skip it when the task is well-specified, mechanical, or already researched.
  Go straight to `/plan` (existing code) or `/research` (understand first).

## Process

1. Restate the idea in one sentence and name the core uncertainty. If the
   one-liner is obvious and unambiguous, say so and recommend skipping to
   `/plan` — do not manufacture questions.
2. Ask ONE focused question at a time. Wait for the answer before the next.
   Never batch a wall of questions. Socratic, not a survey.
3. Cover the dimensions that change the design, in roughly this order:
   - **Problem**: who has it, what do they do today, why now.
   - **Scope**: what is explicitly IN and OUT of this effort.
   - **Constraints**: stack, deadlines, existing systems, non-negotiables.
   - **Success**: how we will know it worked — concrete, observable.
   - **Risks**: what could make this the wrong thing to build.
4. Present design options as they emerge — at least two, with honest
   trade-offs. Recommend one. Do not hide the alternatives.
5. Reflect understanding back in digestible chunks. Confirm each chunk before
   moving on. Surface disagreements early, not at the end.
6. When the uncertainty is resolved, write the design brief.

## Output

Save to `docs/research/YYYY-MM-DD-[description]-brief.md` (same directory `/plan`
reads from). Structure:

```markdown
# Design Brief: [name]
> Brainstormed on [date]

## Problem
[Who, what they do today, why now]

## Goal
[One sentence]

## Scope
**In:** [...]
**Out:** [...]

## Constraints
[Stack, deadlines, existing systems, non-negotiables]

## Chosen Approach
[The recommended option and WHY, with the rejected alternatives and why not]

## Success Criteria
[Concrete, observable — these become the plan's success criteria]

## Open Risks
[What could still make this wrong]
```

## Rules

- Ask one question at a time. Never dump a questionnaire.
- Do not write code, do not plan implementation phases — that is `/plan`'s job.
- Do not invent requirements the user never stated. If something is unknown,
  it stays an open question; never paper over a gap with a placeholder.
- Present trade-offs, not a single railroaded answer.
- A brief with unresolved core uncertainty is not done. Resolve it or flag it
  explicitly as a blocking open question and **STOP**.
- Hand off: when the brief is written, tell the user the next step is `/plan`.
