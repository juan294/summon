import { describe, it, expect, vi } from "vitest";
import { findLauncherTab, closeLauncherTabOnExit, closeLauncherTabAfterRexLaunch, resetLauncherTabForTests, spawnAfterExit, watchForAttention, needsAttention, startLauncherTabWatch } from "./launcher-tab.js";
import type { RexCli } from "./cli.js";
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

describe("watchForAttention (D1)", () => {
  function fakeStream() {
    const written: string[] = [];
    const stream = { write: (chunk: unknown) => { written.push(String(chunk)); return true; } } as unknown as NodeJS.WriteStream;
    return { stream, written };
  }

  it("lets the routine switch line and blank output through, and flags any note, warning or other line, still writing everything", () => {
    for (const [line, flagged] of [
      ["Workspace [api] is already running in Rex; switched to it (use --new-window for a fresh one)\n", false],
      ["\n", false],
      ["summon: note: removed the files of earlier launch 547c18b7-b4d4-45ae-aebe-3b642197ec3a (its Rex session is gone)\n", false],
      ["Workspace [api] is already running in Rex; switched to it (use --new-window for a fresh one)\nWarning: something else\n", true],
      ["summon: note: could not remove the files of earlier launch 547c18b7-b4d4-45ae-aebe-3b642197ec3a (its Rex session is gone): EPERM\n", true],
      ["summon: note: Rex cannot honor maximize; ignored\n", true],
      // UX-H1: the on-stop disclosure prints on every launch with a hook; it is not something to act on.
      ["summon: note: on-stop will run on workspace exit.\n", false],
      ["summon: note: on-stop will run on workspace exit.\nsummon: warning: something else\n", true],
      // UX-M2: the old unprefixed line is no longer what Summon prints, so it is not routine.
      ["Note: on-stop will run on workspace exit.\n", true],
      ["summon: warning: ignoring invalid env var key \"1X\" from .summon file.\n", true],
      ["Workspace [api] is already running in Rex but could not be shown (no app); run summon open api\n", true],
      [Buffer.from("[2/3] Skipped web \u2014 untrusted .summon file.\n"), true],
    ] as const) {
      resetLauncherTabForTests();
      const { stream, written } = fakeStream();
      watchForAttention(stream);
      stream.write(line);
      expect(needsAttention(), String(line)).toBe(flagged);
      expect(written).toEqual([String(line)]);
    }
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
