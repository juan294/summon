# Pseudocode Notation for Plans

Plans use a compact pseudocode to describe changes. This keeps plans concise and focused on intent rather than syntax.

## Rules

- 5-12 lines total per block; max 1 sentence per line; fragments OK.
- Only these keys: `@`, `ctx`, `pre`, `do`, `br`, `fx`, `fail`, `risk`.
- `do:` must have 2-6 numbered steps using small verbs: validate, parse, lookup, compute, write, emit, retry, cache.
- Include `br`/`fx`/`fail`/`risk` only if real; append `?` if uncertain.

## Template

```
@ functionName(inputs) -> outputs
ctx: external IO/dependencies
pre: must-hold assumptions
do:
  1. verb object (why)
  2. verb object (why)
br: if guard -> outcome; else -> outcome
fx: writes/emits/mutates
fail: trigger -> return/throw
risk: hazards
```

## Example

```
@ createOrder(userId, items) -> orderId
ctx: DB(tx), inventorySvc, eventBus
pre: items non-empty; user exists
do:
  1. validate items + price snapshot
  2. reserve inventory (idempotent key)
  3. write order + lines (tx)
  4. emit OrderCreated(orderId)
br: if reserve fails -> return OutOfStock
fx: DB write(order, lines); bus emit
risk: double-emit unless tx/outbox
```
