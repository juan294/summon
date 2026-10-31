import { describe, it, expect, vi, afterEach } from "vitest";

// QA-M3: the default wiring (the real find, process.once("exit") and spawnAfterExit) runs against these two seams.
const mockSpawn = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ unref: () => {} })));
const mockCreateRexCli = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:child_process")>()), spawn: mockSpawn }));
vi.mock("./cli.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./cli.js")>()), createRexCli: (...args: unknown[]) => mockCreateRexCli(...args) }));

import { findLauncherTab, closeLauncherTabOnExit, closeLauncherTabAfterRexLaunch, resetLauncherTabForTests, spawnAfterExit, watchForAttention, needsAttention, startLauncherTabWatch, markAttention } from "./launcher-tab.js";
import type { RexCli } from "./cli.js";
import type { LaunchContext } from "../../backend.js";
import { err, note, warn, writingRoutine } from "../../ui/output.js";
import type { RexResult } from "./types.js";

const SESSION = "session:0000aaaa-0000-0000-0000-000000000001";
const BLOCK = "block:0000aaaa-0000-0000-0000-000000000010";
const OTHER = "block:0000aaaa-0000-0000-0000-000000000011";
const WINDOW = "window:0000aaaa-0000-0000-0000-000000000002";
const WORKSPACE_WINDOW = "window:0000aaaa-0000-0000-0000-000000000003";
const ENV = { REX_SESSION: SESSION, REX_BLOCK: BLOCK };

function view(windows: Array<{ id: string; label: string; blocks: string[] }>): RexResult {
  return {
    ok: true, op: "session-view", stdout: "",
    json: {
      session_id: SESSION, label: "summon", revision: 1,
      windows: windows.map((w) => ({ window_id: w.id, label: w.label, layers: [{ layer_id: "l", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: w.blocks.map((b) => ({ block_id: b })) }] })),
    },
  };
}

const SUMMON_PID = 4242;
const typedAtPrompt = (): RexResult => ({ ok: true, op: "block-call", stdout: "", json: { foreground: { pid: SUMMON_PID, name: "node" }, ancestors: [{ pid: 100, name: "zsh" }] } });

function cliAnswering(answer: () => RexResult, process: () => RexResult = typedAtPrompt): RexCli & { calls: Array<{ op: string; argv?: readonly string[]; input?: string }> } {
  const calls: Array<{ op: string; argv?: readonly string[]; input?: string }> = [];
  return {
    binary: "/mock/rex", server: "unix:///mock/server.sock", calls,
    call(op, argv, opts) {
      calls.push({ op, ...(op === "block-call" ? { argv } : {}), ...(opts?.input !== undefined ? { input: opts.input } : {}) });
      return op === "block-call" ? process() : answer();
    },
  };
}

describe("findLauncherTab (D1)", () => {
  it("names the caller's tab when it holds only the caller's pane and is not a workspace tab", () => {
    const cli = cliAnswering(() => view([{ id: WORKSPACE_WINDOW, label: "[summon]", blocks: [OTHER] }, { id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]));
    expect(findLauncherTab(cli, ENV, SUMMON_PID)).toEqual({ sessionId: SESSION, windowId: WINDOW, lastTab: false });
    expect(cli.calls).toEqual([
      { op: "session-view", input: JSON.stringify({ session_id: SESSION }) },
      { op: "block-call", argv: ["block", "call", "-s", SESSION, "-b", BLOCK, "process"] },
    ]);
  });

  it("marks the session's only tab as its last, so the session ends with it", () => {
    const cli = cliAnswering(() => view([{ id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]));
    expect(findLauncherTab(cli, ENV, SUMMON_PID)).toEqual({ sessionId: SESSION, windowId: WINDOW, lastTab: true });
  });

  it("leaves the tab when Summon is not the pane's foreground program (an agent or script ran it), or the process is unknown", () => {
    const tab = () => view([{ id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]);
    const agent = (): RexResult => ({ ok: true, op: "block-call", stdout: "", json: { foreground: { pid: 52275, name: "claude" } } });
    expect(findLauncherTab(cliAnswering(tab, agent), ENV, SUMMON_PID)).toBeUndefined();
    const failed = (): RexResult => ({ ok: false, op: "block-call", kind: "failed", outcome: "none", reason: "x", raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } });
    expect(findLauncherTab(cliAnswering(tab, failed), ENV, SUMMON_PID)).toBeUndefined();
    expect(findLauncherTab(cliAnswering(tab, () => ({ ok: true, op: "block-call", stdout: "", json: {} })), ENV, SUMMON_PID)).toBeUndefined();
  });

  it("leaves a tab with splits, a workspace tab, an unknown block, and a failed view alone", () => {
    expect(findLauncherTab(cliAnswering(() => view([{ id: WINDOW, label: "zsh ~", blocks: [BLOCK, OTHER] }])), ENV, SUMMON_PID)).toBeUndefined();
    expect(findLauncherTab(cliAnswering(() => view([{ id: WINDOW, label: "[paisaxe]", blocks: [BLOCK] }])), ENV, SUMMON_PID)).toBeUndefined();
    expect(findLauncherTab(cliAnswering(() => view([{ id: WINDOW, label: "zsh ~", blocks: [OTHER] }])), ENV, SUMMON_PID)).toBeUndefined();
    expect(findLauncherTab(cliAnswering(() => ({ ok: false, op: "session-view", kind: "unreachable", outcome: "none", reason: "no socket", raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } })), ENV)).toBeUndefined();
  });

  it("asks nothing without both caller ids, or with ids that are not Rex ids", () => {
    const cli = cliAnswering(() => view([{ id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]));
    expect(findLauncherTab(cli, {})).toBeUndefined();
    expect(findLauncherTab(cli, { REX_SESSION: SESSION })).toBeUndefined();
    expect(findLauncherTab(cli, { REX_SESSION: "--autostart", REX_BLOCK: BLOCK })).toBeUndefined();
    expect(cli.calls).toEqual([]);
  });
});

describe("closeLauncherTabOnExit (D1)", () => {
  const context = { rexBinary: "/mock/rex", server: "unix:///mock/server.sock" };
  const TAB = { sessionId: SESSION, windowId: WINDOW, lastTab: false };
  function arm(over: Partial<{ find: () => typeof TAB | undefined; needsAttention: () => boolean; env: NodeJS.ProcessEnv }> = {}) {
    resetLauncherTabForTests();
    const handlers: Array<(code: number) => void> = [];
    const spawn = vi.fn();
    const find = vi.fn(over.find ?? (() => TAB));
    const deps = { find, onExit: (h: (code: number) => void) => { handlers.push(h); }, spawnDetached: spawn, needsAttention: over.needsAttention ?? (() => false), env: over.env ?? {} };
    closeLauncherTabOnExit(context, deps);
    return { handlers, spawn, find, deps };
  }

  it("closes the tab once, after a clean successful exit, through a detached rex process; the tab is looked up at exit", () => {
    const { handlers, spawn, find, deps } = arm();
    closeLauncherTabOnExit(context, deps);
    expect(handlers).toHaveLength(1);
    expect(find).not.toHaveBeenCalled();
    handlers[0]!(0);
    expect(find).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("/mock/rex", ["--color", "never", "--autostart=false", "-S", "unix:///mock/server.sock", "window", "close", "-s", SESSION, WINDOW]);
  });

  it("ends the whole session when the launcher tab is its last (an empty session would stay in the sidebar)", () => {
    const { handlers, spawn } = arm({ find: () => ({ ...TAB, lastTab: true }) });
    handlers[0]!(0);
    expect(spawn).toHaveBeenCalledWith("/mock/rex", ["--color", "never", "--autostart=false", "-S", "unix:///mock/server.sock", "kill", SESSION]);
  });

  it("keeps the tab after a failure, after anything the user must read, in a workspace pane, and when no launcher tab is found", () => {
    for (const [over, code] of [
      [{}, 1],
      [{ needsAttention: () => true }, 0],
      [{ env: { SUMMON_WORKSPACE: "1" } }, 0],
      [{ find: () => undefined }, 0],
    ] as const) {
      const { handlers, spawn } = arm(over);
      handlers[0]!(code);
      expect(spawn).not.toHaveBeenCalled();
    }
  });

  it("spawnAfterExit runs rex through a detached, delayed /bin/sh with the arguments as separate words", () => {
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }));
    spawnAfterExit("/mock/rex", ["window", "close", "-s", SESSION, WINDOW], spawnFn as never);
    expect(spawnFn).toHaveBeenCalledWith("/bin/sh", ["-c", 'sleep 0.3; exec "$@"', "sh", "/mock/rex", "window", "close", "-s", SESSION, WINDOW], { detached: true, stdio: "ignore" });
    expect(unref).toHaveBeenCalled();
  });
});

describe("closeLauncherTabAfterRexLaunch (D1)", () => {
  it("arms only for a Rex launch from inside Rex: never for Ghostty or for Rex driven from another terminal", () => {
    const find = vi.fn(() => undefined);
    const onExit = vi.fn();
    const deps = { find, onExit, spawnDetached: vi.fn(), needsAttention: () => false, env: {} };
    resetLauncherTabForTests();
    closeLauncherTabAfterRexLaunch({ ok: true, backend: "ghostty", placement: "outside", notices: [] }, deps);
    closeLauncherTabAfterRexLaunch({ ok: true, backend: "ghostty", placement: "inside-rex", notices: [] }, deps);
    closeLauncherTabAfterRexLaunch({ ok: true, backend: "rex", placement: "outside", server: "unix:///s", rexBinary: "/r", notices: [] }, deps);
    expect(onExit).not.toHaveBeenCalled();
    closeLauncherTabAfterRexLaunch({ ok: true, backend: "rex", placement: "inside-rex", server: "unix:///s", rexBinary: "/r", notices: [] }, deps);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("closeLauncherTabAfterRexLaunch default wiring (QA-M3)", () => {
  const INSIDE_REX: LaunchContext = { ok: true, backend: "rex", placement: "inside-rex", server: "unix:///s", rexBinary: "/r", notices: [] };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mockSpawn.mockClear();
    mockCreateRexCli.mockReset();
  });

  /** Arm with no injected deps; return the handler the real wiring gave process.once("exit"). */
  function armDefault(): (code: number) => void {
    vi.stubEnv("REX_SESSION", SESSION);
    vi.stubEnv("REX_BLOCK", BLOCK);
    vi.stubEnv("SUMMON_WORKSPACE", "");
    const foreground = (): RexResult => ({ ok: true, op: "block-call", stdout: "", json: { foreground: { pid: process.pid, name: "node" } } });
    mockCreateRexCli.mockReturnValue(cliAnswering(() => view([{ id: WORKSPACE_WINDOW, label: "[api]", blocks: [OTHER] }, { id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]), foreground));
    const once = vi.spyOn(process, "once").mockImplementation((() => process) as never);
    closeLauncherTabAfterRexLaunch(INSIDE_REX);
    const exit = once.mock.calls.find(([event]) => event === "exit");
    expect(exit, "an exit handler is registered").toBeDefined();
    return exit![1] as (code: number) => void;
  }

  it("looks the tab up through the rex CLI at exit and closes it through a detached, delayed /bin/sh", () => {
    resetLauncherTabForTests();
    const onExit = armDefault();
    expect(mockCreateRexCli).not.toHaveBeenCalled();
    onExit(0);
    expect(mockCreateRexCli).toHaveBeenCalledWith("/r", "unix:///s");
    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", 'sleep 0.3; exec "$@"', "sh", "/r", "--color", "never", "--autostart=false", "-S", "unix:///s", "window", "close", "-s", SESSION, WINDOW],
      { detached: true, stdio: "ignore" },
    );
  });

  it("keeps the tab when an on-start hook or an installer ran with inherited stdio during the watch", () => {
    resetLauncherTabForTests();
    watchForAttention({ write: () => true } as unknown as NodeJS.WriteStream);
    markAttention();
    const onExit = armDefault();
    onExit(0);
    expect(mockCreateRexCli).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe("watchForAttention (D1)", () => {
  function fakeStream() {
    const written: string[] = [];
    const stream = { write: (chunk: unknown) => { written.push(String(chunk)); return true; } } as unknown as NodeJS.WriteStream;
    return { stream, written };
  }

  it("lets writes marked routine at their source and blank output through, and flags any other write, still writing everything", () => {
    const SWITCH = "Workspace [api] is already running in Rex; switched to it (use --new-window for a fresh one)";
    const CLEANUP = "removed the files of earlier launch 547c18b7-b4d4-45ae-aebe-3b642197ec3a (its Rex session is gone)";
    const ON_STOP = "on-stop will run on workspace exit.";
    for (const [label, write, flagged, expected] of [
      ["switch line", () => err(SWITCH, { routine: true }), false, [`${SWITCH}\n`]],
      ["blank line", () => err(""), false, ["\n"]],
      ["cleanup note", () => note(CLEANUP, { routine: true }), false, [`summon: note: ${CLEANUP}\n`]],
      // UX-H1: the on-stop disclosure prints on every launch with a hook; it is not something to act on.
      ["on-stop note", () => note(ON_STOP, { routine: true }), false, [`summon: note: ${ON_STOP}\n`]],
      // The source decides: the same text written without the marker is for the user to read.
      ["unmarked switch line", () => err(SWITCH), true, [`${SWITCH}\n`]],
      ["unmarked on-stop note", () => note(ON_STOP), true, [`summon: note: ${ON_STOP}\n`]],
      ["failed cleanup note", () => note("could not remove the files of earlier launch 547c18b7-b4d4-45ae-aebe-3b642197ec3a (its Rex session is gone): EPERM"), true, ["summon: note: could not remove the files of earlier launch 547c18b7-b4d4-45ae-aebe-3b642197ec3a (its Rex session is gone): EPERM\n"]],
      ["P8 notice", () => note("Rex cannot honor maximize; ignored"), true, ["summon: note: Rex cannot honor maximize; ignored\n"]],
      ["warning", () => warn("ignoring invalid env var key \"1X\" from .summon file."), true, ["summon: warning: ignoring invalid env var key \"1X\" from .summon file.\n"]],
      ["routine note then a warning", () => { note(ON_STOP, { routine: true }); warn("something else"); }, true, [`summon: note: ${ON_STOP}\n`, "summon: warning: something else\n"]],
      ["multi-line write", () => process.stderr.write(`${SWITCH}\nWarning: something else\n`), true, [`${SWITCH}\nWarning: something else\n`]],
      ["could not be shown", () => err("Workspace [api] is already running in Rex but could not be shown (no app); run summon open api"), true, ["Workspace [api] is already running in Rex but could not be shown (no app); run summon open api\n"]],
      ["skipped project", () => process.stderr.write(Buffer.from("[2/3] Skipped web \u2014 untrusted .summon file.\n")), true, ["[2/3] Skipped web \u2014 untrusted .summon file.\n"]],
    ] as const) {
      resetLauncherTabForTests();
      const written: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });
      try {
        watchForAttention(process.stderr);
        write();
        expect(needsAttention(), label).toBe(flagged);
        expect(written, label).toEqual(expected);
      } finally {
        spy.mockRestore();
      }
    }
    expect(writingRoutine()).toBe(false);
  });

  it("markAttention flags the watch for output it cannot see (a child with inherited stdio), and does nothing without a watch (Ghostty)", () => {
    resetLauncherTabForTests();
    markAttention();
    expect(needsAttention()).toBe(false);
    const { stream, written } = fakeStream();
    watchForAttention(stream);
    expect(needsAttention()).toBe(false);
    markAttention();
    expect(needsAttention()).toBe(true);
    expect(written).toEqual([]);
  });

  it("is installed once, and only for a Rex launch from inside Rex", () => {
    resetLauncherTabForTests();
    const before = process.stderr.write;
    startLauncherTabWatch({ ok: true, backend: "ghostty", placement: "inside-rex", notices: [] });
    startLauncherTabWatch({ ok: true, backend: "rex", placement: "outside", server: "unix:///s", rexBinary: "/r", notices: [] });
    expect(process.stderr.write).toBe(before);
    const { stream } = fakeStream();
    const original = stream.write;
    watchForAttention(stream);
    const wrapped = stream.write;
    expect(wrapped).not.toBe(original);
    watchForAttention(stream);
    expect(stream.write).toBe(wrapped);
  });
});
