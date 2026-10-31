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
import { inject } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cliBuild } from "../fixtures/cli-builds.js";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let cliPath: string | null = null;

/**
 * Call from beforeAll. `pnpm test:release` (SUMMON_PROBE_DIST=1, the CI and release jobs, which
 * build dist/ first) probes that build: the release candidate, through the copy of dist/ the
 * globalSetup (src/fixtures/cli-builds.setup.ts) made once before any test ran, so a later
 * `pnpm build` cannot empty it mid-run. Every other run (`pnpm test`, the pre-commit hook) probes
 * the run's private production build of the current source, so a stale local dist/ is never what
 * gets probed.
 */
export async function prepareCli(): Promise<void> {
  if (process.env["SUMMON_PROBE_DIST"] === "1") {
    const snapshot = inject("summonCliDistSnapshot");
    if (!snapshot) throw new Error("SUMMON_PROBE_DIST=1 needs a built dist/ (run pnpm build first)");
    cliPath = snapshot;
    return;
  }
  cliPath = cliBuild("production");
}

function snapshotCli(): string {
  if (!cliPath) throw new Error("release probes: call prepareCli() in beforeAll first");
  return cliPath;
}

/** Forget the probed CLI; the globalSetup removes the build itself. Safe to call more than once. */
export function cleanupCliSnapshot(): void {
  cliPath = null;
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
        env: { ...process.env, HOME: home },
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
