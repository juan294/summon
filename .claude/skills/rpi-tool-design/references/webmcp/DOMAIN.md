---
name: "webmcp"
description: "WebMCP tool design and the agent-facing tool contract: registering tools with document.modelContext, scoping one function per tool, naming tools by effect, schema and validation split, error messages as recovery instructions, and registering tools against page state."
---

# WebMCP

## The API Surface

WebMCP exposes a page's capabilities to an in-browser agent through
`document.modelContext`. A tool is registered with a name, a description, an
input schema, and a handler:

```js
const controller = new AbortController();

document.modelContext.registerTool(
  {
    name: "add_to_cart",
    description: "Adds a product to the shopping cart by SKU.",
    inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
    async execute({ sku }) {
      await cart.add(sku);
      return { content: [{ type: "text", text: `Added ${sku} to cart.` }] };
    },
  },
  { signal: controller.signal },
);

// later, to unregister:
controller.abort();
```

The handler's result must be JSON-serializable. The current draft defines
`ToolExecuteCallback` as `Promise<any>`; an MCP `content` envelope is an
application convention, not the required browser return type. `executeTool()`
resolves to the serialized result. Rejections and serialization failures can
reject execution; expected domain errors can use a documented JSON object
with a recovery message. An agent discovers tools with `getTools()` and tracks
`toolchange` events. Registration should last only as long as the view state
that makes the tool usable.

Verified against the [WebMCP draft dated 4 September 2026](https://webmachinelearning.github.io/webmcp/).
This is an evolving community draft, not a W3C standard. Feature-detect the
actual browser API and keep it behind an adapter; do not infer availability
from a version number alone. The global examples here belong in that adapter.

## One Tool, One Function

Wrong -- a single tool with a mode switch covering unrelated operations:

```js
document.modelContext.registerTool({
  name: "manage_booking",
  description: "Search, filter, or book reservations depending on mode.",
  inputSchema: {
    type: "object",
    properties: { mode: { enum: ["search", "filter", "book"] }, params: { type: "object" } },
  },
  async execute({ mode, params }) {
    // agent picks the wrong mode -> silently runs the wrong branch, no error surfaces
  },
});
```

Right -- one tool per action, so tool selection is unambiguous:

```js
document.modelContext.registerTool({ name: "search_bookings", /* ... */ });
document.modelContext.registerTool({ name: "filter_bookings", /* ... */ });
document.modelContext.registerTool({ name: "create_booking", /* ... */ });
```

Overlapping tools force the agent to guess which one applies, and a wrong
guess doesn't raise an error -- it just calls the wrong function.

## Name By Effect

Wrong -- a vague name that doesn't say whether the tool acts or navigates:

```js
document.modelContext.registerTool({
  name: "handle_event",
  description: "Do not use this for weather-related scheduling.",
  // ...
});
```

Right -- the name states the effect, and the description says what the
tool does rather than what it doesn't:

```js
document.modelContext.registerTool({
  name: "create_event",
  description: "Creates a calendar event for a specific date and time.",
  // ...
});

document.modelContext.registerTool({
  name: "start_event_creation",
  description: "Opens the new-event form pre-filled with a date.",
  // ...
});
```

`create_event` executes immediately; `start_event_creation` navigates to a
form -- the agent needs the name to disambiguate which happens before it
calls either one. Describe capabilities positively; a negative description
("not for X") tells the agent what to avoid but not what the tool is for.

## Take Raw Input

Wrong -- a tool that requires input only the application backend could know:

```js
document.modelContext.registerTool({
  name: "select_shipping",
  inputSchema: { type: "object", properties: { shipping_id: { type: "integer" } } },
  // agent has no way to know that "Express" is internal id 1
});
```

Right -- accept the raw value the user would type or say, and resolve it
inside the tool:

```js
document.modelContext.registerTool({
  name: "select_shipping",
  inputSchema: { type: "object", properties: { shipping: { type: "string" } } },
  async execute({ shipping }) {
    const method = resolveShippingMethod(shipping); // "Express" -> internal record
    // ...
  },
});

document.modelContext.registerTool({
  name: "schedule_pickup",
  inputSchema: { type: "object", properties: { when: { type: "string" } } },
  async execute({ when }) {
    const date = parseNaturalDate(when); // "next Tuesday" -> resolved date, not the agent's job
    // ...
  },
});
```

Push resolution work (ID lookups, date math) into the handler. The agent
only has what's in the conversation and the page -- don't require it to
have pre-computed a value it can't derive.

## Strict In Code, Loose In Schema

Schema constraints -- enums, string formats, min/max -- describe intent to
the model but are not guaranteed to be honored; a model can still emit a
value outside the enum or a malformed date string.

Wrong -- trusting the schema and skipping handler-side validation:

```js
async execute({ status }) {
  await updateOrderStatus(status); // schema said enum, but status arrives as "Shiped"
}
```

Right -- validate inside the handler and return an actionable error on
mismatch:

```js
async execute({ status }) {
  if (!["pending", "shipped", "delivered"].includes(status)) {
    return { content: [{ type: "text", text: `Invalid status "${status}". Use one of: pending, shipped, delivered.` }] };
  }
  await updateOrderStatus(status);
}
```

## Errors Are Recovery Instructions

Wrong -- surfacing the raw failure with no path forward:

```js
async execute({ query }) {
  try {
    return { content: [{ type: "text", text: await search(query) }] };
  } catch (err) {
    return { content: [{ type: "text", text: err.message }] }; // "TypeError: fetch failed"
  }
}
```

Right -- shape every failure as what the agent should do next, not just
what went wrong. One example per failure class:

- **Wrong state / missing prerequisite** -- not logged in: tell the agent to
  prompt the user to log in first, rather than returning a bare 401.
- **Invalid parameter** -- malformed date: tell the agent the expected
  format so it can retry, rather than returning a generic parse error.
- **Unexpected return value** -- empty result set: tell the agent to suggest
  broadening the search, rather than returning an empty list silently.
- **Business-logic violation** -- booking conflict: tell the agent to
  suggest alternate times, rather than returning "conflict: true".

```js
async execute({ date, partySize }) {
  if (!session.isAuthenticated) {
    return { content: [{ type: "text", text: "The user is not logged in. Ask them to sign in, then retry this booking." }] };
  }
  if (!isValidDate(date)) {
    return { content: [{ type: "text", text: `"${date}" isn't a recognized date. Ask the user for a date like "2026-09-15" or "next Friday".` }] };
  }
  const slots = await findAvailableSlots(date, partySize);
  if (slots.length === 0) {
    return { content: [{ type: "text", text: `No tables for ${partySize} on ${date}. Suggest the user try a nearby date or a smaller party size.` }] };
  }
  const conflict = await checkConflict(date, partySize);
  if (conflict) {
    return { content: [{ type: "text", text: `That slot just filled. Alternate times: ${conflict.alternatives.join(", ")}. Suggest one to the user.` }] };
  }
  // proceed with booking
}
```

## Register With State

Wrong -- registering a tool once at module load, regardless of what's on
screen:

```js
// runs at import time, before the results view even exists
document.modelContext.registerTool({ name: "filter_results", /* ... */ });
// page has no results yet -> agent calls it, filter has nothing to act on
```

Right -- register when the relevant view mounts, and abort when it
unmounts:

```js
function ResultsList() {
  useEffect(() => {
    const controller = new AbortController();
    document.modelContext.registerTool(
      { name: "filter_results", /* ... */ },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, []);
  // ...
}
```

A tool advertised against a view it doesn't apply to is a tool the agent
will call and fail on. Scope registration lifetime to the state it acts on.

## References

- `references/tool-design-framework.md` -- read before designing a new tool set from scratch (not needed when just editing an existing tool's contract).
