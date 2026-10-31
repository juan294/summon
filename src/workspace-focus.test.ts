import { describe, it, expect, vi, beforeEach } from "vitest";

// Moved from launcher.test.ts with focusWorkspace (AR-M2): the same child_process, fs and status mocks.
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("Ghostty.sdef")) return '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/></class>';
    throw new Error("fixture absent");
  }),
}));
const mockReadStatus = vi.fn();
vi.mock("./status.js", () => ({
  readStatus: (...args: unknown[]) => mockReadStatus(...args),
  rexCommandGate: vi.fn(() => ({ ok: false, failure: { kind: "unavailable", code: "unavailable", reason: "mock gate" } })),
}));

const { focusWorkspace } = await import("./workspace-focus.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockReadStatus.mockReturnValue(null);
  mockExecFileSync.mockImplementation((bin: string) => (bin === "/usr/bin/which" ? "/usr/bin/stub\n" : ""));
});

describe("focusWorkspace", () => {
  const id="00000000-0000-4000-8000-000000000001";
  it("returns focused only for confirmed UUID readback", () => {
    mockReadStatus.mockReturnValue({native:{rootTerminalId:id,panes:[{name:"editor",terminalId:id}]}});
    mockExecFileSync.mockReturnValue(JSON.stringify({focused:true,terminalId:id}));
    expect(focusWorkspace("api")).toEqual({kind:"focused",terminalId:id});
  });
  it("returns unavailable when native identity or permission fails", () => {
    expect(focusWorkspace("api").kind).toBe("unavailable");
    mockReadStatus.mockReturnValue({native:{rootTerminalId:id,panes:[{name:"editor",terminalId:id}]}});
    mockExecFileSync.mockImplementation(()=>{throw new Error("-1743");});
    expect(focusWorkspace("api")).toMatchObject({kind:"unavailable",code:"permission"});
  });
});
