import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));
// `summon keybindings rex` prints this file byte for byte.
const rexAction = readFileSync("./integrations/rex/summon-workspace.lua", "utf-8");

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  splitting: true,
  minify: true,
  define: { __VERSION__: JSON.stringify(version), __REX_ACTION_LUA__: JSON.stringify(rexAction) },
});
