import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

function run(...args: string[]) {
  return spawnSync("node", ["dist/index.js", ...args], {
    encoding: "utf-8",
    cwd: "/tmp/summon-wt-6",
    env: { ...process.env, HOME: process.env.HOME },
  });
}

beforeAll(() => {
  execSync("pnpm build", { cwd: "/tmp/summon-wt-6", stdio: "ignore" });
});

describe("CLI integration", () => {
  it("prints help with --help and exits 0", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("summon");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Options:");
  });

  it("prints version with --version and exits 0", () => {
    const result = run("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("shows help and exits 0 with no arguments", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("errors on invalid flag and exits 1", () => {
    const result = run("--invalid-flag");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
    expect(result.stderr).toContain("summon --help");
  });

  it("errors on 'add' with missing arguments", () => {
    const result = run("add");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon add");
  });

  it("errors on 'add' with only name", () => {
    const result = run("add", "myproject");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon add");
  });

  it("errors on 'remove' with missing name", () => {
    const result = run("remove");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon remove");
  });

  it("errors on 'set' with missing key", () => {
    const result = run("set");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon set");
  });

  it("shows empty project list", () => {
    const result = run("list");
    // May show projects or empty message depending on user's config
    expect(result.status).toBe(0);
  });

  it("errors on unknown project name", () => {
    const result = run("nonexistent-project-12345");
    // Will either fail as unknown project or fail because Ghostty isn't available
    expect(result.status).not.toBe(0);
  });
});
