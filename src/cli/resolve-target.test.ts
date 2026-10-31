// Tests for #473 PE-H1: resolveTargetDirectory and expandHome in a leaf module
// These tests verify that the new cli/resolve-target.ts module works correctly.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListProjects = vi.fn(() => new Map<string, string>());
const mockReadStatusRecord = vi.fn((_name: string): { startedAt: string } | null => null);

vi.mock("../config.js", () => ({
  listProjects: () => mockListProjects(),
}));

vi.mock("../status-record.js", () => ({
  readStatusRecord: (name: string) => mockReadStatusRecord(name),
}));

vi.mock("node:os", () => ({
  homedir: () => "/Users/tester",
}));

const { resolveTargetDirectory, expandHome, projectSuggestions, printProjectSuggestions } = await import("./resolve-target.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockListProjects.mockImplementation(() => new Map<string, string>());
  mockReadStatusRecord.mockImplementation(() => null);
});

function captureFailure(target: string, commands: readonly string[] = []): string {
  const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
  try {
    expect(() => resolveTargetDirectory(target, commands)).toThrow("exit:1");
    return writeSpy.mock.calls.map((c) => String(c[0])).join("");
  } finally {
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

describe("resolve-target (PE-H1 #473)", () => {
  describe("expandHome", () => {
    it("expands ~ to the home directory", () => {
      expect(expandHome("~/code/demo")).toBe("/Users/tester/code/demo");
    });

    it("leaves absolute paths unchanged", () => {
      expect(expandHome("/tmp/foo")).toBe("/tmp/foo");
    });

    it("resolves paths without tilde prefix", () => {
      expect(expandHome("relative")).toBe(`${process.cwd()}/relative`);
    });
  });

  describe("resolveTargetDirectory", () => {
    it("resolves '.' to cwd", () => {
      expect(resolveTargetDirectory(".")).toBe(process.cwd());
    });

    it("resolves '..' relative paths", () => {
      const result = resolveTargetDirectory("..");
      expect(typeof result).toBe("string");
      expect(result.startsWith("/")).toBe(true);
    });

    it("resolves ./relative paths", () => {
      expect(resolveTargetDirectory("./demo")).toBe(`${process.cwd()}/demo`);
    });

    it("resolves paths containing '/'", () => {
      expect(resolveTargetDirectory("apps/demo")).toBe(`${process.cwd()}/apps/demo`);
    });

    it("resolves absolute paths", () => {
      expect(resolveTargetDirectory("/tmp/demo")).toBe("/tmp/demo");
    });

    it("expands home-relative paths", () => {
      expect(resolveTargetDirectory("~/code/demo")).toBe("/Users/tester/code/demo");
    });

    it("returns registered project paths", () => {
      mockListProjects.mockImplementation(() => new Map([["demo", "/work/demo"]]));
      expect(resolveTargetDirectory("demo")).toBe("/work/demo");
    });

    it("exits on unknown project names", () => {
      const allWrites = captureFailure("missing");
      // Now emits the unified branded prefix (#598)
      expect(allWrites).toContain("summon: error:");
      expect(allWrites).toContain(
        `"missing" is not a known command or registered project. Try: summon --help`,
      );
    });

    // Phase 6 Unit A (D7): suggestions never change the target, only the hint.
    describe("did-you-mean suggestions", () => {
      it("prints no suggestion line when nothing is close", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["summon", "/w/summon"]]));
        const out = captureFailure("zzzzzz");
        expect(out).not.toContain("Did you mean");
        expect(out).toContain("Or see available:         summon list");
      });

      // UX-M3: the suggestion line comes straight after the error, before the two generic hints.
      it("prints up to three suggestions before the two hint lines and still exits 1", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["chapa-cli", "/w/chapa-cli"], ["summon", "/w/summon"]]));
        const out = captureFailure("cha");
        const lines = out.split("\n").filter(Boolean);
        expect(lines).toHaveLength(4);
        expect(lines[0]).toContain(`"cha" is not a known command or registered project`);
        expect(lines[1]).toBe("Did you mean: chapa, chapa-cli?");
        expect(lines[2]).toContain("To register as a project: summon add cha /path/to/project");
        expect(lines[3]).toContain("Or see available:         summon list");
      });

      it("suggests a subcommand as `summon <command>` and drops the register hint (UX-M3)", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"]]));
        const lines = captureFailure("stauts", ["status", "list", "add"]).split("\n").filter(Boolean);
        expect(lines[1]).toBe("Did you mean: summon status?");
        expect(lines.join("\n")).not.toContain("summon add stauts");
        expect(lines.at(-1)).toContain("summon list");
        // A command's recency is never read from a status record.
        expect(mockReadStatusRecord).not.toHaveBeenCalledWith("status");
      });

      it("ranks commands and projects together, a project keeps its bare name", () => {
        mockListProjects.mockImplementation(() => new Map([["statsd", "/w/statsd"]]));
        const out = captureFailure("stat", ["status"]);
        expect(out).toContain("Did you mean: statsd, summon status?");
      });

      it("a name that is both a command and a project is offered as the command (the registry wins)", () => {
        mockListProjects.mockImplementation(() => new Map([["status", "/w/status"]]));
        expect(captureFailure("stauts", ["status"])).toContain("Did you mean: summon status?");
      });

      it("ranks the most recently launched project first inside a tier (records of matching names only, no probes)", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["chapa-cli", "/w/chapa-cli"], ["summon", "/w/summon"]]));
        mockReadStatusRecord.mockImplementation((name) => (name === "chapa-cli" ? { startedAt: "2026-10-29T10:00:00.000Z" } : null));
        const out = captureFailure("chap");
        expect(out).toContain("Did you mean: chapa-cli, chapa?");
        expect([...new Set(mockReadStatusRecord.mock.calls.map((c) => c[0]))].sort()).toEqual(["chapa", "chapa-cli"]);
      });

      it("exposes the same ranking as a reusable lookup", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["chapa-cli", "/w/chapa-cli"]]));
        expect(projectSuggestions("chpaa")).toEqual(["chapa"]);
        expect(projectSuggestions("chpaa", ["chapa-cli"])).toEqual([]);
      });

      it("ignores records whose timestamp does not parse", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["chapa-cli", "/w/chapa-cli"]]));
        mockReadStatusRecord.mockImplementation((name) => (name === "chapa-cli" ? { startedAt: "not a date" } : null));
        expect(captureFailure("chap")).toContain("Did you mean: chapa, chapa-cli?");
      });

      it("never reads records when the registry is empty", () => {
        captureFailure("missing");
        expect(mockReadStatusRecord).not.toHaveBeenCalled();
      });
    });

    // UX-M3: the commands that take a project name share one suggestion line.
    describe("printProjectSuggestions", () => {
      function capture(target: string): string {
        const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        try {
          printProjectSuggestions(target);
          return writeSpy.mock.calls.map((c) => String(c[0])).join("");
        } finally {
          writeSpy.mockRestore();
        }
      }

      it("writes the closest registered names to stderr", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["summon", "/w/summon"]]));
        expect(capture("chpaa")).toBe("Did you mean: chapa?\n");
      });

      it("names the target when several unknown names are reported together", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"]]));
        const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        printProjectSuggestions("chpaa", true);
        expect(writeSpy.mock.calls.map((c) => String(c[0]))).toEqual(["For chpaa, did you mean: chapa?\n"]);
        writeSpy.mockRestore();
      });

      it("writes nothing when nothing is close or the name is registered", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"]]));
        expect(capture("zzzzzz")).toBe("");
        expect(capture("chapa")).toBe("");
      });
    });
  });
});
