import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cliBuild } from "./fixtures/cli-builds.js";
import { gitSafeEnv } from "./utils.js";

it("distinguishes missing and damaged projects from an empty Git worktree", () => {
  const home = mkdtempSync(join(tmpdir(), "summon-briefing-cli-"));
  try {
    const registry = join(home, ".config", "summon");
    const empty = join(home, "empty");
    const missing = join(home, "missing");
    const damaged = join(home, "damaged");
    const env = { ...gitSafeEnv(), HOME: home, NO_COLOR: "1" };
    mkdirSync(registry, { recursive: true });
    execFileSync("git", ["init", "-q", empty], { env });
    execFileSync("git", ["init", "-q", "-b", "main", damaged], { env });
    writeFileSync(join(damaged, ".git", "refs", "heads", "main"), "a".repeat(40) + "\n");
    writeFileSync(join(registry, "projects"), `empty=${empty}\nmissing=${missing}\ndamaged=${damaged}\n`);
    const output = execFileSync(process.execPath, [cliBuild("unsplit"), "briefing"], {
      encoding: "utf-8", env,
    });
    expect(output.match(/Commit history unavailable/g)).toHaveLength(2);
    expect(output.match(/Working tree status unavailable/g)).toHaveLength(2);
    expect(output.match(/Clean working tree/g)).toHaveLength(1);
    expect(output.match(/No new commits/g)).toHaveLength(1);
    expect(output).not.toContain("All projects clean");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
