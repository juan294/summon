/**
 * Release-required probe set (playbook Wave A3).
 *
 * Chosen by risk from summon's own critical paths, and constrained by a hard
 * fact: a real Ghostty launch cannot run in hosted CI (no TCC grant, no GUI
 * session, no resolvable AppleScript dictionary). So every probe here runs on
 * the one surface that genuinely executes headlessly -- `--dry-run`, which
 * skips ensureGhostty/ensureAccessibility/executeScript yet still exercises
 * trust resolution, layered config, layout planning, and the whole AppleScript
 * generator. That is where regressions actually originate.
 *
 * Each top-level describe name IS the probeId in the evidence manifest, so
 * requiredness is machine-readable rather than inferred from prose (D05).
 *
 * `.skip` is banned in this directory and enforced by no-skip.test.ts: a
 * silently skipping required check is the exact bug this whole system exists to
 * prevent.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeIsolatedHome,
  recordedFixtures,
  cleanupCliSnapshot,
  PROJECT_ROOT,
  summonStatePaths,
} from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")) as {
  version: string;
};

afterAll(() => {
  cleanupCliSnapshot();
  // Sidecar consumed by scripts/release/build-manifest.mjs; the vitest JSON
  // reporter has no channel for fixture cleanup state.
  writeFileSync(
    join(PROJECT_ROOT, ".release-fixtures.json"),
    JSON.stringify(recordedFixtures(), null, 2),
    "utf-8",
  );
});

describe("release.candidate-identity", () => {
  it("--version matches package.json and carries no stray output", () => {
    const sandbox = makeIsolatedHome();
    try {
      const result = sandbox.runCli("--version");
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(pkg.version);
      expect(result.stderr).toBe("");
    } finally {
      sandbox.cleanup();
    }
  });

  it("-v fast path agrees with --version", () => {
    const sandbox = makeIsolatedHome();
    try {
      expect(sandbox.runCli("-v").stdout.trim()).toBe(pkg.version);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("release.cli-contract", () => {
  it("--help exits 0 with usage on stdout", () => {
    const sandbox = makeIsolatedHome();
    try {
      const result = sandbox.runCli("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("Options:");
    } finally {
      sandbox.cleanup();
    }
  });

  it("an unknown flag exits 1 and reports on stderr, not stdout", () => {
    const sandbox = makeIsolatedHome();
    try {
      const result = sandbox.runCli("--definitely-not-a-flag");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("summon: error:");
      expect(result.stderr).toContain("Unknown flag");
      expect(result.stdout).toBe("");
    } finally {
      sandbox.cleanup();
    }
  });

  it("a missing target directory exits 1 with a clear error", () => {
    const sandbox = makeIsolatedHome();
    try {
      const result = sandbox.runCli("--dry-run", join(sandbox.home, "no-such-dir"));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("summon: error:");
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("release.dry-run-golden", () => {
  it("emits AppleScript with the load-bearing structure intact", () => {
    const sandbox = makeIsolatedHome();
    try {
      const result = sandbox.runCli("--dry-run", "--editor", "vim", sandbox.projectDir);
      expect(result.status).toBe(0);

      const out = result.stdout;
      // Structure that the whole product depends on. If script.ts regresses,
      // these are the lines that stop being true.
      expect(out).toContain('tell application "Ghostty"');
      expect(out).toContain("new surface configuration");
      expect(out).toContain("set initial working directory of cfg to");
      expect(out).toContain(sandbox.projectDir);
      expect(out).toContain("SUMMON_WORKSPACE=1");
      expect(out).toContain("split paneRoot direction right");
      expect(out).toContain("end tell");
      // Status markers are written by the injected shell, not by Node.
      expect(out).toContain("status");
    } finally {
      sandbox.cleanup();
    }
  });

  it("never emits an unescaped newline inside an AppleScript string literal", () => {
    const sandbox = makeIsolatedHome();
    try {
      const out = sandbox.runCli("--dry-run", "--editor", "vim", sandbox.projectDir).stdout;
      for (const line of out.split("\n")) {
        const quotes = (line.match(/(?<!\\)"/g) ?? []).length;
        expect(quotes % 2, `unbalanced quotes in: ${line}`).toBe(0);
      }
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("release.trust-enforcement", () => {
  it("blocks an untrusted .summon, allows it after trust, and revokes on edit", () => {
    const sandbox = makeIsolatedHome();
    try {
      sandbox.writeProjectConfig("editor=vim\n");

      // 1. Untrusted -> blocked.
      const untrusted = sandbox.runCli("--dry-run", sandbox.projectDir);
      expect(untrusted.status).toBe(1);
      expect(`${untrusted.stdout}${untrusted.stderr}`).toContain("summon trust");

      // 2. Trusted -> proceeds.
      expect(sandbox.runCli("trust", sandbox.projectDir).status).toBe(0);
      expect(sandbox.runCli("--dry-run", sandbox.projectDir).status).toBe(0);

      // 3. Content change revokes trust (the hash is over the body, not the path).
      sandbox.writeProjectConfig("editor=vim\nsidebar=lazygit\n");
      const mutated = sandbox.runCli("--dry-run", sandbox.projectDir);
      expect(mutated.status).toBe(1);
      expect(`${mutated.stdout}${mutated.stderr}`).toContain("summon trust");
    } finally {
      sandbox.cleanup();
    }
  });

  it("--no-project-config bypasses the gate without reading the file", () => {
    const sandbox = makeIsolatedHome();
    try {
      sandbox.writeProjectConfig("editor=vim\n");
      const result = sandbox.runCli(
        "--dry-run",
        "--no-project-config",
        "--editor",
        "vim",
        sandbox.projectDir,
      );
      expect(result.status).toBe(0);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("release.dangerous-command-refusal", () => {
  // Runs before ensureGhostty (launcher.ts:930 vs :781), so this is valid on a
  // runner with no Ghostty installed.
  it("refuses shell metacharacters with exit 2 when stdin is not a TTY", () => {
    const sandbox = makeIsolatedHome();
    try {
      const result = sandbox.runCli("--editor", "vim; rm -rf /tmp/x", sandbox.projectDir);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("not a TTY");
    } finally {
      sandbox.cleanup();
    }
  });

  it("does not execute anything when it refuses", () => {
    const sandbox = makeIsolatedHome();
    const canary = join(sandbox.home, "canary");
    try {
      const result = sandbox.runCli(
        "--editor",
        `vim; touch ${canary}`,
        sandbox.projectDir,
      );
      expect(result.status).toBe(2);
      expect(existsSync(canary)).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("release.injection-defense", () => {
  it("the static escape-lint gate is present and non-trivial", () => {
    // CLAUDE.md marks this file load-bearing: it is the primary injection
    // defense and removing it removes the gate.
    const gate = join(PROJECT_ROOT, "src", "shell-escape.lint.test.ts");
    expect(existsSync(gate)).toBe(true);
    const source = readFileSync(gate, "utf-8");
    expect(source).toContain("DANGER_CONTEXT");
    expect(source).toContain("lint-allow-escape");
    expect(source.split("\n").length).toBeGreaterThan(200);
  });

  it("escape helpers still neutralise the payloads they exist for", async () => {
    const { escapeAppleScript, shellQuote } = await import("../shell-escape.js");
    expect(escapeAppleScript('a"b')).not.toContain('a"b');
    expect(escapeAppleScript("a\nb")).not.toContain("\n");
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
  });
});

describe("release.state-isolation", () => {
  it("--dry-run writes no status records", () => {
    const sandbox = makeIsolatedHome();
    try {
      expect(sandbox.runCli("--dry-run", "--editor", "vim", sandbox.projectDir).status).toBe(0);
      const statusDir = join(sandbox.home, ".config", "summon", "status");
      // A dry run must not record a workspace as active.
      expect(existsSync(join(statusDir, "project.active"))).toBe(false);
      expect(existsSync(join(statusDir, "project.json"))).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  it("the project registry round-trips through add and list", () => {
    const sandbox = makeIsolatedHome();
    try {
      expect(sandbox.runCli("add", "probeproj", sandbox.projectDir).status).toBe(0);
      const listed = sandbox.runCli("list");
      expect(listed.status).toBe(0);
      expect(listed.stdout).toContain("probeproj");

      expect(sandbox.runCli("remove", "probeproj").status).toBe(0);
      expect(sandbox.runCli("list").stdout).not.toContain("probeproj");
    } finally {
      sandbox.cleanup();
    }
  });

  it("writes state only under the sandboxed HOME", () => {
    const sandbox = makeIsolatedHome();
    try {
      sandbox.runCli("add", "probeproj", sandbox.projectDir);
      for (const path of summonStatePaths(sandbox.home)) {
        expect(path.startsWith(sandbox.home)).toBe(true);
      }
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("release.cleanup", () => {
  it("removes its sandbox completely, leaving zero residue", () => {
    const sandbox = makeIsolatedHome();
    sandbox.runCli("add", "probeproj", sandbox.projectDir);
    const home = sandbox.home;
    expect(existsSync(home)).toBe(true);

    sandbox.cleanup();

    expect(existsSync(home)).toBe(false);
    const record = recordedFixtures().find((f) => f.id === sandbox.fixtureId);
    expect(record?.cleanupStatus).toBe("removed");
  });

  it("every fixture created by this run was removed", () => {
    const leaked = recordedFixtures().filter((f) => f.cleanupStatus !== "removed");
    expect(leaked).toEqual([]);
  });
});
