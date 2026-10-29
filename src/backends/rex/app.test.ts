import { describe, it, expect, vi } from "vitest";
import { chooseAppClient, parseAppClients, listAppClients, waitForAppClient, pollUntil, discoverRexApp, openRexApp } from "./app.js";
import type { AppClient } from "./app.js";
import type { RexCli } from "./cli.js";
import type { RexResult } from "./types.js";

function client(id: string, connectedAt: string, extra: Partial<AppClient> = {}): AppClient {
  return { clientId: id, connectedAt, connectionState: "connected", label: id, sessionIds: [], ...extra };
}

function fakeCli(answer: (argv: readonly string[], input?: string) => RexResult): RexCli & { calls: Array<{ op: string; argv: readonly string[]; input?: string }> } {
  const calls: Array<{ op: string; argv: readonly string[]; input?: string }> = [];
  return {
    binary: "/mock/rex",
    server: "unix:///mock/server.sock",
    calls,
    call(op, argv, opts) {
      calls.push({ op, argv, ...(opts?.input !== undefined ? { input: opts.input } : {}) });
      return answer(argv, opts?.input);
    },
  };
}

const RAW_CLIENTS = {
  clients: [
    { client_id: "client:b", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app", label: "Studio" }, session_ids: ["session:1"] },
    { client_id: "client:a", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app" } },
    { client_id: "client:lost", connected_at: "2026-10-29T09:00:00Z", connection_state: "lost", info: { kind: "app" } },
    { client_id: "client:cli", connected_at: "2026-10-29T09:00:00Z", connection_state: "connected", info: { kind: "cli" } },
    { client_id: "client:nokind", connected_at: "2026-10-29T09:00:00Z" },
  ],
};

describe("parseAppClients", () => {
  it("keeps app clients that are not lost; a missing connection_state counts as connected", () => {
    const parsed = parseAppClients({ clients: [...RAW_CLIENTS.clients, { client_id: "client:c", connected_at: "2026-10-29T07:00:00Z", info: { kind: "app" } }] });
    expect(parsed.map((c) => c.clientId)).toEqual(["client:b", "client:a", "client:c"]);
    expect(parsed[0]).toEqual({ clientId: "client:b", connectedAt: "2026-10-29T08:00:00Z", connectionState: "connected", label: "Studio", sessionIds: ["session:1"] });
    expect(parsed[1]!.label).toBeUndefined();
  });

  it("keeps lost clients, marked as lost, when asked (doctor)", () => {
    const parsed = parseAppClients(RAW_CLIENTS, { includeLost: true });
    expect(parsed.map((c) => [c.clientId, c.connectionState])).toEqual([["client:b", "connected"], ["client:a", "connected"], ["client:lost", "lost"]]);
  });

  it("returns nothing for shapes that are not a client list", () => {
    expect(parseAppClients(null)).toEqual([]);
    expect(parseAppClients({ clients: null })).toEqual([]);
    expect(parseAppClients({ clients: [{ info: { kind: "app" } }] })).toEqual([]);
  });
});

describe("chooseAppClient (plan P7)", () => {
  it("picks the newest connected_at", () => {
    const choice = chooseAppClient([client("client:old", "2026-10-29T07:00:00Z"), client("client:new", "2026-10-29T08:00:00Z")]);
    expect(choice?.chosen.clientId).toBe("client:new");
    expect(choice?.others.map((c) => c.clientId)).toEqual(["client:old"]);
  });

  it("breaks equal timestamps by the lexicographically smallest client id", () => {
    const choice = chooseAppClient([client("client:b", "2026-10-29T08:00:00Z"), client("client:a", "2026-10-29T08:00:00Z")]);
    expect(choice?.chosen.clientId).toBe("client:a");
  });

  it("returns undefined for an empty set and no others for a single client", () => {
    expect(chooseAppClient([])).toBeUndefined();
    expect(chooseAppClient([client("client:a", "2026-10-29T08:00:00Z")])?.others).toEqual([]);
  });

  it("prefers the apps attached to the caller's session, and falls back to every app when none is attached", () => {
    const attachedOld = client("client:attached", "2026-10-29T07:00:00Z", { sessionIds: ["session:caller"] });
    const newer = client("client:newer", "2026-10-29T09:00:00Z");
    expect(chooseAppClient([newer, attachedOld], "session:caller")?.chosen.clientId).toBe("client:attached");
    expect(chooseAppClient([newer, attachedOld], "session:caller")?.others).toEqual([]);
    expect(chooseAppClient([newer, attachedOld], "session:other")?.chosen.clientId).toBe("client:newer");
    expect(chooseAppClient([newer, attachedOld])?.chosen.clientId).toBe("client:newer");
  });
});

describe("listAppClients", () => {
  it("calls client.list once with kinds app and drops lost clients", () => {
    const cli = fakeCli(() => ({ ok: true, op: "client-ls", stdout: "", json: RAW_CLIENTS }));
    const result = listAppClients(cli);
    expect(cli.calls).toEqual([{ op: "client-ls", argv: ["api", "call", "client.list", "-"], input: JSON.stringify({ kinds: ["app"] }) }]);
    expect(result).toEqual({ ok: true, clients: [expect.objectContaining({ clientId: "client:b" }), expect.objectContaining({ clientId: "client:a" })] });
  });

  it("returns the failure as is", () => {
    const failure: RexResult = { ok: false, op: "client-ls", kind: "unreachable", outcome: "none", reason: "exit 4", raw: { code: 4, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } };
    expect(listAppClients(fakeCli(() => failure))).toBe(failure);
  });
});

describe("waitForAppClient", () => {
  it("polls until a client appears, honoring the interval and the deadline with an injected clock", async () => {
    let answers = 0;
    const cli = fakeCli(() => {
      answers += 1;
      return { ok: true, op: "client-ls", stdout: "", json: answers < 3 ? { clients: [] } : RAW_CLIENTS };
    });
    let now = 0;
    const sleeps: number[] = [];
    const clock = { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; } };
    const found = await waitForAppClient(cli, undefined, { timeoutMs: 8000, intervalMs: 250, clock });
    expect(found?.chosen.clientId).toBe("client:a");
    expect(sleeps).toEqual([250, 250]);
  });

  it("pollUntil returns undefined at the deadline without a read past it", async () => {
    let now = 0;
    const reads: number[] = [];
    const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
    expect(await pollUntil(() => { reads.push(now); return undefined; }, { timeoutMs: 500, intervalMs: 250, clock })).toBeUndefined();
    expect(reads).toEqual([0, 250, 500]);
  });

  it("gives up at the deadline and treats a listing failure like an empty answer", async () => {
    const cli = fakeCli(() => ({ ok: false, op: "client-ls", kind: "failed", outcome: "none", reason: "boom", raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } }));
    let now = 0;
    const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
    expect(await waitForAppClient(cli, "session:1", { timeoutMs: 1000, intervalMs: 250, clock })).toBeUndefined();
    expect(cli.calls.length).toBe(5);
  });
});

describe("discoverRexApp / openRexApp", () => {
  it("returns the first existing bundle in search order", () => {
    const exists = (p: string) => p === "/Users/me/Applications/Rex.app";
    expect(discoverRexApp(exists, "/Users/me")).toBe("/Users/me/Applications/Rex.app");
    expect(discoverRexApp(() => false, "/Users/me")).toBeNull();
    expect(discoverRexApp(() => true, "/Users/me")).toBe("/Applications/Rex Beta.app");
  });

  it("opens the bundle through /usr/bin/open -a and reports failure instead of throwing", () => {
    const exec = vi.fn();
    expect(openRexApp("/Applications/Rex Beta.app", exec)).toBe(true);
    expect(exec).toHaveBeenCalledWith("/usr/bin/open", ["-a", "/Applications/Rex Beta.app"], expect.objectContaining({ stdio: "ignore" }));
    exec.mockImplementation(() => { throw new Error("nope"); });
    expect(openRexApp("/Applications/Rex Beta.app", exec)).toBe(false);
  });
});
