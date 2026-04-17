import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Partial mock: keep readKVFile real, mock listProjects
vi.mock("./config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config.js")>();
  return {
    ...original,
    listProjects: vi.fn().mockReturnValue([]),
  };
});

vi.mock("./status.js", () => ({
  readAllStatuses: vi.fn(() => []),
}));

const { detectProjectPorts, detectAllPorts } = await import("./ports.js");

const { listProjects } = await import("./config.js") as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
};
const { readAllStatuses } = await import("./status.js") as unknown as {
  readAllStatuses: ReturnType<typeof vi.fn>;
};

const TEST_DIR = join(tmpdir(), `summon-ports-test-${process.pid}`);

function projectDir(name: string): string {
  const dir = join(TEST_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  listProjects.mockReturnValue([]);
  readAllStatuses.mockReturnValue([]);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("detectProjectPorts", () => {
  it("detects port from env.PORT in .summon file", () => {
    const dir = projectDir("proj-a");
    writeFileSync(join(dir, ".summon"), "env.PORT=3000\n");

    const ports = detectProjectPorts("proj-a", dir, "active");
    expect(ports).toEqual([
      { port: 3000, project: "proj-a", source: "config", state: "active" },
    ]);
  });

  it("detects multiple env port keys from .summon file", () => {
    const dir = projectDir("proj-b");
    writeFileSync(join(dir, ".summon"), "env.PORT=3000\nenv.API_PORT=4000\n");

    const ports = detectProjectPorts("proj-b", dir, "stopped");
    expect(ports).toHaveLength(2);
    expect(ports[0]).toMatchObject({ port: 3000, source: "config" });
    expect(ports[1]).toMatchObject({ port: 4000, source: "config" });
  });

  it("detects port from package.json -p flag", () => {
    const dir = projectDir("proj-c");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { dev: "vite -p 8080" },
      }),
    );

    const ports = detectProjectPorts("proj-c", dir, "unknown");
    expect(ports).toEqual([
      { port: 8080, project: "proj-c", source: "package.json", state: "unknown" },
    ]);
  });

  it("detects port from package.json --port flag", () => {
    const dir = projectDir("proj-d");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { dev: "next dev --port 4200" },
      }),
    );

    const ports = detectProjectPorts("proj-d", dir, "active");
    expect(ports).toEqual([
      { port: 4200, project: "proj-d", source: "package.json", state: "active" },
    ]);
  });

  it("detects port from package.json --port= flag (equals syntax)", () => {
    const dir = projectDir("proj-eq");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { dev: "vite --port=9090" },
      }),
    );

    const ports = detectProjectPorts("proj-eq", dir, "active");
    expect(ports).toEqual([
      { port: 9090, project: "proj-eq", source: "package.json", state: "active" },
    ]);
  });

  it("detects framework default for Next.js (next.config.js exists)", () => {
    const dir = projectDir("proj-next");
    writeFileSync(join(dir, "next.config.js"), "module.exports = {};");

    const ports = detectProjectPorts("proj-next", dir, "active");
    expect(ports).toEqual([
      { port: 3000, project: "proj-next", source: "framework-default", state: "active" },
    ]);
  });

  it("detects framework default for Vite (vite.config.ts exists)", () => {
    const dir = projectDir("proj-vite");
    writeFileSync(join(dir, "vite.config.ts"), "export default {};");

    const ports = detectProjectPorts("proj-vite", dir, "active");
    expect(ports).toEqual([
      { port: 5173, project: "proj-vite", source: "framework-default", state: "active" },
    ]);
  });

  it("detects framework default for Astro (astro.config.mjs exists)", () => {
    const dir = projectDir("proj-astro");
    writeFileSync(join(dir, "astro.config.mjs"), "export default {};");

    const ports = detectProjectPorts("proj-astro", dir, "active");
    expect(ports).toEqual([
      { port: 4321, project: "proj-astro", source: "framework-default", state: "active" },
    ]);
  });

  it("returns empty for project with no port signals", () => {
    const dir = projectDir("proj-empty");

    const ports = detectProjectPorts("proj-empty", dir, "unknown");
    expect(ports).toEqual([]);
  });

  it("explicit config takes priority over framework default (no duplicate)", () => {
    const dir = projectDir("proj-dup");
    // .summon sets PORT=3000, and next.config.js exists (default 3000)
    writeFileSync(join(dir, ".summon"), "env.PORT=3000\n");
    writeFileSync(join(dir, "next.config.js"), "module.exports = {};");

    const ports = detectProjectPorts("proj-dup", dir, "active");
    // Should only have one entry for port 3000, from config (not duplicated)
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({ port: 3000, source: "config" });
  });

  it("deduplicates ports from different sources", () => {
    const dir = projectDir("proj-dedup");
    // .summon sets PORT=8080, and package.json also has -p 8080
    writeFileSync(join(dir, ".summon"), "env.PORT=8080\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { dev: "serve -p 8080" },
      }),
    );

    const ports = detectProjectPorts("proj-dedup", dir, "active");
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({ port: 8080, source: "config" });
  });

  it("ignores invalid JSON in package.json", () => {
    const dir = projectDir("proj-bad-json");
    writeFileSync(join(dir, "package.json"), "{ broken json");

    const ports = detectProjectPorts("proj-bad-json", dir, "unknown");
    expect(ports).toEqual([]);
  });

  it("ignores non-numeric port values in .summon", () => {
    const dir = projectDir("proj-nan");
    writeFileSync(join(dir, ".summon"), "env.PORT=abc\n");

    const ports = detectProjectPorts("proj-nan", dir, "active");
    expect(ports).toEqual([]);
  });

  it("collects ports from multiple scripts in package.json", () => {
    const dir = projectDir("proj-multi");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "vite --port 3000",
          api: "nodemon --port 4000",
        },
      }),
    );

    const ports = detectProjectPorts("proj-multi", dir, "stopped");
    expect(ports).toHaveLength(2);
    expect(ports.map((p) => p.port)).toEqual(expect.arrayContaining([3000, 4000]));
  });
});

describe("detectAllPorts", () => {
  it("returns empty when no projects registered", () => {
    listProjects.mockReturnValue([]);
    const { assignments, conflicts } = detectAllPorts();
    expect(assignments).toEqual([]);
    expect(conflicts.size).toBe(0);
  });

  it("collects ports from all registered projects", () => {
    const dirA = projectDir("proj-a");
    const dirB = projectDir("proj-b");
    writeFileSync(join(dirA, ".summon"), "env.PORT=3000\n");
    writeFileSync(join(dirB, ".summon"), "env.PORT=4000\n");
    listProjects.mockReturnValue([
      ["proj-a", dirA],
      ["proj-b", dirB],
    ]);

    const { assignments, conflicts } = detectAllPorts();
    expect(assignments).toHaveLength(2);
    expect(assignments[0]!.port).toBe(3000); // sorted by port
    expect(assignments[1]!.port).toBe(4000);
    expect(conflicts.size).toBe(0);
  });

  it("marks projects active when status data says active", () => {
    const dir = projectDir("proj-a");
    writeFileSync(join(dir, ".summon"), "env.PORT=3000\n");
    listProjects.mockReturnValue([["proj-a", dir]]);
    readAllStatuses.mockReturnValue([
      { project: "proj-a", state: "active" },
    ]);

    const { assignments } = detectAllPorts();
    expect(assignments[0]!.state).toBe("active");
  });

  it("marks projects stopped when status data says stopped", () => {
    const dir = projectDir("proj-a");
    writeFileSync(join(dir, ".summon"), "env.PORT=3000\n");
    listProjects.mockReturnValue([["proj-a", dir]]);
    readAllStatuses.mockReturnValue([
      { project: "proj-a", state: "stopped" },
    ]);

    const { assignments } = detectAllPorts();
    expect(assignments[0]!.state).toBe("stopped");
  });

  it("sorts assignments by port number", () => {
    const dirA = projectDir("proj-a");
    const dirB = projectDir("proj-b");
    writeFileSync(join(dirA, ".summon"), "env.PORT=9000\n");
    writeFileSync(join(dirB, ".summon"), "env.PORT=3000\n");
    listProjects.mockReturnValue([
      ["proj-a", dirA],
      ["proj-b", dirB],
    ]);

    const { assignments } = detectAllPorts();
    expect(assignments[0]!.port).toBe(3000);
    expect(assignments[1]!.port).toBe(9000);
  });

  it("detects port conflicts between projects", () => {
    const dirA = projectDir("proj-a");
    const dirB = projectDir("proj-b");
    writeFileSync(join(dirA, ".summon"), "env.PORT=3000\n");
    writeFileSync(join(dirB, ".summon"), "env.PORT=3000\n");
    listProjects.mockReturnValue([
      ["proj-a", dirA],
      ["proj-b", dirB],
    ]);

    const { assignments, conflicts } = detectAllPorts();
    expect(assignments).toHaveLength(2);
    expect(conflicts.size).toBe(1);
    expect(conflicts.get(3000)).toEqual(["proj-a", "proj-b"]);
  });

  it("preserves derived state when conflicts are reported", () => {
    const dirA = projectDir("proj-a");
    const dirB = projectDir("proj-b");
    writeFileSync(join(dirA, ".summon"), "env.PORT=3000\n");
    writeFileSync(join(dirB, ".summon"), "env.PORT=3000\n");
    listProjects.mockReturnValue([
      ["proj-a", dirA],
      ["proj-b", dirB],
    ]);
    readAllStatuses.mockReturnValue([
      { project: "proj-a", state: "active" },
      { project: "proj-b", state: "stopped" },
    ]);

    const { assignments, conflicts } = detectAllPorts();
    expect(assignments.map((assignment) => assignment.state)).toEqual(["active", "stopped"]);
    expect(conflicts.get(3000)).toEqual(["proj-a", "proj-b"]);
  });

  it("handles projects with no ports", () => {
    const dir = projectDir("proj-empty");
    listProjects.mockReturnValue([["proj-empty", dir]]);

    const { assignments, conflicts } = detectAllPorts();
    expect(assignments).toEqual([]);
    expect(conflicts.size).toBe(0);
  });

  it("handles mix of conflicting and unique ports", () => {
    const dirA = projectDir("proj-a");
    const dirB = projectDir("proj-b");
    const dirC = projectDir("proj-c");
    writeFileSync(join(dirA, ".summon"), "env.PORT=3000\nenv.API_PORT=4000\n");
    writeFileSync(join(dirB, ".summon"), "env.PORT=3000\n");
    writeFileSync(join(dirC, ".summon"), "env.PORT=5000\n");
    listProjects.mockReturnValue([
      ["proj-a", dirA],
      ["proj-b", dirB],
      ["proj-c", dirC],
    ]);

    const { assignments, conflicts } = detectAllPorts();
    expect(assignments).toHaveLength(4); // 3000 (a), 4000 (a), 3000 (b), 5000 (c)
    expect(conflicts.size).toBe(1);
    expect(conflicts.get(3000)).toEqual(["proj-a", "proj-b"]);
    expect(conflicts.has(4000)).toBe(false);
    expect(conflicts.has(5000)).toBe(false);
  });
});
