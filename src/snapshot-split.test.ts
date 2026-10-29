import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_SNAPSHOTS_DIR = join(tmpdir(), `summon-snapshot-split-${process.pid}`);
const REPO = join(tmpdir(), `summon-snapshot-split-repo-${process.pid}`);

vi.mock("./paths.js", () => ({
  SNAPSHOTS_DIR: TEST_SNAPSHOTS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-test-${process.pid}`),
}));

const { collectSnapshot, writeSnapshotFile, saveSnapshot, readSnapshot } = await import("./snapshot.js");
const { gitSafeEnv } = await import("./utils.js");

// gitSafeEnv strips GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE: under the pre-commit hook git exports
// them, and a plain `...process.env` would make these fixture commits land on the real branch.
const gitEnv = { ...gitSafeEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };

beforeEach(() => {
  rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(REPO, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: REPO, env: gitEnv });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: REPO, env: gitEnv });
});

afterEach(() => {
  rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
  rmSync(REPO, { recursive: true, force: true });
});

describe("collectSnapshot / writeSnapshotFile (plan Phase 1 deliverable 3)", () => {
  it("collectSnapshot gathers git state without writing a file", () => {
    const snapshot = collectSnapshot("demo", REPO, "full");
    expect(snapshot).toMatchObject({ project: "demo", directory: REPO, layout: "full", version: 1, git: { branch: "main", dirty: [] } });
    expect(snapshot?.git.recentCommits[0]).toContain("init");
    expect(existsSync(TEST_SNAPSHOTS_DIR)).toBe(false);
  });

  it("collectSnapshot returns null for a missing directory", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(collectSnapshot("demo", join(REPO, "missing"), "full")).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("writeSnapshotFile writes exactly what collectSnapshot returned", () => {
    const snapshot = collectSnapshot("demo", REPO, "full")!;
    writeSnapshotFile(snapshot);
    const raw = readFileSync(join(TEST_SNAPSHOTS_DIR, "demo.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(snapshot);
    expect(raw.endsWith("\n")).toBe(true);
    expect(readSnapshot("demo")).toEqual(snapshot);
  });

  it("saveSnapshot keeps its signature: collect then write", () => {
    const result = saveSnapshot("demo", REPO, "pair");
    expect(result?.layout).toBe("pair");
    expect(readSnapshot("demo")).toEqual(result);
  });

  it("writeSnapshotFile rejects a path-traversing project name", () => {
    const snapshot = collectSnapshot("demo", REPO, "full")!;
    expect(() => writeSnapshotFile({ ...snapshot, project: "../../etc/evil" })).toThrow("Invalid snapshot path");
  });
});
