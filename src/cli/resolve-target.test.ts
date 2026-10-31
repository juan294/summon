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

const { resolveTargetDirectory, expandHome, projectSuggestions } = await import("./resolve-target.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockListProjects.mockImplementation(() => new Map<string, string>());
  mockReadStatusRecord.mockImplementation(() => null);
});

function captureFailure(target: string): string {
  const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
  try {
    expect(() => resolveTargetDirectory(target)).toThrow("exit:1");
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

      it("prints up to three suggestions after the two hint lines and still exits 1", () => {
        mockListProjects.mockImplementation(() => new Map([["chapa", "/w/chapa"], ["chapa-cli", "/w/chapa-cli"], ["summon", "/w/summon"]]));
        const out = captureFailure("cha");
        const lines = out.split("\n").filter(Boolean);
        expect(lines[lines.length - 3]).toContain("To register as a project: summon add cha /path/to/project");
        expect(lines[lines.length - 2]).toContain("Or see available:         summon list");
        expect(lines[lines.length - 1]).toBe("Did you mean: chapa, chapa-cli?");
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
  });
});
