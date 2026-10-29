/**
 * Release-probe harness.
 *
 * Every probe runs the built CLI against a throwaway HOME. This is mandatory,
 * not hygiene: `ensureConfig()` creates the config dir on the first KV read and
 * the persistent cache flushes on process exit, so even nominally read-only
 * commands (`list`, `config`, `ports`, `briefing`) write to disk. A probe
 * running against the real HOME would mutate the maintainer's config.
 *
 * Fixture ids share the `summon-rel` prefix used by /explore-release charters,
 * so automated and exploratory fixtures live in one namespace with one cleanup
 * rule (playbook D19).
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_DIR = join(PROJECT_ROOT, "dist");

/**
 * Probes run against an immutable copy of dist/, not dist/ itself.
 *
 * src/index.test.ts rebuilds the project in its beforeAll, and tsup cleans the
 * output folder first. Under the full suite that races with these probes and
 * they fail with "Cannot find module dist/index.js" -- a flaky required probe,
 * which is precisely the failure mode this system exists to prevent. Snapshot
 * once per worker and the race disappears.
 */
let snapshotDir: string | null = null;

function snapshotCli(): string {
  if (snapshotDir && existsSync(snapshotDir)) return join(snapshotDir, "index.js");

  let lastError: unknown;
  // A concurrent `tsup` clean can empty dist mid-copy; retry across the window.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      if (existsSync(join(DIST_DIR, "index.js"))) {
        const target = mkdtempSync(join(tmpdir(), "summon-rel-cli-"));
        cpSync(DIST_DIR, target, { recursive: true });
        if (existsSync(join(target, "index.js"))) {
          snapshotDir = target;
          return join(target, "index.js");
        }
        rmSync(target, { recursive: true, force: true });
      }
    } catch (err) {
      lastError = err;
    }
    // Synchronous backoff: this runs inside a test body, not an async context.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }

  throw new Error(
    `release probes require a build: could not snapshot ${DIST_DIR}. ` +
      `Run \`pnpm build\` first.${lastError ? ` Last error: ${String(lastError)}` : ""}`,
  );
}

/** Remove the per-worker CLI snapshot. Safe to call more than once. */
export function cleanupCliSnapshot(): void {
  if (snapshotDir) {
    rmSync(snapshotDir, { recursive: true, force: true });
    snapshotDir = null;
  }
}

/** Shared fixture prefix — also bound into .claude/commands/explore-release.md. */
export const FIXTURE_PREFIX = "summon-rel";

/** Run id ties every fixture in one invocation together. */
export const RUN_ID = process.env["SUMMON_RELEASE_RUN_ID"] ?? String(process.pid);

export interface FixtureRecord {
  id: string;
  cleanupStatus: "removed" | "leaked";
}

const fixtures: FixtureRecord[] = [];
let counter = 0;

/** Fixtures recorded so far, for the evidence manifest. */
export function recordedFixtures(): FixtureRecord[] {
  return [...fixtures];
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface IsolatedHome {
  /** Throwaway HOME for this probe. */
  home: string;
  /** A project directory inside the sandbox, safe to launch against. */
  projectDir: string;
  /** Stable fixture id recorded in the evidence manifest. */
  fixtureId: string;
  /** Run the built CLI with HOME pointed at the sandbox, stdin closed (non-TTY). */
  runCli(...args: string[]): CliResult;
  /** Write a `.summon` project config into projectDir. */
  writeProjectConfig(contents: string): void;
  /** Remove the sandbox and record whether it actually went away. */
  cleanup(): void;
}

/**
 * Create an isolated HOME plus a project directory inside it.
 *
 * Callers MUST invoke `cleanup()`; the cleanup probe asserts zero residue.
 */
export function makeIsolatedHome(): IsolatedHome {
  const cliPath = snapshotCli();

  counter += 1;
  const fixtureId = `${FIXTURE_PREFIX}-${RUN_ID}-${counter}`;
  const home = mkdtempSync(join(tmpdir(), `${fixtureId}-`));
  const projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });

  return {
    home,
    projectDir,
    fixtureId,

    runCli(...args: string[]): CliResult {
      const result = spawnSync("node", [cliPath, ...args], {
        cwd: projectDir,
        // stdin "ignore" makes process.stdin.isTTY false, which is what the
        // non-interactive refusal path keys on.
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
        timeout: 30_000,
        env: { ...process.env, HOME: home, SUMMON_NO_CACHE: "1" },
      });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },

    writeProjectConfig(contents: string): void {
      writeFileSync(join(projectDir, ".summon"), contents, "utf-8");
    },

    cleanup(): void {
      rmSync(home, { recursive: true, force: true });
      fixtures.push({ id: fixtureId, cleanupStatus: existsSync(home) ? "leaked" : "removed" });
    },
  };
}

/**
 * Paths summon may create under a HOME. Used by the cleanup probe to prove the
 * sandbox is gone rather than merely emptied.
 */
export function summonStatePaths(home: string): string[] {
  const base = join(home, ".config", "summon");
  if (!existsSync(base)) return [];
  return readdirSync(base).map((entry) => join(base, entry));
}
