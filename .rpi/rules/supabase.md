---
description: Supabase migration safety -- local testing, GRANTs, fallback logging, health checks
paths:
  - supabase/**
  - "**/*.sql"
  - "**/migrations/**"
---

# Supabase Rules

## Migration Rules

- Declare the intended access per table. SQL grants permit operations; RLS
  policies constrain rows. Test both, including expected denials.
- Preserve deliberate public-data and owner-only contracts. Do not add anon
  SELECT to private tables or all future tables as a generic fix.
- Default privileges apply to future objects created by the named owner.
  Inspect global and per-schema defaults and existing table grants separately.

## Fallback Observability

- If a query fails and code falls back to defaults,
  log `[TABLE_FALLBACK]` at ERROR -- not INFO.
- Health endpoints must check actual data access,
  not just connectivity.
  Return `"degraded"` if primary tables are inaccessible.

## Migration Safety

Test migrations on a disposable, task-owned local stack:

1. `supabase start` (requires a local container runtime)
2. `supabase db reset --local` (destructive to local data; preserve shared data)
3. `supabase status` to discover the local database endpoint
4. Run SQL tests as anon, authenticated owner, nonowner, and service role,
   including expected denials and future-table exposure

A postgres-only query cannot verify RLS. Local success does not prove remote
parity. Remote `supabase db push` is a separate authorized action after target
inspection; do not invoke it from the local test procedure.

For full migration procedures, see the supabase skill.
