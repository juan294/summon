import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Cap worker pool to reduce starvation risk on high-load machines.
    // Default is numCPUs; 8 leaves headroom while preserving parallelism.
    maxWorkers: 8,
    // Subprocess-spawning tests in index.test.ts legitimately need more than
    // the 5s default under load; raised globally instead of per-test.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts", // CLI entry point — tested via subprocess, not instrumentable by v8
        "src/globals.d.ts", // type-only file — no runtime code to cover
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
