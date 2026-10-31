import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findLauncherTab, closeLauncherTabOnExit, closeLauncherTabAfterRexLaunch, resetLauncherTabForTests, detachedCloseArgs, EXIT_PROBE_TIMEOUT_MS, watchForAttention, needsAttention, startLauncherTabWatch } from "./launcher-tab.js";
import type { RexCli } from "./cli.js";
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

function cliAnswering(answer: () => RexResult, process: () => RexResult = typedAtPrompt): RexCli & { calls: Array<{ op: string; argv?: readonly string[]; input?: string; timeoutMs?: number }> } {
  const calls: Array<{ op: string; argv?: readonly string[]; input?: string; timeoutMs?: number }> = [];
  return {
    binary: "/mock/rex", server: "unix:///mock/server.sock", calls,
    call(op, argv, opts) {
      calls.push({ op, ...(op === "block-call" ? { argv } : {}), ...(opts?.input !== undefined ? { input: opts.input } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
      return op === "block-call" ? process() : answer();
    },
  };
}

describe("findLauncherTab (D1)", () => {
  it("names the caller's tab when it holds only the caller's pane and is not a workspace tab; BE-L5: both exit-time probes are short", () => {
    const cli = cliAnswering(() => view([{ id: WORKSPACE_WINDOW, label: "[summon]", blocks: [OTHER] }, { id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]));
    expect(findLauncherTab(cli, ENV, SUMMON_PID)).toEqual({ sessionId: SESSION, windowId: WINDOW, blockId: BLOCK });
    expect(EXIT_PROBE_TIMEOUT_MS).toBe(2000);
    expect(cli.calls).toEqual([
      { op: "session-view", input: JSON.stringify({ session_id: SESSION }), timeoutMs: 2000 },
      { op: "block-call", argv: ["block", "call", "-s", SESSION, "-b", BLOCK, "process"], timeoutMs: 2000 },
    ]);
  });

  it("BE-L5: a probe that times out keeps the tab", () => {
    const timedOut = (op: "session-view" | "block-call"): RexResult => ({ ok: false, op, kind: "timeout", outcome: "none", reason: "rex did not answer in time", raw: { code: null, signal: "SIGKILL", timedOut: true, enoent: false, stdout: "", stderr: "" } });
    const tab = () => view([{ id: WINDOW, label: "zsh ~", blocks: [BLOCK] }]);
    expect(findLauncherTab(cliAnswering(() => timedOut("session-view")), ENV, SUMMON_PID)).toBeUndefined();
    expect(findLauncherTab(cliAnswering(tab, () => timedOut("block-call")), ENV, SUMMON_PID)).toBeUndefined();
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
  const TAB = { sessionId: SESSION, windowId: WINDOW, blockId: BLOCK };
  function arm(over: Partial<{ find: () => typeof TAB | undefined; needsAttention: () => boolean; env: NodeJS.ProcessEnv }> = {}) {
    resetLauncherTabForTests();
    const handlers: Array<(code: number) => void> = [];
    const spawn = vi.fn();
    const find = vi.fn(over.find ?? (() => TAB));
    const deps = { find, onExit: (h: (code: number) => void) => { handlers.push(h); }, spawnDetached: spawn, needsAttention: over.needsAttention ?? (() => false), env: over.env ?? {} };
    closeLauncherTabOnExit(context, deps);
    return { handlers, spawn, find, deps };
  }

  it("closes the tab once, after a clean successful exit, through a detached step that re-checks the tab; the tab is looked up at exit", () => {
    const { handlers, spawn, find, deps } = arm();
    closeLauncherTabOnExit(context, deps);
    expect(handlers).toHaveLength(1);
    expect(find).not.toHaveBeenCalled();
    handlers[0]!(0);
    expect(find).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(process.execPath, detachedCloseArgs(context, TAB));
    // The ids reach the detached program as argv words after `--`, never inside its source.
    const args = detachedCloseArgs(context, TAB);
    expect(args.slice(0, 1)).toEqual(["-e"]);
    expect(args.slice(2)).toEqual(["--", "/mock/rex", "unix:///mock/server.sock", SESSION, WINDOW, BLOCK]);
    expect(args[1]).not.toContain(SESSION);
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

});

describe("detached close (BE-L5): re-checks the tab after Summon exits, then closes it or ends its session", () => {
  const dir = mkdtempSync(join(tmpdir(), "summon-launcher-tab-"));
  const rex = join(dir, "rex");
  const state = join(dir, "state.json");
  const log = join(dir, "log.jsonl");
  const context = { rexBinary: rex, server: "unix:///tmp/summon-fake.sock" };
  const TAB = { sessionId: SESSION, windowId: WINDOW, blockId: BLOCK };

  beforeAll(() => {
    // A fake rex: logs its argv, answers session.view from the state file (or fails with `view: "fail"`).
    writeFileSync(rex, [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      "const [state, log] = [process.env.FAKE_STATE, process.env.FAKE_LOG];",
      "const a = process.argv.slice(2);",
      "fs.appendFileSync(log, JSON.stringify(a) + '\\n');",
      "const d = JSON.parse(fs.readFileSync(state, 'utf8'));",
      "if (a.includes('session.view')) { if (d.view === 'fail') { console.error('Error: session_not_found'); process.exit(3); } console.log(JSON.stringify(d.view)); }",
    ].join("\n") + "\n");
    chmodSync(rex, 0o755);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  function runDetached(windows: Array<{ id: string; blocks: string[] }> | "fail"): string[][] {
    const answer = windows === "fail" ? "fail" : (view(windows.map((w) => ({ ...w, label: "zsh ~" }))) as { json: unknown }).json;
    writeFileSync(state, JSON.stringify({ view: answer }));
    writeFileSync(log, "");
    const run = spawnSync(process.execPath, detachedCloseArgs(context, TAB), { env: { ...process.env, FAKE_STATE: state, FAKE_LOG: log }, encoding: "utf8", timeout: 15_000 });
    expect(run.status, run.stderr).toBe(0);
    return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  }
  const flags = ["--color", "never", "--timeout", "2s", "--autostart=false", "-S", "unix:///tmp/summon-fake.sock"];
  const viewCall = [...flags, "api", "call", "session.view", "-"];

  it("ends the session when the tab is still its only one, with a --timeout", () => {
    expect(runDetached([{ id: WINDOW, blocks: [BLOCK] }])).toEqual([viewCall, [...flags, "kill", SESSION]]);
  });

  it("closes only the tab when another tab exists, including one added after the exit-time check", () => {
    expect(runDetached([{ id: WORKSPACE_WINDOW, blocks: [OTHER] }, { id: WINDOW, blocks: [BLOCK] }])).toEqual([viewCall, [...flags, "window", "close", "-s", SESSION, WINDOW]]);
  });

  it("keeps the tab on doubt: a split added meanwhile, the tab gone or the view failing", () => {
    expect(runDetached([{ id: WINDOW, blocks: [BLOCK, OTHER] }])).toEqual([viewCall]);
    expect(runDetached([{ id: WORKSPACE_WINDOW, blocks: [BLOCK] }])).toEqual([viewCall]);
    expect(runDetached("fail")).toEqual([viewCall]);
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
