Design a WebMCP tool set and seed evals for: $ARGUMENTS

Model tier: **opus** — Opus session. All subagents: `model: "opus"` (Rule #74) — the value here is in the quality of the simulated conversation and in noticing the missing tool, not in cheap mechanical lookup.

`/tool-design` turns a stated user goal into an agent-facing tool contract
plus seed evals. It sits between `/brainstorm` and `/plan`:
`/brainstorm` -> `/tool-design` -> `/plan` -> `/implement`. `/brainstorm`
turns a vague idea into a goal; `/tool-design` turns a goal into a tool
contract plus evals; `/plan` turns that into phases.

## When to use

- A project exposes, or plans to expose, an agent-facing surface (WebMCP
  tools registered via `document.modelContext`, or an equivalent tool
  contract) and a user goal is already stated.
- If the goal itself is vague ("make this more agent-friendly"), hand back to
  `/brainstorm` first — `/tool-design` needs a goal it can restate as ideal
  outcome, required context, and boundaries. Don't guess a goal to keep
  moving.
- Skip it entirely when the project exposes no agent-facing surface and isn't
  planning one; `/tool-design` earns its place the same way `/brainstorm`
  does — only when the step it does is actually needed.

## Process

1. Read the `webmcp` skill (`templates/skills/webmcp/SKILL.md`) and its
   `references/tool-design-framework.md` completely before anything else.
   These define the tool contract shape (name, description, input schema,
   handler, recovery-instruction errors) and the seven-step design procedure
   this command's role-play steps are built on.
2. Establish the **initial state from the codebase, not from assumption**.
   Spawn a subagent (model: `"opus"`) if needed to find: which view the flow
   starts on, what data is already loaded, what authentication has already
   happened, what filters or selections are active. Cite `file:line` for
   each fact — an unanchored claim here is a guess wearing the framework's
   clothes. This is the framework's "Define the Initial State" step, split
   into application state, agent context, and system constraints.
3. Restate the user goal as three things: the ideal outcome in one sentence,
   the context required to reach it, and the boundary of what's in and out of
   scope. If the goal can't be stated in those three terms, **stop** and say
   this is a `/brainstorm` input, not a `/tool-design` input — do not force a
   restatement onto a goal that isn't ready.
4. Role-play the conversation turn by turn, as if you were the agent handling
   the real user request. At each turn, record: what the agent needs to know,
   what it must do next, which tool supports that action, and how the site
   should react once the tool runs. When a turn has no tool that covers the
   needed action, stop, add or adjust a tool, and resume the role-play from
   that same turn — don't finish on an assumption you haven't backed with a
   real tool.
5. Role-play the same goal a **second time with a deliberately vague or
   underspecified request** in place of the clean one. This variance pass is
   where the "the agent must ask rather than guess" requirement gets
   discovered instead of asserted — an omitted parameter should read to the
   agent as "ask the user," never as "substitute a default."
6. Derive the tool set from what the two transcripts actually required. A
   tool that appears in neither role-play does not go in the spec, even if it
   mirrors an existing UI button — a UI-shaped tool set is the failure this
   command exists to prevent.
7. For each tool, write the contract: name (stating the effect, per "Name By
   Effect" in the skill), description, input schema (raw values the user
   would say, not internal IDs — per "Take Raw Input"), return shape, and one
   recovery message per failure class the skill defines in "Errors Are
   Recovery Instructions" (wrong state / missing prerequisite, invalid
   parameter, unexpected return value, business-logic violation). A tool with
   no error contract is not specified.
8. Emit seed evals from the same two transcripts — don't write a separate
   eval spec from scratch. For each transcript turn: the expected tool, the
   expected extracted parameters, and the expected state afterward. These
   evals are inputs to whatever verification step `/plan` and `/implement`
   set up downstream, not something this command runs itself.
9. Flag every place the role-play needed a capability the codebase does not
   have — a missing tool, a missing state check, a missing recovery path.
   These flagged gaps are the plan's real findings; state them plainly enough
   that `/plan` can turn each into a phase or an explicit scope decision.

## Output

Save to `docs/plans/YYYY-MM-DD-tools-[slug].md`. This document is a `/plan`
input, not a substitute for one — `/plan` still turns it into phases.
Structure:

```markdown
# Tool Design: [name]
> Designed on [date]

## User Goal
**Outcome:** [one sentence]
**Required context:** [...]
**Boundaries:** [in / out of scope]

## Initial State
**Application state:** [... with file:line]
**Agent context:** [what the agent already knows from conversation]
**System constraints:** [rate limits, permissions, data the backend won't expose]

## Role-Play: Clean Request
[Turn by turn: agent need -> action -> tool -> site reaction]

## Role-Play: Vague Request
[Same goal, underspecified input; note every point where the agent must ask
rather than guess]

## Tool Contracts
### `tool_name`
- Description: [...]
- Input schema: [...]
- Returns: [...]
- Failure classes:
  - Wrong state / missing prerequisite: [recovery message]
  - Invalid parameter: [recovery message]
  - Unexpected return value: [recovery message]
  - Business-logic violation: [recovery message]

## Seed Evals
[Per transcript turn: expected tool, expected extracted parameters, expected
state afterward]

## Gaps Found
[Every capability the role-play needed that the codebase doesn't have]
```

Hand off: when the document is written, tell the user the next step is
`/plan docs/plans/YYYY-MM-DD-tools-[slug].md`.

## Rules

- Derive tools from transcripts, never from the existing UI's button list. A
  UI-shaped tool set is the failure this command exists to prevent.
- Maximum 3 `[NEEDS CLARIFICATION]` markers, matching `/plan`.
- No placeholder values in the emitted spec.
- The spec names the failure classes explicitly; a tool with no error
  contract is not specified.
