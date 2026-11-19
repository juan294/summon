import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResolvedStatus } from "../../status.js";

const readLivePorts = vi.fn();
vi.mock("./ports.js", () => ({ readLivePorts: (...args: unknown[]) => readLivePorts(...args) }));

const { RexWorkspace } = await import("./workspace.js");
const { seedRexBinaryPath, resetRexBinaryMemo } = await import("./read.js");
const { createLiveBudget } = await import("../live-budget.js");

const IDENTITY = {
  server: "unix:///tmp/s.sock",
  hostId: "host",
  sessionId: "session:1",
  windowId: "window:1",
  rootBlockId: "block:e",
  blocks: [{ name: "editor", blockId: "block:e", label: "editor" }],
};

function status(state: ResolvedStatus["state"]): ResolvedStatus {
  return {
    project: "api", directory: "/work/api", pid: 1, startedAt: "2026-11-19T00:00:00Z", layout: "minimal", panes: ["editor"],
    source: "summon", version: 1, backend: "rex", rex: IDENTITY, state, uptime: null, liveBlocks: ["editor"],
  };
}

beforeEach(() => {
  readLivePorts.mockReset();
  seedRexBinaryPath("/opt/rex");
});

afterEach(() => resetRexBinaryMemo());

describe("RexWorkspace.livePorts", () => {
  it("reads a running workspace through its record's server, session and pane mapping", async () => {
    readLivePorts.mockResolvedValue({ status: "ok", ports: [] });
    const budget = createLiveBudget();
    for (const state of ["active", "partial"] as const) {
      expect(await RexWorkspace.livePorts!("api", status(state), budget)).toEqual({ status: "ok", ports: [] });
    }
    expect(readLivePorts).toHaveBeenCalledWith({ binary: "/opt/rex", server: IDENTITY.server, sessionId: "session:1", blocks: IDENTITY.blocks }, budget);
  });

  it("never reads a stopped or unknown workspace", async () => {
    for (const state of ["stopped", "unknown"] as const) {
      const result = await RexWorkspace.livePorts!("api", status(state), createLiveBudget());
      expect(result.status).toBe("unavailable");
      expect(result.ports).toEqual([]);
      expect(result.reason).toBeTruthy();
    }
    expect(readLivePorts).not.toHaveBeenCalled();
  });
});
