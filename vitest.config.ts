import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Bundles each CLI flavor once per run for the subprocess suites (read with cliBuild()).
    globalSetup: ["src/fixtures/cli-builds.setup.ts"],
    // Backend detection (plan P5) reads the terminal that runs the tests. Pin Ghostty so every
    // suite, including subprocess suites that spread process.env, behaves the same under Rex,
    // iTerm or CI. Tests that need another terminal stub TERM_PROGRAM explicitly.
    env: { TERM_PROGRAM: "ghostty" },
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
        "src/e2e/rex-harness.ts", // runs only against a real Rex (gated e2e suites)
        "src/fixtures/cli-builds.setup.ts", // globalSetup: runs in the main process, outside the workers v8 measures
        "src/fixtures/build-cli.ts", // imported only by that globalSetup
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
