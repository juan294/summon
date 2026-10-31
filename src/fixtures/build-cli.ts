import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "tsup";

export interface BuildCliOptions {
  /**
   * Bundle with the shipped tsup.config.ts (code splitting, minify, shebang banner, executable
   * entry) instead of one unsplit file, for suites that assert on the published bundle shape.
   * The output gets the package's `"type": "module"` marker, so Node loads it as the installed
   * package (without it, Node falls back to ESM syntax detection and traces modules differently).
   */
  production?: boolean;
}

/**
 * Test support: bundle the CLI into a private directory so subprocess tests never race the
 * shared `dist/` build (two suites running `pnpm build` at once clobber each other).
 * Returns the bundled entry path.
 */
export async function buildCliInto(projectRoot: string, outDir: string, options: BuildCliOptions = {}): Promise<string> {
  const entry = { index: join(projectRoot, "src", "index.ts") };
  if (options.production) {
    // tsup.config.ts reads ./package.json, so it must load from the project root.
    if (resolve(process.cwd()) !== resolve(projectRoot)) {
      throw new Error(`buildCliInto: a production build must run from ${projectRoot}, not ${process.cwd()}`);
    }
    await build({ config: join(projectRoot, "tsup.config.ts"), entry, outDir, silent: true });
    writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
    return join(outDir, "index.js");
  }
  const { version } = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8")) as { version: string };
  await build({
    config: false,
    entry,
    outDir,
    platform: "node",
    format: ["esm"],
    target: "node22",
    splitting: false,
    define: { __VERSION__: JSON.stringify(version) },
    silent: true,
  });
  return join(outDir, "index.js");
}
