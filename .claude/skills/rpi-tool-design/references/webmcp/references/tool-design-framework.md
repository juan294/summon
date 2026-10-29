# Tool Design Framework

A step-by-step procedure for designing a WebMCP tool set for a page or flow
from scratch. Run through all seven steps in order; when a later step
reveals a gap, go back and patch the earlier step rather than pressing on
with a known hole.

## 1. Define the User Goal

Write down the ideal outcome in one sentence, the context required to reach
it, and the boundary of what's in and out of scope for this tool set. Not
every UI action deserves a conversational path -- prioritize goals where
talking through it genuinely beats clicking through a UI: multi-step
flows, flows that require recalling scattered information, or flows a user
currently abandons because the UI buries them. A single-click toggle rarely
earns a tool.

## 2. Define the Initial State

Enumerate three things before writing any tool:

- **Application state** -- what data exists on the page already (a list
  loaded, a form open, an empty state).
- **Agent context** -- what the agent already knows from the conversation
  so far, so tools don't force it to re-ask for information it has.
- **System constraints** -- rate limits, permissions, data the backend
  won't expose to the client.

Ask explicitly: does this flow start before or after login? A tool
designed only for the authenticated case will misbehave the first time an
anonymous user reaches it.

## 3. Role-Play the Conversation

Map the conversation turn by turn, as if you were the agent handling a real
user request. At each turn, ask:

1. What does the agent need to know at this point?
2. What must it do next?
3. Which tool supports that action?
4. How should the site react once the tool runs?

When a turn has no tool that covers the needed action, stop immediately,
add or adjust a tool to cover it, and resume the role-play from that same
turn -- don't finish the walkthrough on an assumption you haven't backed
with a real tool.

## 4. Address Variance

Re-run the same goal from step 1, but with a vague or underspecified
request in place of the clean one. A tool set that only works when the user
supplies every parameter up front will fail the moment a real user doesn't.
Tools must let the agent ask the user for a missing parameter rather than
silently substitute a default -- an omitted parameter should read to the
agent as "ask", not "guess."

## 5. Fail Gracefully

Every tool handler should map its failures onto the four classes the accompanying
WebMCP domain contract defines in "Errors Are Recovery Instructions" -- wrong
state or missing prerequisite, invalid parameter, unexpected return value,
business-logic violation -- each returned as a recovery instruction rather
than a raw error. Those same four classes double as the failure taxonomy
your eval corpus (step 6) needs to cover: every documented conversational
path should exercise at least one of them, not just the happy path.

## 6. Evaluate

The goals, state transitions, and conversational paths documented in steps
1-4 are the eval corpus -- don't write a separate eval spec from scratch.
For each documented path, verify three things as probabilistic outcomes,
run multiple times or with paraphrased inputs rather than eyeballed once:

- **Tool selection** -- does the agent pick the right tool for the turn?
- **Parameter extraction** -- does it pull the right values out of the
  conversation and page state?
- **State management** -- does it call tools in an order consistent with
  the state transitions mapped in step 3?

A single passing run proves the happy path is reachable, not that it's
reliable.

## 7. Deploy and Observe

Role-play covers the prototype; it cannot cover what real users actually
say. Once shipped, treat production interaction logs as the next input to
step 6 -- feed observed deviations back into the eval corpus and, just as
importantly, back into the tool descriptions themselves. A tool the agent
keeps misusing in production usually has a description problem, not a
caller problem: sharpen the wording (see "Name By Effect" in the accompanying WebMCP domain contract)
before adding more validation to compensate.

## Worked Example: A Recipe and Meal-Planning Site

### Step 1 -- User Goal

"Plan next week's dinners around what's already in my pantry." In scope:
browsing recipes, checking pantry contents, building a 7-day meal plan,
generating a shopping list for what's missing. Out of scope: grocery
checkout, nutrition tracking. This beats clicking through a recipe-by-recipe
UI because it requires cross-referencing pantry state against many recipes
at once -- exactly the kind of scattered-information task a conversation
handles better than a browse-and-filter UI.

### Step 2 -- Initial State

Application state: the user's pantry list may be empty (new account) or
populated. Agent context: the conversation may already mention dietary
constraints ("we're vegetarian this month"). System constraint: recipe
search only covers the site's own catalog, not arbitrary web recipes. This
flow requires login (pantry and meal plans are per-account), so the tool
set assumes an authenticated session and a `prompt_login` recovery path
covers the anonymous case.

### Step 3 -- Role-Play

Turn 1: user says "plan dinners for next week using what I have." Agent
needs: pantry contents, then candidate recipes matched against them. Tool:
`get_pantry_items` (no args, returns current inventory), then
`search_recipes({ have_ingredients, exclude_ingredients, max_missing })`.
Site reacts by rendering the matched recipes. Turn 2: agent picks five
recipes and needs to assign them to Mon-Sun. Tool: `create_meal_plan({
week_start, assignments })`. Gap found here: there's no tool to check
whether the user already has a meal plan for that week, so
`create_meal_plan` would silently overwrite one. Fix: add
`get_meal_plan({ week_start })` and have the agent call it before
`create_meal_plan`, resuming the role-play from turn 2 with that added
step. Turn 3: user asks "what do I still need to buy?" Tool:
`generate_shopping_list({ week_start })`, which diffs the meal plan's
required ingredients against pantry contents.

### Step 4 -- Variance

Re-run turn 1 with "plan some dinners" -- no week given, no dietary info
repeated. `search_recipes` should not assume "next week" silently; the
agent should ask "Which week -- this one or next?" before calling
`create_meal_plan`, since `week_start` has no safe default worth guessing.

### Step 5 -- Failure Classes

`create_meal_plan` on a week that already has a plan is a business-logic
violation -- return "This week already has a plan; suggest the user pick a
different week or call `get_meal_plan` to review the existing one first,"
not a raw conflict error. A `week_start` that isn't a Monday is an invalid
parameter -- return the expected format rather than silently rounding it.

### Step 6 -- Evaluate

Run the turn-1-through-3 path a dozen times with paraphrased requests ("use
up what's in the fridge," "I don't want to grocery shop this week") and
confirm `search_recipes` is chosen over a generic `list_recipes` browse
tool each time, and that `week_start` extraction correctly resolves
relative phrases like "next week" against today's date.

### Step 7 -- Deploy and Observe

After launch, logs show users frequently calling `search_recipes` with
`exclude_ingredients` set to an allergen before ever mentioning pantry
contents -- a goal the step-1 scope didn't anticipate. Feed that back: add
an eval path for "plan dinners avoiding [allergen]" and sharpen
`search_recipes`'s description to mention allergen exclusion explicitly,
since the agent was inferring the parameter's purpose rather than being
told.
