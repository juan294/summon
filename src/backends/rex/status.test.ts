import { describe, it, expect } from "vitest";
import { listSessions, viewSession, sessionState, parseSessionView } from "./status.js";
import type { RexCli } from "./cli.js";
import type { RexIdentity, RexResult } from "./types.js";

function failure(op: RexResult["op"], kind: "unreachable" | "failed" | "not-found" | "malformed" = "unreachable", reason = "server unreachable"): RexResult {
  return { ok: false, op, kind, outcome: "none", reason, raw: { code: 4, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } };
}

function fakeCli(answers: Record<string, (input?: string) => RexResult>): RexCli & { calls: Array<{ op: string; argv: readonly string[]; input?: string; timeoutMs?: number; autostart?: boolean }> } {
  const calls: Array<{ op: string; argv: readonly string[]; input?: string; timeoutMs?: number; autostart?: boolean }> = [];
  return {
    binary: "/mock/rex",
    server: "unix:///mock/server.sock",
    calls,
    call(op, argv, opts) {
      calls.push({ op, argv, ...opts });
      const answer = answers[op];
      if (!answer) throw new Error(`unexpected op ${op}`);
      return answer(opts?.input);
    },
  };
}

const IDENTITY: RexIdentity = {
  server: "unix:///mock/server.sock",
  hostId: "host-1",
  sessionId: "session:0000aaaa-0000-0000-0000-000000000001",
  windowId: "window:0000aaaa-0000-0000-0000-000000000002",
  rootBlockId: "block:0000aaaa-0000-0000-0000-000000000010",
  blocks: [
    { name: "editor", blockId: "block:0000aaaa-0000-0000-0000-000000000010", label: "editor · vim" },
    { name: "sidebar", blockId: "block:0000aaaa-0000-0000-0000-000000000011", label: "sidebar · lazygit" },
    { name: "shell", blockId: "block:0000aaaa-0000-0000-0000-000000000012", label: "shell" },
  ],
};

function view(blockIds: string[], extra: Record<string, unknown> = {}) {
  return {
    session_id: IDENTITY.sessionId,
    label: "chapa",
    revision: 7,
    active_window_id: IDENTITY.windowId,
    windows: [{ window_id: IDENTITY.windowId, label: "[chapa]", layers: [{ layer_id: "layer:1", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: blockIds.map((id) => ({ block_id: id, label: "x", host_id: "host-1" })) }] }],
    ...extra,
  };
}

describe("listSessions", () => {
  it("runs ls --json with the read defaults (autostart off, 3 s) and returns the sessions", () => {
    const cli = fakeCli({ ls: () => ({ ok: true, op: "ls", stdout: "", json: { sessions: [{ session_id: "session:1", label: "chapa" }] } }) });
    expect(listSessions(cli)).toEqual({ ok: true, sessions: [{ sessionId: "session:1", label: "chapa" }] });
    expect(cli.calls).toEqual([{ op: "ls", argv: ["ls", "--json"] }]);
  });

  it("returns the failure, and a malformed answer as malformed", () => {
    const f = failure("ls");
    expect(listSessions(fakeCli({ ls: () => f }))).toBe(f);
    const malformed = listSessions(fakeCli({ ls: () => ({ ok: true, op: "ls", stdout: "", json: { nope: 1 } }) }));
    expect(malformed).toMatchObject({ ok: false, kind: "malformed" });
  });
});

describe("viewSession / parseSessionView", () => {
  it("calls session.view with the session id on stdin and flattens the windows' blocks", () => {
    const cli = fakeCli({ "session-view": () => ({ ok: true, op: "session-view", stdout: "", json: view(["block:a", "block:b"]) }) });
    const result = viewSession(cli, IDENTITY.sessionId);
    expect(cli.calls).toEqual([{ op: "session-view", argv: ["api", "call", "session.view", "-"], input: JSON.stringify({ session_id: IDENTITY.sessionId }) }]);
    expect(result).toEqual({ ok: true, view: { sessionId: IDENTITY.sessionId, label: "chapa", revision: 7, windows: [{ windowId: IDENTITY.windowId, label: "[chapa]", blockIds: ["block:a", "block:b"], hostIds: ["host-1", "host-1"] }] } });
  });

  it("rejects shapes without a session id or windows array, and tolerates null windows and layers", () => {
    expect(parseSessionView({ label: "x" })).toBeUndefined();
    expect(parseSessionView({ session_id: "session:1", label: "x", revision: 1, windows: null })).toEqual({ sessionId: "session:1", label: "x", revision: 1, windows: [] });
    expect(parseSessionView({ session_id: "session:1", label: "x", revision: 1, windows: [{ window_id: "window:1", layers: null }] })).toEqual({ sessionId: "session:1", label: "x", revision: 1, windows: [{ windowId: "window:1", label: "", blockIds: [], hostIds: [] }] });
  });
});

describe("sessionState (plan P10 table)", () => {
  const ls = (present: boolean) => () => ({ ok: true as const, op: "ls" as const, stdout: "", json: { sessions: present ? [{ session_id: IDENTITY.sessionId, label: "chapa" }] : [] } });

  it("ls failure is unknown with the reason", () => {
    const state = sessionState(fakeCli({ ls: () => failure("ls") }), IDENTITY, "chapa");
    expect(state).toEqual({ state: "unknown", reason: "server unreachable", liveBlocks: [] });
  });

  it("session absent is stopped", () => {
    expect(sessionState(fakeCli({ ls: ls(false) }), IDENTITY, "chapa")).toEqual({ state: "stopped", reason: "Rex session no longer exists", liveBlocks: [] });
  });

  it("view failure is unknown", () => {
    const cli = fakeCli({ ls: ls(true), "session-view": () => failure("session-view", "failed", "boom") });
    expect(sessionState(cli, IDENTITY, "chapa")).toMatchObject({ state: "unknown", reason: "boom" });
  });

  it("no blocks is stopped with the clean hint", () => {
    const cli = fakeCli({ ls: ls(true), "session-view": () => ({ ok: true, op: "session-view", stdout: "", json: view([]) }) });
    expect(sessionState(cli, IDENTITY, "chapa")).toEqual({ state: "stopped", reason: "empty Rex session remains; run summon clean chapa", liveBlocks: [] });
  });

  it("root block present in any window is active, with the live pane names", () => {
    const cli = fakeCli({ ls: ls(true), "session-view": () => ({ ok: true, op: "session-view", stdout: "", json: view([IDENTITY.rootBlockId, "block:0000aaaa-0000-0000-0000-000000000012"]) }) });
    expect(sessionState(cli, IDENTITY, "chapa")).toEqual({ state: "active", liveBlocks: ["editor", "shell"] });
  });

  it("root gone with another recorded block alive is partial", () => {
    const cli = fakeCli({ ls: ls(true), "session-view": () => ({ ok: true, op: "session-view", stdout: "", json: view(["block:0000aaaa-0000-0000-0000-000000000011"]) }) });
    expect(sessionState(cli, IDENTITY, "chapa")).toEqual({ state: "partial", reason: "root pane closed", liveBlocks: ["sidebar"] });
  });

  it("root gone and no recorded block alive is stopped even when foreign blocks exist", () => {
    const cli = fakeCli({ ls: ls(true), "session-view": () => ({ ok: true, op: "session-view", stdout: "", json: view(["block:foreign"]) }) });
    expect(sessionState(cli, IDENTITY, "chapa")).toEqual({ state: "stopped", reason: "no live panes", liveBlocks: [] });
  });
});
