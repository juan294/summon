import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

let home = "";
const observedReads = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  observedReads.mockImplementation(actual.readFileSync);
  return { ...actual, readFileSync: observedReads };
});
const child = vi.hoisted(() => ({ execFile: vi.fn(), execFileSync: vi.fn() }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));
vi.mock("node:child_process", () => child);
home = fs.mkdtempSync(join(tmpdir(), "summon-monitor-lifecycle-"));
const { runMonitor, resetGitBranchCache } = await import("./monitor.js");
const { resetConfigCache } = await import("./config.js");
const { resetReadAllStatusesCache } = await import("./status.js");
const { resetGitOutputCache } = await import("./utils.js");
// Match execFile's stdlib custom promisify result, not the generic first callback value.
Object.defineProperty(child.execFile, promisify.custom, {
  configurable: true,
  value: (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      child.execFile(
        ...args,
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        },
      );
    }),
});
const statusDir = join(home, ".config/summon/status");
let writes: string[];
let readSpy: ReturnType<typeof vi.spyOn>;
let callbacks: Array<
  (error: Error | null, stdout?: string, stderr?: string) => void
>;
let pending: Promise<void> | undefined;
const send = (bytes: string) => process.stdin.emit("data", Buffer.from(bytes));
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function status(active = true) {
  fs.writeFileSync(
    join(statusDir, "fixture.json"),
    JSON.stringify({
      version: 1,
      source: "summon",
      project: "fixture",
      directory: home,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      layout: "full",
      panes: ["editor"],
    }),
  );
  if (active) {
    fs.writeFileSync(join(statusDir, "fixture.active"), "");
    fs.writeFileSync(join(statusDir, "fixture.pid"), String(process.pid));
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SUMMON_NO_CACHE", "1");
  writes = [];
  callbacks = [];
  fs.rmSync(join(home, ".config"), { recursive: true, force: true });
  fs.mkdirSync(statusDir, { recursive: true });
  fs.writeFileSync(join(home, ".config/summon/projects"), `fixture=${home}\n`);
  fs.writeFileSync(join(home, ".config/summon/config"), "");
  resetConfigCache();
  resetReadAllStatusesCache();
  resetGitBranchCache();
  resetGitOutputCache();
  status();
  child.execFile.mockReset();
  child.execFile.mockImplementation((_cmd, _args, _opts, callback) => {
    callbacks.push(callback);
  });
  vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    writes.push(String(data));
    return true;
  });
  vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdin, "isRaw", {
    value: false,
    configurable: true,
  });
  Object.defineProperty(process.stdin, "setRawMode", {
    value: vi.fn(() => process.stdin),
    configurable: true,
  });
  readSpy = observedReads;
});
afterEach(async () => {
  send("\x03");
  send("\x03");
  if (pending) await pending;
  pending = undefined;
  for (const callback of callbacks.splice(0)) callback(null, "develop", "");
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
function start() {
  pending = runMonitor();
  return pending;
}
function negotiate(mode = 2, visibility = 1) {
  send(`\x1b[?2033;${mode}$y\x1b[?999;${visibility}n`);
}
const frames = () => writes.filter((value) => value.includes("\x1b[H"));

describe("real monitor visibility lifecycle", () => {
  it.each([
    ["SIGINT", 130, 1],
    ["SIGINT", 130, 2],
    ["SIGTERM", 143, 1],
    ["SIGTERM", 143, 2],
  ] as const)(
    "%s restores terminal state once and exits %s from original visibility mode %s",
    async (signal, exitCode, mode) => {
      const originalListeners = process.listeners(signal);
      const originalSignalCounts = ["SIGINT", "SIGTERM"].map(
        (name) => process.listenerCount(name),
      );
      const exit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("intercepted signal exit");
      }) as never);
      start();
      negotiate(mode);
      const handler = process.listeners(signal).find(
        (listener) => !originalListeners.includes(listener),
      );
      expect(handler).toBeDefined();
      writes.length = 0;

      // Invoke only the captured monitor listener; never signal the Vitest process.
      expect(() => handler!(signal)).toThrow("intercepted signal exit");
      pending = undefined; // The intercepted exit cannot settle the CLI's Promise.
      expect(exit).toHaveBeenCalledExactlyOnceWith(exitCode);
      expect(writes.filter((wire) => wire === "\x1b[?2033l")).toHaveLength(
        mode === 2 ? 1 : 0,
      );
      expect(writes.filter((wire) => wire === "\x1b[?25h\x1b[?1049l")).toHaveLength(1);
      expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(process.listeners(signal)).toEqual(originalListeners);
      ["SIGINT", "SIGTERM"].forEach((name, index) => {
        expect(process.listenerCount(name)).toBe(originalSignalCounts[index]);
      });

      // A queued copy of the old handler must not clean up or terminate again.
      const output = [...writes];
      handler!(signal);
      expect(writes).toEqual(output);
      expect(exit).toHaveBeenCalledTimes(1);
    },
  );

  it("failed focus reentry keeps one signal handler per signal and normal quit removes them", async () => {
    const signals = ["SIGINT", "SIGTERM"] as const;
    const originalCounts = signals.map((signal) => process.listenerCount(signal));
    const originalHandlers = process.listeners("SIGINT");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("unexpected stale signal exit");
    }) as never);
    start();
    const oldHandler = process.listeners("SIGINT").find(
      (listener) => !originalHandlers.includes(listener),
    );
    negotiate();
    send("\r");
    await vi.dynamicImportSettled();
    await settle();
    expect(writes.join("")).toContain("Focus failed");
    signals.forEach((signal, index) => {
      expect(process.listenerCount(signal)).toBe(originalCounts[index]! + 1);
    });
    oldHandler!("SIGINT");
    expect(exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    send(" ");
    send("q");
    await pending;
    signals.forEach((signal, index) => {
      expect(process.listenerCount(signal)).toBe(originalCounts[index]);
    });
  });

  it("uses the real terminal width for the initial narrow guard and both resize directions", () => {
    const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    const setColumns = (columns: number) => Object.defineProperty(process.stdout, "columns", {
      value: columns,
      configurable: true,
    });
    try {
      setColumns(40);
      start();
      expect(frames().at(-1)).toContain("Terminal too narrow — widen to ≥60 cols");
      expect(frames().at(-1)).not.toContain("summon status");

      setColumns(120);
      process.emit("SIGWINCH");
      expect(frames().at(-1)).toContain("summon status");
      expect(frames().at(-1)).not.toContain("Terminal too narrow");

      setColumns(40);
      process.emit("SIGWINCH");
      expect(frames().at(-1)).toContain("Terminal too narrow — widen to ≥60 cols");
      expect(frames().at(-1)).not.toContain("summon status");
    } finally {
      if (originalColumns) Object.defineProperty(process.stdout, "columns", originalColumns);
      else Reflect.deleteProperty(process.stdout, "columns");
    }
  });

  it("installs decoder before negotiation; hidden30s performs no status/Git/frame work, visible refreshes once", async () => {
    start();
    negotiate();
    await vi.dynamicImportSettled();
    await settle();
    for (const callback of callbacks.splice(0)) callback(null, "develop", "");
    await settle();
    send("\x1b[?999;2n");
    readSpy.mockClear();
    child.execFile.mockClear();
    writes.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readSpy).not.toHaveBeenCalled();
    expect(child.execFile.mock.calls.length).toBe(0);
    expect(frames()).toHaveLength(0);
    expect(writes).toEqual(["\x1b[?998n"]);
    send("\x1b[?999;1n");
    expect(readSpy).toHaveBeenCalled();
    const count = readSpy.mock.calls.length;
    send("\x1b[?999;1n");
    expect(readSpy.mock.calls.length).toBe(count);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("successful subprocess branch data reaches the real dashboard", async () => {
    start();
    negotiate();
    await vi.dynamicImportSettled();
    await settle();
    expect(callbacks.length).toBeGreaterThan(0);
    for (const callback of callbacks.splice(0))
      callback(null, "fixture-native-branch", "");
    await settle();
    expect(writes.join("")).toContain("fixture-native-branch");
  });
  it("unanswered watchdog restores owned mode and normal polling with fallback disclosure", async () => {
    start();
    negotiate();
    send("\x1b[?999;2n");
    await vi.advanceTimersByTimeAsync(30_500);
    expect(writes).toContain("\x1b[?2033l");
    expect(writes.join("")).toContain("Visibility unavailable");
    readSpy.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(readSpy).toHaveBeenCalled();
  });
  it("protocol replies never dismiss help; timers cannot overwrite overlay; keys dismiss once", async () => {
    start();
    negotiate();
    send("?");
    const before = frames().length;
    send("\x1b[?999;1n");
    await vi.advanceTimersByTimeAsync(3000);
    expect(frames()).toHaveLength(before);
    send("q"); // dismiss only
    expect(frames().at(-1)).toContain("summon status");
    send("q");
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("hidden help becomes visible on return without a dashboard overwrite", async () => {
    start();
    negotiate();
    send("\x1b[?999;2n");
    writes.length = 0;
    send("?");
    expect(frames()).toHaveLength(0);
    send("\x1b[?999;1n");
    expect(frames()).toHaveLength(1);
    expect(frames()[0]).toContain("Key bindings");
  });
  it("cleanup ignores synchronous trailing replies and cannot arm another input timer", async () => {
    vi.mocked(process.stdout.write).mockImplementation((data) => {
      writes.push(String(data));
      if (data === "\x1b[?2033l") send("\x1b[?999;");
      return true;
    });
    start();
    negotiate();
    send("q");
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("synchronous negotiation replies preserve the final hidden watchdog deadline", async () => {
    vi.mocked(process.stdout.write).mockImplementation((data) => {
      writes.push(String(data));
      if (data === "\x1b[?2033$p") send("\x1b[?2033;2$y");
      if (data === "\x1b[?2033h") send("\x1b[?999;2n");
      return true;
    });
    start();
    writes.length = 0;
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(29500);
    expect(writes).toEqual(["\x1b[?998n"]);
  });
  it("late callbacks and resize draw no frames while hidden or disposed", async () => {
    start();
    negotiate();
    await settle();
    send("\x1b[?999;2n");
    writes.length = 0;
    for (const callback of callbacks.splice(0)) callback(null, "develop", "");
    await settle();
    process.emit("SIGWINCH");
    expect(frames()).toHaveLength(0);
    send("q");
    await pending;
    writes.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([1, 2])(
    "cleans up mode ownership and raw mode from original mode%s",
    async (mode) => {
      start();
      negotiate(mode);
      send("\x03");
      await pending;
      expect(writes.filter((v) => v === "\x1b[?2033l")).toHaveLength(
        mode === 2 ? 1 : 0,
      );
      expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("restores preexisting raw mode and unregisters its exception/exit hooks", async () => {
    Object.defineProperty(process.stdin, "isRaw", {
      value: true,
      configurable: true,
    });
    const exits = process.listenerCount("exit"),
      exceptions = process.listenerCount("uncaughtException");
    start();
    negotiate(1);
    send("q");
    await pending;
    expect(process.stdin.setRawMode).toHaveBeenLastCalledWith(true);
    expect(process.listenerCount("exit")).toBe(exits);
    expect(process.listenerCount("uncaughtException")).toBe(exceptions);
  });
  it("exception cleanup clears owned protocol, timers and listeners", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("test exit");
    }) as never);
    start();
    negotiate();
    const handler = process
      .listeners("uncaughtException")
      .find((listener) => listener.name === "onUncaughtException");
    expect(handler).toBeDefined();
    expect(() =>
      handler!(new Error("fixture exception"), "uncaughtException"),
    ).toThrow("test exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    // An actual exception exits the process; this test's intercepted exit leaves its Promise pending.
    pending = undefined;
  });
  it("prefetch finishing after disposal cannot paint another frame", async () => {
    start();
    negotiate();
    await vi.dynamicImportSettled();
    await settle();
    const completions = callbacks.splice(0);
    send("q");
    await pending;
    writes.length = 0;
    for (const callback of completions) callback(null, "late-branch", "");
    await settle();
    expect(writes).toEqual([]);
  });
  it("failed focus reentry negotiates anew; protocol cannot dismiss error overlay", async () => {
    start();
    negotiate();
    send("\r");
    await vi.dynamicImportSettled();
    await settle();
    expect(writes.join("")).toContain("Focus failed");
    expect(writes.filter((v) => v === "\x1b[?2033$p")).toHaveLength(2);
    const before = frames().length;
    negotiate();
    expect(frames()).toHaveLength(before);
    send(" ");
    expect(frames().at(-1)).toContain("summon status");
  });
  it("negotiation timeout falls back, ignores late reports and retains polling", async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    expect(writes.join("")).toContain("Visibility unavailable");
    send("\x1b[?999;2n");
    readSpy.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(readSpy).toHaveBeenCalled();
  });
  it.each(["stdin", "stdout", "optout"])(
    "%s disables protocol IO",
    async (which) => {
      if (which === "optout") vi.stubEnv("SUMMON_NO_VISIBILITY", "1");
      else
        Object.defineProperty(process[which as "stdin" | "stdout"], "isTTY", {
          value: false,
          configurable: true,
        });
      start();
      await vi.advanceTimersByTimeAsync(500);
      expect(writes.join("")).not.toContain("2033");
    },
  );
});
