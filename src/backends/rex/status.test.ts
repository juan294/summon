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

  it("rejects malformed nested shapes instead of reading them as an empty window", () => {
    const base = { session_id: "session:1", label: "x", revision: 1 };
    const window = (layers: unknown) => ({ ...base, windows: [{ window_id: "window:1", layers }] });
    expect(parseSessionView(window("malformed"))).toBeUndefined();
    expect(parseSessionView(window([7]))).toBeUndefined();
    expect(parseSessionView(window([{ blocks: {} }]))).toBeUndefined();
    expect(parseSessionView(window([{ blocks: ["block:a"] }]))).toBeUndefined();
    expect(parseSessionView(window([{ blocks: [{ block_id: 42 }] }]))).toBeUndefined();
    // Null or absent nested values are the valid empty representations.
    expect(parseSessionView(window([{ blocks: null }, {}]))).toEqual({ sessionId: "session:1", label: "x", revision: 1, windows: [{ windowId: "window:1", label: "", blockIds: [], hostIds: [] }] });
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

  it("a view with a malformed nested shape is unknown, never an empty stopped session", () => {
    const json = { session_id: IDENTITY.sessionId, revision: 1, windows: [{ window_id: IDENTITY.windowId, layers: "malformed" }] };
    const cli = fakeCli({ ls: ls(true), "session-view": () => ({ ok: true, op: "session-view", stdout: JSON.stringify(json), json }) });
    expect(sessionState(cli, IDENTITY, "chapa")).toMatchObject({ state: "unknown", liveBlocks: [] });
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

// --- Phase 4: focus / inspect / title adapters ---

describe("focusRex", async () => {
  const { focusRex } = await import("./status.js");
  const PANES = ["editor", "sidebar", "editor-2", "shell"];
  const CLIENTS = { clients: [{ client_id: "client:app", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app" } }] };
  const live = (blocks: string[]) => blocks;

  it("focuses the named pane's block, then shows the session in the app", () => {
    const cli = fakeCli({ focus: () => ({ ok: true, op: "focus", stdout: "" }), "client-ls": () => ({ ok: true, op: "client-ls", stdout: "", json: CLIENTS }), "do-select": () => ({ ok: true, op: "do-select", stdout: "" }) });
    const result = focusRex(cli, IDENTITY, PANES, "chapa", live(["editor", "sidebar", "shell"]), "shell");
    expect(result).toEqual({ kind: "focused", terminalId: "block:0000aaaa-0000-0000-0000-000000000012" });
    expect(cli.calls.map((c) => [c.op, ...c.argv])).toEqual([
      ["focus", "focus", "-s", IDENTITY.sessionId, "block:0000aaaa-0000-0000-0000-000000000012"],
      ["client-ls", "api", "call", "client.list", "-"],
      ["do-select", "-C", "client:app", "do", "session.select", `session_id=${IDENTITY.sessionId}`, `window_id=${IDENTITY.windowId}`, "--json"],
    ]);
  });

  it("without a pane name targets the root when live, else the first live pane (partial)", () => {
    const answers = { focus: () => ({ ok: true as const, op: "focus" as const, stdout: "" }), "client-ls": () => ({ ok: true as const, op: "client-ls" as const, stdout: "", json: CLIENTS }), "do-select": () => ({ ok: true as const, op: "do-select" as const, stdout: "" }) };
    const root = fakeCli(answers);
    expect(focusRex(root, IDENTITY, PANES, "chapa", live(["editor", "shell"]))).toMatchObject({ kind: "focused", terminalId: IDENTITY.rootBlockId });
    const partial = fakeCli(answers);
    expect(focusRex(partial, IDENTITY, PANES, "chapa", live(["shell"]))).toMatchObject({ kind: "focused", terminalId: "block:0000aaaa-0000-0000-0000-000000000012" });
  });

  it("refuses an unverified pane, an unknown pane and a closed pane without calling rex", () => {
    const cli = fakeCli({});
    expect(focusRex(cli, IDENTITY, PANES, "chapa", live(["editor"]), "editor-2")).toEqual({ kind: "unavailable", code: "missing", reason: "pane editor-2 could not be verified after recovery; run summon inspect chapa" });
    expect(focusRex(cli, IDENTITY, PANES, "chapa", live(["editor"]), "nope")).toEqual({ kind: "unavailable", code: "missing", reason: "Unknown pane. Valid panes: editor, sidebar, editor-2, shell. Run summon inspect chapa." });
    expect(focusRex(cli, IDENTITY, PANES, "chapa", live(["editor"]), "shell")).toEqual({ kind: "unavailable", code: "missing", reason: "pane shell is closed in Rex; run summon inspect chapa" });
    expect(cli.calls).toEqual([]);
  });

  it("reports a failed focus or a session that no app can show", () => {
    const noFocus = fakeCli({ focus: () => failure("focus", "failed", "boom") });
    expect(focusRex(noFocus, IDENTITY, PANES, "chapa", live(["editor"]))).toEqual({ kind: "failed", code: "unavailable", reason: "boom" });
    const noApp = fakeCli({ focus: () => ({ ok: true, op: "focus", stdout: "" }), "client-ls": () => ({ ok: true, op: "client-ls", stdout: "", json: { clients: [] } }) });
    expect(focusRex(noApp, IDENTITY, PANES, "chapa", live(["editor"]))).toEqual({ kind: "failed", code: "unavailable", reason: "no Rex app is connected; open Rex and pick [chapa]" });
  });
});

describe("inspectRex", async () => {
  const { inspectRex } = await import("./status.js");
  const PANES = ["editor", "sidebar", "editor-2", "shell"];

  it("lists every recorded pane with pid, cwd and title from block calls; tty is never available", () => {
    const cli = fakeCli({});
    // Title answers are distinguished by argv: the fake receives the method as the last argv element.
    cli.call = ((op, argv, opts) => {
      cli.calls.push({ op, argv, ...opts });
      if (argv.includes("title")) return { ok: true, op: "block-call", stdout: "", json: { title: "vim ~/code" } };
      return { ok: true, op: "block-call", stdout: "", json: { foreground: { pid: 4242, cwd: "/Users/me/code/chapa" }, child: { pid: 4000 } } };
    }) as typeof cli.call;
    const result = inspectRex(cli, IDENTITY, PANES, "chapa", IDENTITY.blocks.map((b) => b.name));
    expect(result.availability).toBe("available");
    expect(result.panes.map((p) => [p.name, p.blockId, p.pid, p.tty, p.title, p.directory, p.availability])).toEqual([
      ["editor", IDENTITY.rootBlockId, 4242, null, "vim ~/code", "/Users/me/code/chapa", "available"],
      ["sidebar", "block:0000aaaa-0000-0000-0000-000000000011", 4242, null, "vim ~/code", "/Users/me/code/chapa", "available"],
      ["editor-2", null, null, null, null, null, "unverified"],
      ["shell", "block:0000aaaa-0000-0000-0000-000000000012", 4242, null, "vim ~/code", "/Users/me/code/chapa", "available"],
    ]);
    expect(cli.calls.filter((c) => c.op === "block-call").map((c) => c.argv)).toContainEqual(["block", "call", "-s", IDENTITY.sessionId, "-b", IDENTITY.rootBlockId, "process"]);
    expect(cli.calls.filter((c) => c.op === "block-call").map((c) => c.argv)).toContainEqual(["block", "call", "-s", IDENTITY.sessionId, "-b", IDENTITY.rootBlockId, "title"]);
    expect(cli.calls.some((c) => c.op === "block-ls")).toBe(false);
  });

  it("marks closed blocks (absent from the reader's live set) and degrades availability without any block call for them", () => {
    const cli = fakeCli({ "block-call": () => ({ ok: true, op: "block-call", stdout: "", json: {} }) });
    const result = inspectRex(cli, IDENTITY, ["editor", "sidebar", "shell"], "chapa", ["editor"]);
    expect(result.availability).toBe("unavailable");
    expect(result.reason).toBe("2 recorded panes are closed in Rex (sidebar, shell)");
    expect(result.panes.map((p) => [p.name, p.availability, p.pid])).toEqual([["editor", "available", null], ["sidebar", "closed", null], ["shell", "closed", null]]);
    expect(cli.calls.filter((c) => c.op === "block-call").every((c) => c.argv.includes(IDENTITY.rootBlockId))).toBe(true);
  });
});

describe("titleRex", async () => {
  const { titleRex } = await import("./status.js");
  const PANES = ["editor", "sidebar", "shell"];
  const blockLs = (label: string) => ({ ok: true as const, op: "block-ls" as const, stdout: "", json: { blocks: [{ block_id: IDENTITY.rootBlockId, label }] } });

  it("reads, sets and resets a pane label through session.set_block_label", () => {
    const cli = fakeCli({ "block-ls": () => blockLs("editor · vim"), "block-label": () => ({ ok: true, op: "block-label", stdout: "", json: { revision: 9 } }) });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "pane", { kind: "read" }, "editor")).toEqual({ kind: "title", terminalId: IDENTITY.rootBlockId, scope: "pane", override: "editor · vim" });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "pane", { kind: "set", text: "notes" }, "editor")).toEqual({ kind: "title", terminalId: IDENTITY.rootBlockId, scope: "pane", override: "notes" });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "pane", { kind: "reset" }, "editor")).toEqual({ kind: "title", terminalId: IDENTITY.rootBlockId, scope: "pane", override: "editor · vim" });
    const labelCalls = cli.calls.filter((c) => c.op === "block-label");
    expect(labelCalls.map((c) => [c.argv, JSON.parse(c.input!)])).toEqual([
      [["api", "call", "session.set_block_label", "-"], { session_id: IDENTITY.sessionId, block_id: IDENTITY.rootBlockId, label: "notes" }],
      [["api", "call", "session.set_block_label", "-"], { session_id: IDENTITY.sessionId, block_id: IDENTITY.rootBlockId, label: "editor · vim" }],
    ]);
  });

  it("reads, sets and resets the tab (window) label through session.set_window_label", () => {
    const cli = fakeCli({
      "session-view": () => ({ ok: true, op: "session-view", stdout: "", json: view([IDENTITY.rootBlockId]) }),
      "window-rename": () => ({ ok: true, op: "window-rename", stdout: "", json: { revision: 10 } }),
    });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "tab", { kind: "read" })).toEqual({ kind: "title", terminalId: IDENTITY.windowId, scope: "tab", override: "[chapa]" });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "tab", { kind: "set", text: "work" })).toEqual({ kind: "title", terminalId: IDENTITY.windowId, scope: "tab", override: "work" });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "tab", { kind: "reset" })).toEqual({ kind: "title", terminalId: IDENTITY.windowId, scope: "tab", override: "[chapa]" });
    expect(cli.calls.filter((c) => c.op === "window-rename").map((c) => JSON.parse(c.input!))).toEqual([
      { session_id: IDENTITY.sessionId, window_id: IDENTITY.windowId, label: "work" },
      { session_id: IDENTITY.sessionId, window_id: IDENTITY.windowId, label: "[chapa]" },
    ]);
  });

  it("refuses unknown or unverified panes and reports server failures", () => {
    const cli = fakeCli({ "block-label": () => failure("block-label", "failed", "bad_request: label too long") });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "pane", { kind: "read" }, "nope")).toEqual({ kind: "unavailable", code: "missing", reason: "Unknown pane. Valid panes: editor, sidebar, shell. Run summon inspect chapa." });
    expect(titleRex(cli, IDENTITY, ["editor", "late"], "chapa", "pane", { kind: "read" }, "late")).toEqual({ kind: "unavailable", code: "missing", reason: "pane late could not be verified after recovery; run summon inspect chapa" });
    expect(titleRex(cli, IDENTITY, PANES, "chapa", "pane", { kind: "set", text: "x".repeat(200) }, "editor")).toEqual({ kind: "failed", code: "unavailable", reason: "bad_request: label too long" });
    expect(cli.calls.map((c) => c.op)).toEqual(["block-label"]);
  });
});

describe("program status (OSC 7501, Phase 5)", async () => {
  const { mostSevereProgramStatus, programStatusOf, inspectRex } = await import("./status.js");

  it("picks the most severe record and keeps its text fields; unknown states count as idle; no records means nothing", () => {
    const records = { records: [
      { state: "working", app: "cargo", title: "build", progress: 40 },
      { state: "blocked", kind: "permission", app: "claude", msg: "Allow rm -rf?" },
      { state: "weird" },
      { state: "done", title: "tests" },
    ] };
    expect(mostSevereProgramStatus(records)).toEqual({ state: "blocked", kind: "permission", app: "claude", msg: "Allow rm -rf?" });
    expect(mostSevereProgramStatus({ records: [{ state: "weird" }] })).toEqual({ state: "idle" });
    expect(mostSevereProgramStatus({ records: [] })).toBeUndefined();
    expect(mostSevereProgramStatus(null)).toBeUndefined();
    expect(mostSevereProgramStatus({ records: [{ state: "error", msg: "exit 1" }, { state: "working" }] })).toEqual({ state: "error", msg: "exit 1" });
  });

  it("programStatusOf calls block call program_status and inspectRex reports the root pane's status", () => {
    const cli = fakeCli({ "block-call": (input) => { void input; return { ok: true, op: "block-call", stdout: "", json: { records: [{ state: "working", app: "pnpm" }] } }; } });
    expect(programStatusOf(cli, IDENTITY.sessionId, IDENTITY.rootBlockId)).toEqual({ state: "working", app: "pnpm" });
    expect(cli.calls[0]!.argv).toEqual(["block", "call", "-s", IDENTITY.sessionId, "-b", IDENTITY.rootBlockId, "program_status"]);
    const inspect = inspectRex(cli, IDENTITY, ["editor"], "chapa", ["editor"]);
    expect(inspect.programStatus).toEqual({ state: "working", app: "pnpm" });
    const closedRoot = inspectRex(cli, IDENTITY, ["editor", "shell"], "chapa", ["shell"]);
    expect(closedRoot.programStatus).toBeUndefined();
  });
});

