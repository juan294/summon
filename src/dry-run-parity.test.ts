import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cliBuild } from "./fixtures/cli-builds.js";
import { LAUNCH_ID_RE } from "./launch-identity.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/**
 * Plan D8 / Phase 1 acceptance: `summon . --dry-run` differs from develop (f5f7901) only by
 * the two new header lines and the two typed lines (bootstrap, trap). The fixture was captured
 * from the develop build with the same arguments and a fresh HOME.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(PROJECT_ROOT, "src", "fixtures", "dry-run-develop-f5f7901.txt");
const FIXTURE_TARGET = "/tmp/summon-dryrun-fixture";

let tempRoot: string;
let cli: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "summon-dryrun-parity-"));
  cli = cliBuild("unsplit");
  mkdirSync(join(tempRoot, "summon-dryrun-fixture"));
  mkdirSync(join(tempRoot, "home"));
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

interface Normalized { lines: string[]; replaced: { bootstrap: number; trap: number }; headers: string[] }

function normalize(text: string, target: string): Normalized {
  const replaced = { bootstrap: 0, trap: 0 };
  const headers: string[] = [];
  const lines: string[] = [];
  for (const raw of text.replaceAll(target, FIXTURE_TARGET).split("\n")) {
    if (raw.startsWith("-- Backend: ") || raw.startsWith("-- Launch: ")) { headers.push(raw); continue; }
    if (raw.includes('input text "mkdir -p \\"$HOME/.config/summon/status')) { replaced.bootstrap++; lines.push("<BOOTSTRAP>"); continue; }
    if (raw.includes("__summon_cleanup()")) { replaced.trap++; lines.push("<TRAP>"); continue; }
    lines.push(raw);
  }
  return { lines, replaced, headers };
}

describe("dry-run parity with develop (plan D8)", () => {
  it("differs only by the backend/launch header lines and the two typed lines", () => {
    const target = join(tempRoot, "summon-dryrun-fixture");
    const result = spawnSync("node", [cli, target, "--dry-run", "--editor", "nvim", "--sidebar", "lazygit"], {
      encoding: "utf-8",
      env: { ...process.env, HOME: join(tempRoot, "home") },
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);

    const current = normalize(result.stdout, target);
    const pinned = normalize(readFileSync(FIXTURE, "utf-8"), FIXTURE_TARGET);

    expect(pinned.headers).toEqual([]);
    expect(pinned.replaced).toEqual({ bootstrap: 1, trap: 1 });
    expect(current.replaced).toEqual({ bootstrap: 1, trap: 1 });
    expect(current.headers).toHaveLength(2);
    expect(current.headers[0]).toBe("-- Backend: ghostty");
    expect(current.headers[1]?.slice("-- Launch: ".length)).toMatch(LAUNCH_ID_RE);
    expect(current.lines).toEqual(pinned.lines);
  });
});
