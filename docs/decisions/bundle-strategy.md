# ADR: Bundle Strategy — Single-Entry ESM with tsup Code Splitting

**Status:** Accepted  
**Date:** 2026-06-14  
**Issues:** #446 (PE-S1), #329, #330

## Context

Summon is a macOS-only CLI tool with zero runtime dependencies. It is distributed as
a compiled ESM bundle on npm under the `summon-ws` package name. The tool must start
quickly because users invoke it interactively from the terminal, often as a one-shot
command before switching to Ghostty.

Before adopting code splitting, summon used a single monolithic bundle. The bundle
grew as features were added: the interactive setup wizard (`setup.ts`), template
gallery (`setup-gallery.ts`), and layout preview renderer pulled in substantial code
that most invocations never exercise. Cold-start time was measurable even on fast
machines because Node.js had to parse and JIT-compile the entire bundle on every run.

## Decision

### Single entry point with tsup `splitting: true`

The build is configured in `tsup.config.ts` as:

```typescript
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  splitting: true,
  minify: true,
  // ...
});
```

- **One public entry point** (`src/index.ts`) — the CLI dispatch registry.
- **`splitting: true`** — tsup (esbuild) extracts shared code into `chunk-*.js` files.
  Dynamic `import()` calls become true async splits. Static imports are bundled
  together with whichever entry uses them first; shared modules between splits are
  hoisted into a chunk.
- **`minify: true`** — reduces bundle size and speeds up parse time.
- **`format: "esm"`** — ESM allows the Node.js module loader to short-circuit loading
  of unused chunks; CJS cannot do this because `require()` is synchronous.

### Lazy-import registry pattern

`src/index.ts` dispatches commands by name. Heavy sub-commands (setup wizard, gallery,
layout builder) are loaded via dynamic `import()` so their chunks are only pulled in
when actually needed:

```typescript
// example: setup is only imported when the user runs `summon setup`
const { handleSetupCommand } = await import("./commands/setup.js");
```

This keeps the hot path (common commands: launch, status, list) lean. Only the chunks
for those commands load on a typical invocation.

## Trade-offs

### Benefits

- **Faster cold start for common commands.** The hot-path chunks are small. Launching
  a workspace (`summon .`) does not load the setup wizard or gallery code.
- **Incremental loading.** Node's ESM loader skips parsing chunks that are never
  `import()`-ed in a given run.
- **Testable in isolation.** Because each module boundary is preserved by splitting,
  unit tests exercise individual modules without loading unrelated code.

### Costs and limitations

- **Multiple files in `dist/`.** The `files` glob in `package.json` uses
  `"dist/**/*.js"` to capture all chunks. Missing this glob would publish a broken
  package.
- **`setup.ts` chunk is still ~20 KB (PE-S1, #329).** Even with splitting, the setup
  wizard compiles to a large chunk because the layout builder and gallery are statically
  imported inside `setup.ts`. A follow-up refactor would move gallery data behind a
  dynamic import within `setup.ts` itself, reducing the chunk size further. This is
  tracked as known debt PE-S1 in CLAUDE.md.
- **No cross-invocation cache (PE-S2, #330).** Code splitting reduces parse work per
  invocation but not config-read I/O. Config files are mtime-memoized within a single
  run (implemented in WU-E), but a persistent cache surviving across runs would further
  reduce startup cost. Tracked as PE-S2.

## Alternatives Considered

### Single monolithic bundle (no splitting)

Simple to reason about — one file in `dist/`. Rejected because parse time scales
linearly with bundle size and the setup wizard + gallery account for a large fraction
of total code that the majority of invocations never use.

### Multiple entry points

Exposing each sub-command as a separate tsup entry would produce the smallest
possible per-command bundles but would require callers to know which entry to invoke,
breaking the single `summon` binary model. Rejected.

### Bundler alternative (rollup, esbuild directly)

tsup wraps esbuild and handles the Node/ESM/shebang/sourcemap concerns that would
need manual configuration otherwise. The project has no bundler-specific requirements
that justify switching. Retained.

## Consequences

- `dist/` contains `index.js` plus one or more `chunk-*.js` files. The `package.json`
  `files` field must continue to include `"dist/**/*.js"`.
- Any new large feature module should be placed behind a dynamic `import()` in
  `src/index.ts` or in the command handler that first uses it.
- PE-S1 (#329) and PE-S2 (#330) remain open. Neither is blocking; both are
  incremental improvements to cold-start cost beyond what splitting already provides.
