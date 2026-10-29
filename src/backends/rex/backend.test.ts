import { describe, it, expect } from "vitest";
import { RexBackend, REX_NOT_AVAILABLE_MSG } from "./backend.js";
import { planLayout } from "../../layout.js";
import { buildTreePlan } from "../../tree.js";
import type { BackendLaunchContext } from "../ghostty.js";

const ctx: BackendLaunchContext = {
  targetDir: "/tmp/x",
  envVars: undefined,
  projectName: "x",
  onStop: undefined,
  launchId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  ensureAndResolve: async (cmd) => cmd,
  resolveStarship: () => null,
};

describe("RexBackend (Phase 2 seam)", () => {
  it("is the rex backend and refuses both launch paths until Phase 3", async () => {
    expect(RexBackend.id).toBe("rex");
    await expect(RexBackend.launchTraditional(planLayout({ editor: "vim" }), ctx)).rejects.toThrow(REX_NOT_AVAILABLE_MSG);
    await expect(RexBackend.launchTree(buildTreePlan({ type: "pane", name: "a", command: "vim" }), ctx)).rejects.toThrow(REX_NOT_AVAILABLE_MSG);
  });
});
