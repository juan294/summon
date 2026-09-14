---
description: WebMCP tool authoring -- registration lifecycle, adapter isolation, and the tool contract
paths:
  - "**/*webmcp*"
  - "**/tools/**"
  - "**/*.tool.{ts,tsx,js,jsx}"
---

# WebMCP Rules

`paths` above is a starting point, not a final answer -- `/bootstrap`,
`/adopt`, and `/update` all instruct the installing agent to adapt `paths`
to the project's actual structure, the same contract the other five rule
templates carry.

## Adapter Isolation

- The `document.modelContext` global is pre-standard and shipping behind
  experimental browser implementations. Feature-detect it and confine every
  reference to it to a single
  adapter module.
- Tool handlers import the adapter -- they never touch the global
  directly. When the spec moves, the change is one file.
- This is rule #91.

## Edit-Time Checklist

- One function per tool -- no multi-purpose dispatch tools.
- Name the tool by its effect, not its implementation.
- Accept raw input -- never internal IDs the model cannot see.
- Validate strictly in code, not by trusting the model's input.
- Return errors as recovery instructions, not stack traces.
- Register and unregister the tool with the view's lifecycle,
  not once at load time.

For the full tool contract and worked examples, see the webmcp skill.
