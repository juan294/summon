import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRex, rexCandidatePaths, defaultRexServer } from "./cli.js";

let root: string;
let savedPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "summon-rex-cli-"));
  savedPath = process.env["PATH"];
  // An empty PATH entry keeps `which rex` from finding a real binary.
  process.env["PATH"] = join(root, "empty-bin");
  mkdirSync(join(root, "empty-bin"));
});

afterEach(() => {
  if (savedPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = savedPath;
  rmSync(root, { recursive: true, force: true });
});

function fakeBinary(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}

describe("rexCandidatePaths", () => {
  it("lists REX_BIN_DIR first, then the bundled helpers under /Applications and ~/Applications", () => {
    const paths = rexCandidatePaths({ REX_BIN_DIR: "/bin-dir" }, "/Users/me");
    expect(paths).toEqual([
      "/bin-dir/rex",
      "/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
      "/Applications/Rex.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
      "/Users/me/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
      "/Users/me/Applications/Rex.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
    ]);
  });

  it("omits the REX_BIN_DIR entry when the variable is unset", () => {
    expect(rexCandidatePaths({}, "/Users/me")[0]).toContain("/Applications/Rex Beta.app");
  });
});

describe("discoverRex", () => {
  it("prefers PATH over every bundle candidate", () => {
    const bin = join(root, "on-path");
    fakeBinary(join(bin, "rex"));
    process.env["PATH"] = bin;
    const bundle = join(root, "Rex Beta.app", "rex");
    fakeBinary(bundle);
    expect(discoverRex({}, [bundle])).toEqual({ path: join(bin, "rex"), searched: ["PATH"] });
  });

  it("walks the candidates in order and reports what it searched", () => {
    const first = join(root, "a", "rex");
    const second = join(root, "b", "rex");
    fakeBinary(second);
    expect(discoverRex({}, [first, second])).toEqual({ path: second, searched: ["PATH", first, second] });
  });

  it("returns null with the full search list when nothing exists", () => {
    const candidate = join(root, "missing", "rex");
    expect(discoverRex({}, [candidate])).toEqual({ path: null, searched: ["PATH", candidate] });
  });

  it("derives candidates from REX_BIN_DIR by default", () => {
    const binDir = join(root, "rex-bin");
    fakeBinary(join(binDir, "rex"));
    expect(discoverRex({ REX_BIN_DIR: binDir }).path).toBe(join(binDir, "rex"));
  });
});

describe("defaultRexServer", () => {
  it("percent-encodes the Application Support path", () => {
    expect(defaultRexServer("/Users/me")).toBe("unix:///Users/me/Library/Application%20Support/rex/server.sock");
  });
});
