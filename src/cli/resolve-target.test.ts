// Tests for #473 PE-H1: resolveTargetDirectory and expandHome in a leaf module
// These tests verify that the new cli/resolve-target.ts module works correctly.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProject = vi.fn();

vi.mock("../config.js", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => "/Users/tester",
}));

const { resolveTargetDirectory, expandHome } = await import("./resolve-target.js");

beforeEach(() => {
  vi.clearAllMocks();
});

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
      mockGetProject.mockReturnValue("/work/demo");
      expect(resolveTargetDirectory("demo")).toBe("/work/demo");
    });

    it("exits on unknown project names", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
      mockGetProject.mockReturnValue(undefined);

      expect(() => resolveTargetDirectory("missing")).toThrow("exit:1");
      expect(errorSpy).toHaveBeenCalledWith(
        `Error: "missing" is not a known command or registered project. Try: summon --help`,
      );
      errorSpy.mockRestore();
    });
  });
});
