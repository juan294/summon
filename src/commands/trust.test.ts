import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./types.js";

const mockTrustPath = vi.fn();

vi.mock("../trust.js", () => ({
  handleTrustCommand: (...args: unknown[]) => mockTrustPath(...args),
}));

const { handleTrustCommand } = await import("./trust.js");

function makeContext(args: string[] = []): CommandContext {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: {},
    subcommand: "trust",
    args,
    overrides: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleTrustCommand", () => {
  it("trusts the provided path", async () => {
    await handleTrustCommand(makeContext(["/tmp/workspace"]));

    expect(mockTrustPath).toHaveBeenCalledWith("/tmp/workspace");
  });

  it("defaults to the current directory", async () => {
    await handleTrustCommand(makeContext());

    expect(mockTrustPath).toHaveBeenCalledWith(".");
  });
});
