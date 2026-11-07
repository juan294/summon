import { describe, it, expect } from "vitest";
import { LAUNCH_LOCK_STALE_MS } from "../../status-record.js";
import { MINIMIZE_WORST_CASE_MS } from "./minimize.js";

describe("the background-pane pass and the launch lock (plan S8)", () => {
  it("the pass at its worst, added to the rest of a launch at its worst (about 2 minutes), stays below the lock's stale bound", () => {
    // 7 s check + 10 s read + 30 s budget + one last pane (float 7, read 10, minimize 7, read 10).
    expect(MINIMIZE_WORST_CASE_MS).toBe(81_000);
    expect(MINIMIZE_WORST_CASE_MS + 120_000).toBeLessThan(LAUNCH_LOCK_STALE_MS);
  });
});
