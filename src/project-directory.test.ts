import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sameProjectDirectory } from "./project-directory.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "summon-project-directory-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "one", "alpha"), { recursive: true });
mkdirSync(join(root, "two", "alpha"), { recursive: true });
symlinkSync(join(root, "one"), join(root, "link"));
const caseInsensitive = statSync(join(root, "ONE"), { throwIfNoEntry: false }) !== undefined;

describe("sameProjectDirectory", () => {
  it.skipIf(!caseInsensitive)("accepts another letter case of the same directory on a case-insensitive disk", () => {
    expect(sameProjectDirectory(join(root, "one", "alpha"), join(root, "ONE", "Alpha"))).toBe(true);
  });

  it("accepts a symlink to the same directory and a trailing slash", () => {
    expect(sameProjectDirectory(join(root, "one", "alpha"), join(root, "link", "alpha"))).toBe(true);
    expect(sameProjectDirectory(join(root, "one", "alpha"), `${join(root, "one", "alpha")}/`)).toBe(true);
  });

  it("refuses two checkouts and a path that does not exist", () => {
    expect(sameProjectDirectory(join(root, "one", "alpha"), join(root, "two", "alpha"))).toBe(false);
    expect(sameProjectDirectory(join(root, "one", "alpha"), join(root, "gone"))).toBe(false);
  });
});
