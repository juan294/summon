import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node18",
  clean: true,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
  minify: true,
  define: { __VERSION__: JSON.stringify(version) },
});
