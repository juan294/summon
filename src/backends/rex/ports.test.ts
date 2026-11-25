import { describe, it, expect } from "vitest";
import { parsePortsReply, readLivePorts, PANE_PORTS_UNSUPPORTED, PORTS_METHOD, PORTS_UNSUPPORTED, PORTS_TIMED_OUT, PORTS_CALL_TIMEOUT_MS } from "./ports.js";
import type { LiveTarget, RexAsyncRunner } from "./ports.js";
import { createLiveBudget } from "../live-budget.js";
import { rawResult } from "./cli.js";
import { classifyRexFailure } from "./errors.js";
import type { RexOp, RexResult } from "./types.js";
import { IO_CONCURRENCY } from "../../utils.js";

/** The live server's answer for a Python http.server pane (logs/rex-preview31-check/ports-probe.json, API 16). */
const PROBE_REPLY = {
  status: "ok",
  ports: [{ port: 47131, address: "127.0.0.1", protocol: "tcp", first_seen_at: "2026-11-17T06:29:55Z", pid: 19751 }],
  processes: [{ pid: 19751, user_id: 501, user: "juan", name: "Python", path: "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python", argv0: "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python", cwd: "/tmp" }],
};

/** This session's own agent pane on preview.21 (API 18), 2026-11-19. */
const AGENT_REPLY = {
  status: "ok",
  ports: [{ port: 52206, address: "127.0.0.1", protocol: "tcp", first_seen_at: "2026-11-19T06:29:32Z", pid: 60532 }],
  processes: [{ pid: 60532, user_id: 501, user: "juan", name: "2.1.328", path: "/Users/juan/.local/share/claude/versions/2.1.328", invoked_path: "/Users/juan/.local/bin/claude", argv0: "claude", cwd: "/Users/juan/code/summon" }],
};

describe("parsePortsReply", () => {
  it("reads a port and labels its holder with the first of script, argv0 and name", () => {
    expect(parsePortsReply(PROBE_REPLY)).toEqual({ status: "ok", ports: [{ port: 47131, address: "127.0.0.1", process: "Python", pid: 19751 }] });
    expect(parsePortsReply(AGENT_REPLY)).toEqual({ status: "ok", ports: [{ port: 52206, address: "127.0.0.1", process: "claude", pid: 60532 }] });
    const scripted = { ...AGENT_REPLY, processes: [{ pid: 60532, user_id: 501, name: "node", argv0: "node", script: "/work/app/server.js" }] };
    expect(parsePortsReply(scripted).ports[0]!.process).toBe("server.js");
    const nameOnly = { ...AGENT_REPLY, processes: [{ pid: 60532, user_id: 501, name: "zsh" }] };
    expect(parsePortsReply(nameOnly).ports[0]!.process).toBe("zsh");
  });

  it("an empty port list is ok and empty", () => {
    expect(parsePortsReply({ status: "ok", ports: [], processes: [] })).toEqual({ status: "ok", ports: [] });
  });

  it("partial keeps the ports and says a port may be missing; an unknown status reads as partial", () => {
    const partial = parsePortsReply({ ...AGENT_REPLY, status: "partial" });
    expect(partial).toMatchObject({ status: "partial", ports: [{ port: 52206 }] });
    expect(partial.reason).toContain("a port may be missing");
    expect(parsePortsReply({ ...AGENT_REPLY, status: "something-new" }).status).toBe("partial");
  });

  it("unsupported carries no ports and the API note", () => {
    expect(parsePortsReply({ status: "unsupported", ports: [], processes: [] })).toEqual({ status: "unsupported", ports: [], reason: PANE_PORTS_UNSUPPORTED });
  });

  it("skips an unknown protocol, a port outside 0..65535 and an entry without an address", () => {
    const reply = {
      status: "ok",
      ports: [
        { port: 1, address: "::1", protocol: "udp", first_seen_at: "x", pid: 1 },
        { port: 70000, address: "::1", protocol: "tcp", first_seen_at: "x", pid: 1 },
        { port: 3.5, address: "::1", protocol: "tcp", first_seen_at: "x", pid: 1 },
        { port: 3000, protocol: "tcp", first_seen_at: "x", pid: 1 },
        { port: 3001, address: "::", protocol: "tcp", first_seen_at: "x", pid: 1 },
      ],
      processes: [{ pid: 1, user_id: 0, name: "node" }],
    };
    expect(parsePortsReply(reply)).toEqual({ status: "ok", ports: [{ port: 3001, address: "::", process: "node", pid: 1 }] });
  });

  it("a port without a pid has no holder and makes the reply partial", () => {
    const result = parsePortsReply({ status: "ok", ports: [{ port: 80, address: "0.0.0.0", protocol: "tcp", first_seen_at: "x" }], processes: [] });
    expect(result).toMatchObject({ status: "partial", ports: [{ port: 80, process: null, pid: null }] });
  });

  it("a pid without a process entry keeps the pid and no label", () => {
    const result = parsePortsReply({ status: "ok", ports: [{ port: 80, address: "0.0.0.0", protocol: "tcp", first_seen_at: "x", pid: 9 }], processes: [] });
    expect(result).toEqual({ status: "ok", ports: [{ port: 80, address: "0.0.0.0", process: null, pid: 9 }] });
  });

  it("a truncated reply keeps what it lists and is partial", () => {
    const result = parsePortsReply({ ...AGENT_REPLY, truncated: true, id: "blob:1" });
    expect(result.status).toBe("partial");
    expect(result.ports).toHaveLength(1);
    expect(result.reason).toContain("some are not shown");
  });

  it("keeps a control character in a label raw (escaping is the display's job)", () => {
    const reply = { ...AGENT_REPLY, processes: [{ pid: 60532, user_id: 501, name: "x", argv0: "evil\u001b[31m" }] };
    expect(parsePortsReply(reply).ports[0]!.process).toBe("evil\u001b[31m");
  });

  it("accepts a reply without a processes array (labels unknown) and skips process entries without an integer pid", () => {
    const noProcesses = { status: "ok", ports: [{ port: 80, address: "::", protocol: "tcp", first_seen_at: "x", pid: 4 }] };
    expect(parsePortsReply(noProcesses)).toEqual({ status: "ok", ports: [{ port: 80, address: "::", process: null, pid: 4 }] });
    const badPid = { ...noProcesses, processes: [{ pid: "4", user_id: 0, name: "node" }, null] };
    expect(parsePortsReply(badPid).ports[0]!.process).toBeNull();
  });

  it("a label that is only a slash is kept as is", () => {
    const reply = { status: "ok", ports: [{ port: 80, address: "::", protocol: "tcp", first_seen_at: "x", pid: 4 }], processes: [{ pid: 4, user_id: 0, name: "x", argv0: "/" }] };
    expect(parsePortsReply(reply).ports[0]!.process).toBe("/");
  });

  it("a malformed answer is partial with no ports", () => {
    for (const json of [null, [], "text", { status: "ok" }, { status: "ok", ports: {} }]) {
      expect(parsePortsReply(json)).toMatchObject({ status: "partial", ports: [], reason: "unreadable ports reply" });
    }
  });
});

// --- readLivePorts ---

const TARGET: LiveTarget = {
  binary: "/opt/rex",
  server: "unix:///tmp/s.sock",
  sessionId: "session:1",
  blocks: [{ name: "editor", blockId: "block:e", label: "editor" }, { name: "server", blockId: "block:s", label: "server" }],
};

function ok(op: RexOp, json: unknown): RexResult {
  return { ok: true, op, stdout: JSON.stringify(json), json };
}

function failure(op: RexOp, code: number, stderr: string): RexResult {
  return classifyRexFailure(op, rawResult({ code, stderr }));
}

interface Script {
  describe?: () => RexResult;
  blocks?: unknown;
  ports?: (blockId: string) => RexResult | Promise<RexResult>;
}

function runner(script: Script): { run: RexAsyncRunner; calls: Array<{ op: RexOp; argv: readonly string[] }>; peak: () => number } {
  const calls: Array<{ op: RexOp; argv: readonly string[] }> = [];
  let inFlight = 0;
  let peak = 0;
  const run: RexAsyncRunner = async (op, argv, opts) => {
    calls.push({ op, argv });
    expect(opts).toMatchObject({ binary: TARGET.binary, timeoutMs: PORTS_CALL_TIMEOUT_MS, autostart: false });
    if (op === "api-describe") return script.describe?.() ?? ok(op, undefined);
    if (op === "block-ls") return ok(op, script.blocks ?? { blocks: [
      { block_id: "block:e", label: "editor", flavor: "com.superlogical.terminal.shell" },
      { block_id: "block:s", label: "server", flavor: "com.superlogical.terminal.shell" },
    ] });
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await (script.ports?.(argv[5]!) ?? ok(op, { status: "ok", ports: [], processes: [] }));
    } finally {
      inFlight--;
    }
  };
  return { run, calls, peak: () => peak };
}

const SERVER_PORTS = { status: "ok", ports: [
  { port: 5173, address: "::1", protocol: "tcp", first_seen_at: "x", pid: 7 },
  { port: 3000, address: "127.0.0.1", protocol: "tcp", first_seen_at: "x", pid: 7 },
], processes: [{ pid: 7, user_id: 501, name: "node", argv0: "node" }] };

describe("readLivePorts", () => {
  it("asks the server once whether it has the method, lists the session's blocks, then calls ports on each", async () => {
    const { run, calls } = runner({ ports: (id) => ok("block-call", id === "block:s" ? SERVER_PORTS : AGENT_REPLY) });
    const result = await readLivePorts(TARGET, createLiveBudget(), run);
    expect(calls.map((c) => c.argv)).toEqual([
      ["api", "describe", PORTS_METHOD],
      ["block", "ls", "-s", "session:1", "--json"],
      ["block", "call", "-s", "session:1", "-b", "block:e", "ports"],
      ["block", "call", "-s", "session:1", "-b", "block:s", "ports"],
    ]);
    expect(result).toEqual({ status: "ok", ports: [
      { port: 3000, address: "127.0.0.1", process: "node", pid: 7, pane: "server", recorded: true },
      { port: 5173, address: "::1", process: "node", pid: 7, pane: "server", recorded: true },
      { port: 52206, address: "127.0.0.1", process: "claude", pid: 60532, pane: "editor", recorded: true },
    ] });
  });

  it("shares one capability probe across workspaces on the same server", async () => {
    const { run, calls } = runner({});
    const budget = createLiveBudget();
    await Promise.all([readLivePorts(TARGET, budget, run), readLivePorts({ ...TARGET, sessionId: "session:2" }, budget, run)]);
    expect(calls.filter((c) => c.op === "api-describe")).toHaveLength(1);
    await readLivePorts({ ...TARGET, server: "unix:///other.sock" }, budget, run);
    expect(calls.filter((c) => c.op === "api-describe")).toHaveLength(2);
  });

  it("a server without the method is unsupported and nothing else is called", async () => {
    const { run, calls } = runner({ describe: () => failure("api-describe", 3, `Error: method "${PORTS_METHOD}" not found`) });
    expect(await readLivePorts(TARGET, createLiveBudget(), run)).toEqual({ status: "unsupported", ports: [], reason: PORTS_UNSUPPORTED });
    expect(calls).toHaveLength(1);
  });

  it("a probe or block list that fails is unavailable with Rex's reason", async () => {
    const probe = runner({ describe: () => failure("api-describe", 4, "Error: could not connect to server") });
    expect(await readLivePorts(TARGET, createLiveBudget(), probe.run)).toEqual({ status: "unavailable", ports: [], reason: "Error: could not connect to server" });
    const { run } = runner({ blocks: { nope: true } });
    expect(await readLivePorts(TARGET, createLiveBudget(), run)).toEqual({ status: "unavailable", ports: [], reason: "unreadable block list" });
  });

  it("one pane that does not answer makes the result partial and keeps the other panes' ports", async () => {
    const { run } = runner({ ports: (id) => (id === "block:e" ? failure("block-call", 1, "Error: boom") : ok("block-call", SERVER_PORTS)) });
    const result = await readLivePorts(TARGET, createLiveBudget(), run);
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("pane editor did not answer (Error: boom)");
    expect(result.ports.map((p) => p.port)).toEqual([3000, 5173]);
  });

  it.each(["reply", "missing method"])("reports incomplete coverage for an unsupported pane (%s) and keeps its sibling's ports", async (kind) => {
    const { run } = runner({ ports: (id) => {
      if (id === "block:s") return ok("block-call", SERVER_PORTS);
      return kind === "reply"
        ? ok("block-call", { status: "unsupported", ports: [], processes: [] })
        : failure("block-call", 1, 'Error: block has no method "ports"');
    } });
    const result = await readLivePorts(TARGET, createLiveBudget(), run);
    expect(result.status).toBe("partial");
    expect(result.reason).toMatch(/unsupported|does not support/i);
    expect(result.ports.map((p) => p.port)).toEqual([3000, 5173]);
  });

  it("a block list that fails is unavailable with Rex's reason", async () => {
    const run: RexAsyncRunner = async (op, argv, opts) => (op === "block-ls" ? failure(op, 4, "Error: could not connect to server") : runner({}).run(op, argv, opts));
    expect(await readLivePorts(TARGET, createLiveBudget(), run)).toEqual({ status: "unavailable", ports: [], reason: "Error: could not connect to server" });
  });

  it("merges a pane's partial reason into the result", async () => {
    const { run } = runner({ ports: (id) => ok("block-call", id === "block:e" ? { ...AGENT_REPLY, status: "partial" } : SERVER_PORTS) });
    const result = await readLivePorts(TARGET, createLiveBudget(), run);
    expect(result.status).toBe("partial");
    expect(result.reason).toContain("a port may be missing");
    expect(result.ports).toHaveLength(3);
  });

  it("a deadline that passes after the probe reads no blocks; one that passes during the block list calls no pane", async () => {
    let clock = 0;
    const afterProbe = createLiveBudget(100, () => clock);
    const probeOnly: RexAsyncRunner = async (op, argv, opts) => { if (op === "api-describe") clock = 200; return runner({}).run(op, argv, opts); };
    expect(await readLivePorts(TARGET, afterProbe, probeOnly)).toEqual({ status: "unavailable", ports: [], reason: PORTS_TIMED_OUT });

    clock = 0;
    const afterList = createLiveBudget(100, () => clock);
    const calls: RexOp[] = [];
    const listThenLate: RexAsyncRunner = async (op, argv, opts) => { calls.push(op); if (op === "block-ls") clock = 200; return runner({}).run(op, argv, opts); };
    expect(await readLivePorts(TARGET, afterList, listThenLate)).toEqual({ status: "unavailable", ports: [], reason: PORTS_TIMED_OUT });
    expect(calls).toEqual(["api-describe", "block-ls"]);
  });

  it("a runner that ignores the signal and never answers still ends at the deadline", async () => {
    const never: RexAsyncRunner = (op, argv, opts) => (op === "block-call" ? new Promise(() => {}) : runner({}).run(op, argv, opts));
    const started = Date.now();
    expect(await readLivePorts(TARGET, createLiveBudget(50), never)).toEqual({ status: "unavailable", ports: [], reason: PORTS_TIMED_OUT });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("every pane failing is unavailable", async () => {
    const { run } = runner({ ports: () => failure("block-call", 1, "Error: boom") });
    expect(await readLivePorts(TARGET, createLiveBudget(), run)).toMatchObject({ status: "unavailable", ports: [] });
  });

  it("labels an unrecorded terminal block with its Rex label and skips blocks of other flavors", async () => {
    const blocks = { blocks: [
      { block_id: "block:e", label: "editor", flavor: "com.superlogical.terminal.shell" },
      { block_id: "block:x", label: "pnpm dev", flavor: "com.superlogical.terminal.shell" },
      { block_id: "block:y", label: "", flavor: "com.superlogical.terminal.shell" },
      { block_id: "block:w", label: "docs", flavor: "com.example.web" },
      { label: "no id" },
    ] };
    const { run, calls } = runner({ blocks, ports: (id) => ok("block-call", id === "block:e" ? { status: "ok", ports: [], processes: [] } : SERVER_PORTS) });
    const result = await readLivePorts(TARGET, createLiveBudget(), run);
    expect(calls.filter((c) => c.op === "block-call").map((c) => c.argv[5])).toEqual(["block:e", "block:x", "block:y"]);
    expect(new Set(result.ports.map((p) => `${p.pane}|${p.recorded}`))).toEqual(new Set(["pnpm dev|false", "unrecorded pane|false"]));
  });

  it("a block that has no ports method (an older server past the probe) reads as unsupported", async () => {
    const { run } = runner({ ports: () => failure("block-call", 1, 'Error: block 622fe8 has no method "ports"; methods: process, title') });
    expect(await readLivePorts(TARGET, createLiveBudget(), run)).toEqual({ status: "unsupported", ports: [], reason: PORTS_UNSUPPORTED });
  });

  it("does not blame the server version when every pane answers unsupported", async () => {
    const { run } = runner({ ports: () => ok("block-call", { status: "unsupported", ports: [], processes: [] }) });
    const result = await readLivePorts(TARGET, createLiveBudget(), run);
    expect(result).toEqual({ status: "unavailable", ports: [], reason: "2 terminal panes do not support live ports" });
  });

  it("never runs more ports calls at once than IO_CONCURRENCY", async () => {
    const many = Array.from({ length: IO_CONCURRENCY * 3 }, (_, i) => ({ block_id: `block:${i}`, label: `p${i}`, flavor: "com.superlogical.terminal.shell" }));
    const { run, calls, peak } = runner({ blocks: { blocks: many } });
    expect((await readLivePorts(TARGET, createLiveBudget(), run)).status).toBe("ok");
    expect(calls.filter((c) => c.op === "block-call")).toHaveLength(many.length);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(IO_CONCURRENCY);
  });

  it("shares a single native call limit across workspaces while each makes progress", async () => {
    const count = IO_CONCURRENCY * 3;
    const blocks = { blocks: Array.from({ length: count }, (_, i) => ({ block_id: `block:${i}` })) };
    const { run, calls, peak } = runner({ blocks });
    const budget = createLiveBudget();
    const sessions = ["session:a", "session:b", "session:c"];
    const results = await Promise.all(sessions.map((sessionId) => readLivePorts({ ...TARGET, sessionId }, budget, run)));
    expect(peak()).toBeLessThanOrEqual(IO_CONCURRENCY);
    expect(peak()).toBeGreaterThan(1);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(calls.filter((c) => c.op === "api-describe")).toHaveLength(1);
    const panes = calls.filter((c) => c.op === "block-call");
    for (const id of sessions) expect(panes.filter((c) => c.argv[3] === id)).toHaveLength(count);
    // Each workspace gets a turn before the first one drains all its panes.
    expect(new Set(panes.slice(0, IO_CONCURRENCY * sessions.length).map((c) => c.argv[3]))).toEqual(new Set(sessions));
  });

  it("starts no queued native call after the deadline, even when active runners ignore abort", async () => {
    const budget = createLiveBudget(100);
    const blocks = Array.from({ length: IO_CONCURRENCY }, (_, i) => ({ block_id: `block:${i}` }));
    let started = 0;
    const run: RexAsyncRunner = async (op) => {
      if (op === "block-ls") return ok(op, { blocks });
      if (op === "api-describe") return ok(op, undefined);
      started++;
      return new Promise<RexResult>(() => {});
    };
    const results = await Promise.all(["session:a", "session:b"].map((sessionId) => readLivePorts({ ...TARGET, sessionId }, budget, run)));
    expect(started).toBe(IO_CONCURRENCY);
    expect(results.map((r) => r.reason)).toEqual([PORTS_TIMED_OUT, PORTS_TIMED_OUT]);
  });

  it("the shared deadline ends calls that never answer and later workspaces read nothing", async () => {
    const budget = createLiveBudget(50);
    const hung: RexAsyncRunner = (op, argv, opts) => {
      if (op !== "block-call") return runner({}).run(op, argv, opts);
      return new Promise((resolve) => opts.signal!.addEventListener("abort", () => resolve(classifyRexFailure(op, rawResult({ timedOut: true })))));
    };
    const started = Date.now();
    const result = await readLivePorts(TARGET, budget, hung);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result).toEqual({ status: "unavailable", ports: [], reason: PORTS_TIMED_OUT });
    const { run, calls } = runner({});
    expect(await readLivePorts(TARGET, budget, run)).toEqual({ status: "unavailable", ports: [], reason: PORTS_TIMED_OUT });
    expect(calls).toHaveLength(0);
  });
});
