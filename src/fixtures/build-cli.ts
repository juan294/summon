import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "tsup";

/**
 * Test support: bundle the CLI into a private directory so subprocess tests never race the
 * shared `dist/` build (two suites running `pnpm build` at once clobber each other).
 * Returns the bundled entry path.
 */
export async function buildCliInto(projectRoot: string, outDir: string): Promise<string> {
  const { version } = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8")) as { version: string };
  await build({
    config: false,
    entry: { index: join(projectRoot, "src", "index.ts") },
    outDir,
    platform: "node",
    format: ["esm"],
    target: "node20",
    splitting: false,
    define: { __VERSION__: JSON.stringify(version) },
    silent: true,
  });
  return join(outDir, "index.js");
}
