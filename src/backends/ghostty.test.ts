import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// BE-M2 / PE-L3: Ghostty failure rollback closes only the window or tab the script created.
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));
vi.mock("../launch-guards.js", async (original) => ({
  ...(await original<typeof import("../launch-guards.js")>()),
  ensureGhostty: vi.fn(),
  ensureAccessibility: vi.fn(),
}));

const { GhosttyBackend, closeCreatedContainer } = await import("./ghostty.js");
const { planLayout } = await import("../layout.js");
import type { BackendLaunchContext } from "./ghostty.js";

const ctx: BackendLaunchContext = {
  targetDir: "/tmp/project",
  envVars: undefined,
  projectName: "project",
  onStop: undefined,
  launchId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  layoutLabel: "custom",
  ensureAndResolve: async (cmd) => cmd,
  resolveStarship: () => null,
};

/** The main launch script fails with `stderr`; every other osascript call succeeds. */
function failLaunchWith(stderr: string): void {
  mockExecFileSync.mockImplementation((_bin: string, _args: string[], opts?: { input?: string }) => {
    if (opts?.input?.includes("new surface configuration")) throw new Error(`Command failed: osascript\n${stderr}`);
    return "";
  });
}

function rollbackCalls(): Array<[string, string[], { input: string; timeout?: number; killSignal?: string }]> {
  return mockExecFileSync.mock.calls.filter((call) => /close (window|tab) /.test(String(call[2]?.input))) as never;
}

const spyStderr = () => vi.spyOn(process.stderr, "write").mockImplementation(() => true);
const spyStdout = () => vi.spyOn(process.stdout, "write").mockImplementation(() => true);
let stderrSpy: ReturnType<typeof spyStderr>;
let stdoutSpy: ReturnType<typeof spyStdout>;

beforeEach(() => {
  mockExecFileSync.mockReset();
  stderrSpy = spyStderr();
  stdoutSpy = spyStdout();
});

afterEach(() => {
  stderrSpy.mockRestore();
  stdoutSpy.mockRestore();
});

function stderrText(): string {
  return stderrSpy.mock.calls.map((call) => String(call[0])).join("");
}

describe("Ghostty failure rollback (BE-M2)", () => {
  it("never closes anything when the launch reused the user's window (default mode)", async () => {
    failLaunchWith("execution error: Ghostty got an error: Can't get terminal 1. (-1728)");
    await expect(GhosttyBackend.launchTraditional(planLayout(), ctx)).rejects.toThrow("Failed to execute workspace script");
    expect(rollbackCalls()).toEqual([]);
    expect(mockExecFileSync.mock.calls.some((call) => String(call[2]?.input).includes("close front window"))).toBe(false);
  });

  it("closes exactly the window a --new-window launch created, with a bounded osascript", async () => {
    failLaunchWith("execution error: Ghostty got an error: Can't split. [summon-rollback window:W-1234] (-1728)");
    const rejection = GhosttyBackend.launchTraditional(planLayout({ newWindow: true }), ctx);
    await expect(rejection).rejects.toThrow("Failed to execute workspace script: Command failed: osascript\nexecution error: Ghostty got an error: Can't split. (-1728)");
    const calls = rollbackCalls();
    expect(calls).toHaveLength(1);
    const [bin, args, opts] = calls[0]!;
    expect(bin).toBe("osascript");
    expect(args).toEqual([]);
    expect(opts.input).toContain('if (id of w as text) is "W-1234" then');
    expect(opts.input).toContain("close window w");
    expect(opts.input).not.toContain("close tab");
    expect(opts.timeout).toBe(5_000);
    expect(opts.killSignal).toBe("SIGKILL");
    // The internal mark never reaches the user.
    expect(stderrText()).not.toContain("summon-rollback");
  });

  it("closes only the tab a --new-tab launch created, never its window", async () => {
    failLaunchWith("execution error: Ghostty got an error: Can't split. [summon-rollback tab:T-99] (-1728)");
    await expect(GhosttyBackend.launchTraditional(planLayout({ newTab: true }), ctx)).rejects.toThrow("Failed to execute workspace script");
    const calls = rollbackCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]![2].input).toContain('if (id of t as text) is "T-99" then');
    expect(calls[0]![2].input).toContain("close tab t");
    expect(calls[0]![2].input).not.toContain("close window");
  });

  it.each([
    ["no container was recorded (open not verified)", "execution error: boom [summon-rollback ] (-2700)"],
    ["the recorded id has unexpected characters", 'execution error: boom [summon-rollback window:a"b] (-2700)'],
    ["the error is an accessibility denial", "execution error: System Events got an error: osascript is not allowed assistive access. [summon-rollback window:W-1] (-1719)"],
    ["the error carries no mark (failure before the container opened)", "execution error: System Events got an error: boom (-2700)"],
  ])("skips the rollback when %s", async (_label, stderr) => {
    failLaunchWith(stderr);
    await expect(GhosttyBackend.launchTraditional(planLayout({ newWindow: true }), ctx)).rejects.toThrow("Failed to execute workspace script");
    expect(rollbackCalls()).toEqual([]);
  });

  it("the tree launch path rolls back the same way", async () => {
    failLaunchWith("execution error: x [summon-rollback window:W-7] (-1728)");
    const { buildTreePlan } = await import("../tree.js");
    const plan = buildTreePlan({ type: "pane", name: "editor", command: "nvim" }, { newWindow: true });
    await expect(GhosttyBackend.launchTree(plan, ctx)).rejects.toThrow("Failed to execute workspace script");
    expect(rollbackCalls()).toHaveLength(1);
  });

  it("closeCreatedContainer is best effort: a failing or hanging osascript never throws", () => {
    mockExecFileSync.mockImplementation(() => { throw Object.assign(new Error("spawnSync osascript ETIMEDOUT"), { code: "ETIMEDOUT" }); });
    expect(() => closeCreatedContainer({ kind: "window", id: "W-1" })).not.toThrow();
  });
});
