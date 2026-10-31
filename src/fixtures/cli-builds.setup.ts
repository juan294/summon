import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { buildCliInto } from "./build-cli.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_DIR = join(PROJECT_ROOT, "dist");

/**
 * Vitest globalSetup: bundle each CLI flavor once per run into private temp dirs, so subprocess
 * suites share two builds instead of building their own, and none reads the shared dist/ (a
 * concurrent `pnpm build` empties it). Under SUMMON_PROBE_DIST=1 (`pnpm test:release`, after
 * `pnpm build`) it also copies dist/ once, so the release probes run the candidate build from an
 * immutable copy. Suites read the paths with cliBuild() from ./cli-builds.ts.
 */
export default async function setup(project: TestProject): Promise<() => void> {
  const dirs: string[] = [];
  const temp = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };

  const prepare = async () => {
    let distSnapshot: string | null = null;
    if (process.env["SUMMON_PROBE_DIST"] === "1") {
      if (!existsSync(join(DIST_DIR, "index.js"))) throw new Error("SUMMON_PROBE_DIST=1 needs a built dist/ (run pnpm build first)");
      const target = temp("summon-rel-cli-");
      cpSync(DIST_DIR, target, { recursive: true });
      distSnapshot = join(target, "index.js");
      if (!existsSync(distSnapshot)) throw new Error(`SUMMON_PROBE_DIST=1: copying ${DIST_DIR} produced no index.js`);
    }
    const [unsplit, production] = await Promise.all([
      buildCliInto(PROJECT_ROOT, temp("summon-cli-unsplit-")),
      buildCliInto(PROJECT_ROOT, temp("summon-cli-production-"), { production: true }),
    ]);
    project.provide("summonCliUnsplit", unsplit);
    project.provide("summonCliProduction", production);
    project.provide("summonCliDistSnapshot", distSnapshot);
  };

  const cleanup = () => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  };

  await prepare();
  // Watch mode: rebuild from the edited source before each rerun.
  project.onTestsRerun(async () => {
    cleanup();
    await prepare();
  });
  return cleanup;
}
