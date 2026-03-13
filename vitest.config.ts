import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts", // CLI entry point — tested via subprocess, not instrumentable by v8
        "src/globals.d.ts", // type-only file — no runtime code to cover
      ],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 85,
        lines: 60,
      },
    },
  },
});
