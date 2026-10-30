import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpHome = mkdtempSync(join(tmpdir(), "summon-rex-launch-"));
vi.mock("./../../paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../paths.js")>();
  const configDir = join(tmpHome, ".config", "summon");
  return { ...actual, CONFIG_DIR: configDir, STATUS_DIR: join(configDir, "status") };
});

const { launchArtifactPaths, writeLaunchManifest, listLaunchManifests } = await import("../../launch-identity.js");
const { readStatusRecord, withOwnedRecord, statusTestHooks } = await import("../../status.js");
const { STATUS_DIR } = await import("../../paths.js");
const { createWorkspace, readPaneFile, readPaneMapping, waitForToken, adoptOrphans, refreshPaneMapping, maybeSwitchToExisting, showWorkspace, showRecordedWorkspace } = await import("./launch.js");
const { selectInApp } = await import("./app.js");
type LaunchModule = typeof import("./launch.js");
type CreateContext = Parameters<LaunchModule["createWorkspace"]>[2];
type AdoptDeps = Parameters<LaunchModule["adoptOrphans"]>[1];
const { buildSessionCreateRequest } = await import("./layout.js");
const { planLayout, getPreset } = await import("../../layout.js");
type RexCli = import("./cli.js").RexCli;
type RexResult = import("./types.js").RexResult;
type LaunchManifest = import("../../launch-identity.js").LaunchManifest;
type WorkspaceStatus = import("../../status.js").WorkspaceStatus;

const ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const ID2 = "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f";
const SERVER = "unix:///mock/server.sock";
const SESSION = "session:0000aaaa-0000-0000-0000-000000000001";
const WINDOW = "window:0000aaaa-0000-0000-0000-000000000002";
const blockId = (n: number) => `block:0000aaaa-0000-0000-0000-0000000000${n.toString().padStart(2, "0")}`;
const CLIENT = { client_id: "client:app", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app", label: "Studio" } };

function fullBuild() {
  const plan = planLayout({ editor: "vim", ...getPreset("full") });
  return buildSessionCreateRequest({ layout: { kind: "traditional", plan }, targetDir: "/Users/me/code/chapa", project: "chapa", launchId: ID, loginShell: "/bin/zsh" });
}

function manifestFor(launchId = ID, overrides: Partial<LaunchManifest> = {}): LaunchManifest {
  const build = fullBuild();
  return {
    version: 1,
    launchId,
    project: "chapa",
    directory: "/Users/me/code/chapa",
    layout: "full",
    panes: ["editor", "sidebar", "editor-2", "right-1", "shell"],
    paneOrder: build.paneOrder,
    blockLabels: build.labels,
    backend: "rex",
    server: SERVER,
    startedAt: "2026-10-29T10:00:00.000Z",
    ...overrides,
  };
}

function writePane(launchId: string, name: string, sessionId: string, block: string, opts: { tmp?: boolean; raw?: string } = {}): void {
  const paths = launchArtifactPaths("chapa", launchId);
  mkdirSync(paths.dir, { recursive: true });
  const target = opts.tmp ? paths.pane(name).tmp : paths.pane(name).file;
  writeFileSync(target, opts.raw ?? `${sessionId}\n${block}\n`);
}

function ok(op: RexResult["op"], json: unknown): RexResult {
  return { ok: true, op, stdout: JSON.stringify(json), json };
}
function fail(op: RexResult["op"], kind: import("./types.js").RexFailureKind, outcome: import("./types.js").RexOutcome, reason = `${kind} failure`): RexResult {
  return { ok: false, op, kind, outcome, reason, raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } };
}

type Answer = (argv: readonly string[], input: string | undefined, nth: number) => RexResult;
interface Recorded { op: string; argv: string[]; input?: string; timeoutMs?: number; autostart?: boolean; server: string }

function fakeCli(answers: Partial<Record<RexResult["op"], Answer>>, server = SERVER): RexCli & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const counts = new Map<string, number>();
  return {
    binary: "/mock/rex",
    server,
    calls,
    call(op, argv, opts = {}) {
      const nth = (counts.get(op) ?? 0) + 1;
      counts.set(op, nth);
      calls.push({ op, argv: [...argv], server, ...opts });
      const answer = answers[op];
      if (!answer) throw new Error(`unexpected rex op ${op} ${argv.join(" ")}`);
      return answer(argv, opts.input, nth);
    },
  };
}

function viewJson(blockIds: string[], extra: Record<string, unknown> = {}) {
  return { session_id: SESSION, label: "chapa", revision: 3, windows: [{ window_id: WINDOW, label: "[chapa]", layers: [{ layer_id: "layer:1", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: blockIds.map((id) => ({ block_id: id, host_id: "host-1" })) }] }], ...extra };
}

const createdJson = { session_id: SESSION, initial_windows: [{ window_id: WINDOW, block_ids: [1, 2, 3, 4, 5].map(blockId), revision: 1 }] };

function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; }, sleeps, advance: (ms: number) => { now += ms; } };
}

function ctxFor(cli: RexCli, extra: Partial<CreateContext> = {}): CreateContext {
  return {
    cli,
    hostId: "host-1",
    newWindow: false,
    app: { discover: () => "/Applications/Rex Beta.app", open: vi.fn(() => true) },
    clock: fakeClock(),
    tokenTimeoutMs: 8000,
    clientTimeoutMs: 8000,
    intervalMs: 250,
    ...extra,
  };
}

beforeEach(() => {
  rmSync(STATUS_DIR, { recursive: true, force: true });
  mkdirSync(STATUS_DIR, { recursive: true });
  delete statusTestHooks.beforeLock;
});
afterEach(() => {
  delete statusTestHooks.beforeLock;
});

describe("readPaneFile / readPaneMapping / waitForToken", () => {
  it("reads two validated lines, reports absent and malformed, and never deletes a .tmp", () => {
    const paths = launchArtifactPaths("chapa", ID);
    expect(readPaneFile(paths.pane("editor").file)).toBe("absent");
    writePane(ID, "editor", SESSION, blockId(1), { tmp: true });
    expect(readPaneFile(paths.pane("editor").file)).toBe("absent");
    expect(existsSync(paths.pane("editor").tmp)).toBe(true);
    writePane(ID, "editor", SESSION, blockId(1));
    expect(readPaneFile(paths.pane("editor").file)).toEqual({ sessionId: SESSION, blockId: blockId(1) });
    writePane(ID, "shell", SESSION, blockId(2), { raw: "garbage\n" });
    expect(readPaneFile(paths.pane("shell").file)).toBe("malformed");
    writePane(ID, "sidebar", "session:nope", blockId(3), { raw: `${SESSION}\n` });
    expect(readPaneFile(paths.pane("sidebar").file)).toBe("malformed");
  });

  it("maps pane names to their own block ids and classifies missing, malformed and foreign files", () => {
    const manifest = manifestFor();
    writePane(ID, "editor", SESSION, blockId(1));
    writePane(ID, "shell", SESSION, blockId(4));
    writePane(ID, "sidebar", "session:0000bbbb-0000-0000-0000-000000000009", blockId(5));
    writePane(ID, "right-1", SESSION, blockId(3), { raw: "x" });
    const mapping = readPaneMapping(manifest, SESSION);
    expect([...mapping.blocks]).toEqual([["editor", blockId(1)], ["shell", blockId(4)]]);
    expect(mapping.missing).toEqual(["editor-2"]);
    expect(mapping.malformed).toEqual(["right-1"]);
    expect(mapping.foreign).toEqual(["sidebar"]);
  });

  it("waits for the root pane file with the injected clock and gives up at the deadline", async () => {
    const paths = launchArtifactPaths("chapa", ID);
    const clock = fakeClock();
    const later = waitForToken(paths, "editor", { timeoutMs: 8000, intervalMs: 250, clock });
    const pending = await Promise.race([later.then(() => "done"), Promise.resolve("pending")]);
    expect(pending).toBe("pending");
    writePane(ID, "editor", SESSION, blockId(1));
    expect(await later).toEqual({ sessionId: SESSION, blockId: blockId(1) });
    const gaveUp = await waitForToken(paths, "shell", { timeoutMs: 1000, intervalMs: 250, clock });
    expect(gaveUp).toBe("absent");
  });
});

describe("createWorkspace", () => {
  it("writes the manifest before session.create, maps block_ids through paneOrder and selects in the newest app", async () => {
    const order: string[] = [];
    const cli = fakeCli({
      "ls": () => ok("ls", { sessions: [] }),
      "session-create": (_argv, input) => {
        order.push(`create:${existsSync(launchArtifactPaths("chapa", ID).manifest)}`);
        expect(JSON.parse(input!)).toEqual(fullBuild().request);
        return ok("session-create", createdJson);
      },
      "client-ls": () => ok("client-ls", { clients: [CLIENT, { ...CLIENT, client_id: "client:older", connected_at: "2026-10-29T07:00:00Z" }] }),
      "do-select": () => ok("do-select", {}),
    });
    const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
    expect(order).toEqual(["create:true"]);
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.clientId).toBe("client:app");
    expect(outcome.ids).toEqual({
      sessionId: SESSION,
      windowId: WINDOW,
      rootBlockId: blockId(1),
      hostId: "host-1",
      blocks: [
        { name: "editor", blockId: blockId(1), label: "editor · vim" },
        { name: "editor-2", blockId: blockId(2), label: "editor · vim" },
        { name: "right-1", blockId: blockId(3), label: "editor · vim" },
        { name: "shell", blockId: blockId(4), label: "shell" },
        { name: "sidebar", blockId: blockId(5), label: "sidebar · lazygit" },
      ],
      unverified: [],
    });
    expect(outcome.notices).toEqual(["Several Rex apps are connected; using Studio (client:app), not client:older"]);
    const create = cli.calls.find((c) => c.op === "session-create")!;
    expect(create).toMatchObject({ argv: ["api", "call", "session.create", "-"], timeoutMs: 10_000, autostart: true });
    const select = cli.calls.find((c) => c.op === "do-select")!;
    expect(select.argv).toEqual(["-C", "client:app", "do", "session.select", `session_id=${SESSION}`, `window_id=${WINDOW}`, "--json"]);
    expect(cli.calls.map((c) => c.op)).toEqual(["ls", "session-create", "client-ls", "do-select"]);
    expect(readStatusRecord("chapa")).toBeNull();
  });

  it("records only the display panes from a creation answer", async () => {
    const manifest = manifestFor(ID, { panes: ["editor"], paneOrder: ["editor", "sidebar"], blockLabels: { editor: "editor · vim", sidebar: "sidebar" } });
    const answer = { session_id: SESSION, initial_windows: [{ window_id: WINDOW, block_ids: [blockId(1), blockId(2)], revision: 1 }] };
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-create": () => ok("session-create", answer), "client-ls": () => ok("client-ls", { clients: [CLIENT] }), "do-select": () => ok("do-select", {}) });
    const outcome = await createWorkspace(manifest, fullBuild().request, ctxFor(cli));
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.ids.blocks).toEqual([{ name: "editor", blockId: blockId(1), label: "editor · vim" }]);
    expect(outcome.ids.rootBlockId).toBe(blockId(1));
  });

  it("inside Rex it prefers the app attached to the caller's session from one listing", async () => {
    const attached = { ...CLIENT, client_id: "client:attached", connected_at: "2026-10-29T07:00:00Z", session_ids: ["session:caller"] };
    const cli = fakeCli({
      "ls": () => ok("ls", { sessions: [] }),
      "session-create": () => ok("session-create", createdJson),
      "client-ls": () => ok("client-ls", { clients: [CLIENT, attached] }),
      "do-select": () => ok("do-select", {}),
    });
    const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli, { callerSession: "session:caller" }));
    expect(outcome).toMatchObject({ kind: "created", clientId: "client:attached", notices: [] });
    expect(cli.calls.filter((c) => c.op === "client-ls").map((c) => JSON.parse(c.input!))).toEqual([{ kinds: ["app"] }]);
  });

  it("--new-window creates the session, selects it in the current window and says so (P9 fallback); no client.window.new", async () => {
    const cli = fakeCli({
      "ls": () => ok("ls", { sessions: [] }),
      "session-create": () => ok("session-create", createdJson),
      "client-ls": () => ok("client-ls", { clients: [CLIENT] }),
      "do-select": () => ok("do-select", {}),
    });
    const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli, { newWindow: true }));
    expect(outcome.kind).toBe("created");
    expect(cli.calls.map((c) => c.op)).toEqual(["ls", "session-create", "client-ls", "do-select"]);
    expect(outcome.notices).toEqual(["Rex shows [chapa] in the current window; --new-window opens a new session, not a new window"]);
  });

  it("a rejected create is failed with the server's reason and creates nothing further", async () => {
    const cli = fakeCli({
      "ls": () => ok("ls", { sessions: [] }),
      "session-create": () => fail("session-create", "rejected", "rolled-back", "bad_request: layout: split needs before and after"),
    });
    const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
    expect(outcome).toMatchObject({ kind: "failed", reason: "bad_request: layout: split needs before and after" });
    expect(cli.calls.map((c) => c.op)).toEqual(["ls", "session-create"]);
  });

  it("an unreachable server (outcome none) is failed with the hint", async () => {
    const cli = fakeCli({
      "ls": () => fail("ls", "unreachable", "none"),
      "session-create": () => ({ ...fail("session-create", "unreachable", "none", "dial unix: connect: no such file"), hint: "Open the Rex app and retry, or run summon doctor." }),
    });
    const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
    expect(outcome).toMatchObject({ kind: "failed", reason: "dial unix: connect: no such file", failure: { hint: "Open the Rex app and retry, or run summon doctor." } });
  });

  describe("unknown outcome and the token", () => {
    const timeoutCreate = () => fail("session-create", "timeout", "unknown", "rex did not answer in time");

    it("adopts the session from the pane files (scrambled order, scrambled view labels) and never trusts position", async () => {
      // Pane files map names to blocks in an order that differs from paneOrder and from block_ids.
      writePane(ID, "sidebar", SESSION, blockId(1));
      writePane(ID, "shell", SESSION, blockId(2));
      writePane(ID, "editor", SESSION, blockId(3));
      writePane(ID, "right-1", SESSION, blockId(4));
      writePane(ID, "editor-2", SESSION, blockId(5));
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": timeoutCreate,
        "session-view": () => ok("session-view", viewJson([5, 4, 3, 2, 1].map(blockId))),
        "client-ls": () => ok("client-ls", { clients: [CLIENT] }),
        "do-select": () => ok("do-select", {}),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") return;
      expect(outcome.ids.rootBlockId).toBe(blockId(3));
      expect(outcome.ids.windowId).toBe(WINDOW);
      expect(Object.fromEntries(outcome.ids.blocks.map((b) => [b.name, b.blockId]))).toEqual({ sidebar: blockId(1), shell: blockId(2), editor: blockId(3), "right-1": blockId(4), "editor-2": blockId(5) });
      expect(outcome.ids.unverified).toEqual([]);
      expect(cli.calls.find((c) => c.op === "session-view")!.input).toBe(JSON.stringify({ session_id: SESSION }));
    });

    it("a missing pane file leaves that pane unverified; keeps known ids even when their block is already absent from the view", async () => {
      writePane(ID, "editor", SESSION, blockId(1));
      writePane(ID, "sidebar", SESSION, blockId(5));
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": timeoutCreate,
        "session-view": () => ok("session-view", viewJson([blockId(5)])), // root block already closed
        "client-ls": () => ok("client-ls", { clients: [CLIENT] }),
        "do-select": () => ok("do-select", {}),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") return;
      expect(outcome.ids.rootBlockId).toBe(blockId(1));
      expect(outcome.ids.blocks.map((b) => b.name)).toEqual(["editor", "sidebar"]);
      expect(outcome.ids.unverified).toEqual(["editor-2", "right-1", "shell"]);
      expect(outcome.notices).toContain("3 panes are unverified (editor-2, right-1, shell); their files had not appeared yet");
    });

    it("all pane-file blocks already absent from the view is still adopted with every known id (liveness classifies it)", async () => {
      writePane(ID, "editor", SESSION, blockId(1));
      writePane(ID, "sidebar", SESSION, blockId(5));
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": timeoutCreate,
        "session-view": () => ok("session-view", viewJson(["block:0000aaaa-0000-0000-0000-000000000099"])),
        "client-ls": () => ok("client-ls", { clients: [CLIENT] }),
        "do-select": () => ok("do-select", {}),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome.kind).toBe("created");
      if (outcome.kind !== "created") return;
      expect(outcome.ids.blocks.map((b) => b.blockId)).toEqual([blockId(1), blockId(5)]);
      expect(outcome.ids.windowId).toBe(WINDOW);
    });

    it("no token within the deadline is unknown, listing the sessions that appeared since the pre-create listing", async () => {
      const cli = fakeCli({
        "ls": (_argv, _input, nth) => ok("ls", { sessions: nth === 1 ? [{ session_id: "session:old", label: "chapa" }] : [{ session_id: "session:old", label: "chapa" }, { session_id: SESSION, label: "chapa" }, { session_id: "session:other", label: "other" }] }),
        "session-create": timeoutCreate,
      });
      const clock = fakeClock();
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli, { clock }));
      expect(outcome).toEqual({ kind: "unknown", reason: "rex did not answer in time; no pane file confirmed the session within 8 s", candidates: [SESSION], notices: [] });
      expect(clock.sleeps.length).toBeGreaterThan(0);
      expect(existsSync(launchArtifactPaths("chapa", ID).manifest)).toBe(true);
    });

    it("a .tmp-only token is absent and is not deleted; a failed pre-create listing leaves candidates unlisted", async () => {
      writePane(ID, "editor", SESSION, blockId(1), { tmp: true });
      const cli = fakeCli({ "ls": () => fail("ls", "failed", "none"), "session-create": timeoutCreate });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome).toMatchObject({ kind: "unknown", candidates: "unlisted" });
      expect(existsSync(launchArtifactPaths("chapa", ID).pane("editor").tmp)).toBe(true);
    });

    it("a token naming a session with another label or window label is unknown", async () => {
      writePane(ID, "editor", SESSION, blockId(1));
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": timeoutCreate,
        "session-view": () => ok("session-view", viewJson([blockId(1)], { label: "someone-else" })),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome).toMatchObject({ kind: "unknown", reason: expect.stringContaining("token named an unexpected session") });
    });

    it("a foreign or malformed pane file beside the token is unknown", async () => {
      writePane(ID, "editor", SESSION, blockId(1));
      writePane(ID, "shell", "session:0000bbbb-0000-0000-0000-000000000009", blockId(2));
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": timeoutCreate,
        "session-view": () => ok("session-view", viewJson([blockId(1), blockId(2)])),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome).toMatchObject({ kind: "unknown", reason: expect.stringContaining("pane files do not belong to the confirmed session") });
    });

    it("a view failure after the token is unknown", async () => {
      writePane(ID, "editor", SESSION, blockId(1));
      const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-create": timeoutCreate, "session-view": () => fail("session-view", "unreachable", "none") });
      expect(await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli))).toMatchObject({ kind: "unknown" });
    });

    it("a create answer with the wrong block count goes through the token path instead of trusting positions", async () => {
      writePane(ID, "editor", SESSION, blockId(1));
      writePane(ID, "editor-2", SESSION, blockId(2));
      writePane(ID, "right-1", SESSION, blockId(3));
      writePane(ID, "shell", SESSION, blockId(4));
      writePane(ID, "sidebar", SESSION, blockId(5));
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": () => ok("session-create", { session_id: SESSION, initial_windows: [{ window_id: WINDOW, block_ids: [blockId(1), blockId(2)], revision: 1 }] }),
        "session-view": () => ok("session-view", viewJson([1, 2, 3, 4, 5].map(blockId))),
        "client-ls": () => ok("client-ls", { clients: [CLIENT] }),
        "do-select": () => ok("do-select", {}),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
      expect(outcome.kind).toBe("created");
      expect(cli.calls.map((c) => c.op)).toContain("session-view");
    });
  });

  describe("client selection", () => {
    const created = () => ok("session-create", createdJson);

    it("opens the app when no client is connected and selects once one appears", async () => {
      const open = vi.fn(() => true);
      const cli = fakeCli({
        "ls": () => ok("ls", { sessions: [] }),
        "session-create": created,
        "client-ls": (_argv, _input, nth) => ok("client-ls", { clients: nth >= 3 ? [CLIENT] : [] }),
        "do-select": () => ok("do-select", {}),
      });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli, { app: { discover: () => "/Applications/Rex Beta.app", open } }));
      expect(outcome.kind).toBe("created");
      expect(open).toHaveBeenCalledWith("/Applications/Rex Beta.app");
    });

    it("is created-unselected when no client appears in time, when the app bundle is missing, or when select fails", async () => {
      const noClient = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-create": created, "client-ls": () => ok("client-ls", { clients: [] }) });
      const outcome = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(noClient));
      expect(outcome).toMatchObject({ kind: "created-unselected", notices: [expect.stringContaining("no Rex app is connected")] });

      const noBundle = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-create": created, "client-ls": () => ok("client-ls", { clients: [] }) });
      const outcome2 = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(noBundle, { app: { discover: () => null, open: vi.fn(() => true) } }));
      expect(outcome2.kind).toBe("created-unselected");
      expect(noBundle.calls.filter((c) => c.op === "client-ls").length).toBe(1);

      const selectFails = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-create": created, "client-ls": () => ok("client-ls", { clients: [CLIENT] }), "do-select": () => fail("do-select", "failed", "unknown", "select exploded") });
      const outcome3 = await createWorkspace(manifestFor(), fullBuild().request, ctxFor(selectFails));
      expect(outcome3).toMatchObject({ kind: "created-unselected", notices: [expect.stringContaining("select exploded")] });
      if (outcome3.kind === "created-unselected") expect(outcome3.ids.sessionId).toBe(SESSION);
    });
  });
});

describe("selectInApp", () => {
  it("omits window_id when none is given", () => {
    const cli = fakeCli({ "do-select": () => ok("do-select", {}) });
    selectInApp(cli, "client:app", SESSION);
    expect(cli.calls[0]!.argv).toEqual(["-C", "client:app", "do", "session.select", `session_id=${SESSION}`, "--json"]);
  });
});

// --- adoptOrphans / refreshPaneMapping ---

function recordFor(launchId: string, overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    project: "chapa", directory: "/Users/me/code/chapa", pid: 1, startedAt: "2026-10-29T09:00:00.000Z", layout: "full",
    panes: ["editor", "sidebar", "editor-2", "right-1", "shell"], source: "summon", version: 1, launchId, backend: "rex",
    rex: { server: SERVER, hostId: "host-1", sessionId: "session:0000cccc-0000-0000-0000-000000000001", windowId: "window:0000cccc-0000-0000-0000-000000000002", rootBlockId: blockId(9), blocks: [{ name: "editor", blockId: blockId(9), label: "editor · vim" }] },
    ...overrides,
  };
}

function depsFor(clis: Record<string, RexCli>, extra: Partial<AdoptDeps> = {}): AdoptDeps {
  return {
    cliFor: (server) => {
      const cli = clis[server];
      if (!cli) throw new Error(`no cli for ${server}`);
      return cli;
    },
    ghosttyState: () => "stopped",
    ...extra,
  };
}

describe("adoptOrphans (plan P13 late adoption)", () => {
  const liveView = (ids: string[]) => ok("session-view", viewJson(ids));

  it("adopts a confirmed orphan when no record exists, mapping panes from their own files", async () => {
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    writePane(ID, "sidebar", SESSION, blockId(5));
    const cli = fakeCli({
      "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] }),
      "session-view": () => liveView([blockId(1), blockId(5)]),
    });
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }));
    expect(notices).toEqual([`adopted earlier launch ${ID} of chapa (Rex session ${SESSION})`]);
    const record = readStatusRecord("chapa");
    expect(record).toMatchObject({ project: "chapa", launchId: ID, backend: "rex", layout: "full", panes: ["editor", "sidebar", "editor-2", "right-1", "shell"], directory: "/Users/me/code/chapa", startedAt: "2026-10-29T10:00:00.000Z" });
    expect(record!.rex).toEqual({ server: SERVER, hostId: "host-1", sessionId: SESSION, windowId: WINDOW, rootBlockId: blockId(1), blocks: [{ name: "editor", blockId: blockId(1), label: "editor · vim" }, { name: "sidebar", blockId: blockId(5), label: "sidebar · lazygit" }] });
    expect(cli.calls.every((c) => c.server === SERVER)).toBe(true);
  });

  it("adopts a session whose root block already closed; liveness will show it partial", async () => {
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    writePane(ID, "sidebar", SESSION, blockId(5));
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] }), "session-view": () => liveView([blockId(5)]) });
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }));
    expect(notices[0]).toContain("adopted earlier launch");
    expect(readStatusRecord("chapa")!.rex!.rootBlockId).toBe(blockId(1));
  });

  it("removes the files of an orphan whose session is gone, under the lock", async () => {
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const paths = launchArtifactPaths("chapa", ID);
    writeFileSync(paths.pid, "1\n");
    writeFileSync(paths.active, `${ID}\n`);
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-view": () => fail("session-view", "not-found", "none", "session not found") });
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }));
    expect(notices).toEqual([`removed the files of earlier launch ${ID} (its Rex session is gone)`]);
    expect(existsSync(paths.manifest)).toBe(false);
    expect(existsSync(paths.pane("editor").file)).toBe(false);
    expect(existsSync(paths.pid)).toBe(false);
    expect(existsSync(paths.active)).toBe(false);
    expect(readStatusRecord("chapa")).toBeNull();
  });

  it("reports a removal that failed instead of claiming it, keeps the manifest, and removes everything on the retry", async () => {
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const paths = launchArtifactPaths("chapa", ID);
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }) });
    chmodSync(paths.dir, 0o500);
    let notices: string[];
    try {
      notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }));
    } finally {
      chmodSync(paths.dir, 0o700);
    }
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(new RegExp(`^could not remove the files of earlier launch ${ID} \\(its Rex session is gone\\): .*; summon clean --orphans names it$`));
    expect(existsSync(paths.manifest)).toBe(true);
    expect(existsSync(paths.pane("editor").file)).toBe(true);
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }))).toEqual([`removed the files of earlier launch ${ID} (its Rex session is gone)`]);
    expect(existsSync(paths.manifest)).toBe(false);
    expect(existsSync(paths.pane("editor").file)).toBe(false);
  });

  it("keeps the files when the record changed between the read and the lock (superseded)", async () => {
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }) });
    statusTestHooks.beforeLock = () => { writeFileSync(join(STATUS_DIR, "chapa.json"), JSON.stringify(recordFor(ID2))); };
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }));
    expect(notices).toEqual(["another launch of chapa published meanwhile; nothing adopted or removed"]);
    expect(existsSync(launchArtifactPaths("chapa", ID).manifest)).toBe(true);
  });

  it("abstains entirely when the current record's state is unknown", async () => {
    withOwnedRecord("chapa", "replace", () => recordFor(ID2));
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const cli = fakeCli({ "ls": () => fail("ls", "unreachable", "none", "server unreachable") });
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }));
    expect(notices).toEqual(["chapa could not be verified on unix:///mock/server.sock: server unreachable; nothing adopted or removed"]);
    expect(cli.calls.map((c) => c.op)).toEqual(["ls"]);
    expect(existsSync(launchArtifactPaths("chapa", ID).manifest)).toBe(true);
  });

  it("abstains for the whole call when any orphan lookup is unknown, even if another orphan is adoptable", async () => {
    writeLaunchManifest(manifestFor(ID, { startedAt: "2026-10-29T10:00:00.000Z" }));
    writePane(ID, "editor", SESSION, blockId(1));
    const otherServer = "unix:///other/server.sock";
    writeLaunchManifest(manifestFor(ID2, { server: otherServer, startedAt: "2026-10-29T11:00:00.000Z" }));
    writePane(ID2, "editor", "session:0000dddd-0000-0000-0000-000000000001", blockId(7));
    const good = fakeCli({ "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] }), "session-view": () => liveView([blockId(1)]) });
    const bad = fakeCli({ "ls": () => fail("ls", "unreachable", "none", "no socket") }, otherServer);
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: good, [otherServer]: bad }));
    expect(notices).toEqual([`earlier launch ${ID2} could not be verified on ${otherServer}: no socket; nothing adopted or removed`]);
    expect(readStatusRecord("chapa")).toBeNull();
    expect(existsSync(launchArtifactPaths("chapa", ID).manifest)).toBe(true);
  });

  it("records only display panes on adoption, so the published identity survives the record parser", async () => {
    // A command-less sidebar is in paneOrder (it has a block) but not in panes (it has no name).
    writeLaunchManifest(manifestFor(ID, { panes: ["editor"], paneOrder: ["editor", "sidebar"], blockLabels: { editor: "editor · vim", sidebar: "sidebar" } }));
    writePane(ID, "editor", SESSION, blockId(1));
    writePane(ID, "sidebar", SESSION, blockId(2));
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] }), "session-view": () => liveView([blockId(1), blockId(2)]) });
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }))).toEqual([`adopted earlier launch ${ID} of chapa (Rex session ${SESSION})`]);
    const record = readStatusRecord("chapa")!;
    expect(record.rex).toBeDefined();
    expect(record.rex!.blocks).toEqual([{ name: "editor", blockId: blockId(1), label: "editor · vim" }]);
  });

  it("refuses a Rex record without identity before any lookup (defense in depth against reader recursion)", async () => {
    withOwnedRecord("chapa", "replace", () => { const r = recordFor(ID2); delete r.rex; return r; });
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const cli = fakeCli({});
    const ghosttyState = vi.fn(() => "stopped" as const);
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }, { ghosttyState }))).toEqual(["chapa record has no Rex identity; nothing adopted or removed"]);
    expect(cli.calls).toEqual([]);
    expect(ghosttyState).not.toHaveBeenCalled();
  });

  it("abstains with a notice when a legacy record (no launchId) is present", async () => {
    withOwnedRecord("chapa", "replace", () => { const r = recordFor(ID); delete r.launchId; delete r.backend; delete r.rex; return r; });
    writeLaunchManifest(manifestFor());
    const cli = fakeCli({});
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }))).toEqual(["chapa has a record from an older Summon; run summon chapa to replace it"]);
    expect(cli.calls).toEqual([]);
  });

  it("reports an absent token, a malformed pane file and a foreign pane file without touching them", async () => {
    writeLaunchManifest(manifestFor());
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }) });
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }))).toEqual([`earlier launch ${ID} of chapa never confirmed its session; summon clean --orphans names it`]);

    writePane(ID, "editor", SESSION, blockId(1), { raw: "half" });
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }))).toEqual([`earlier launch ${ID} of chapa left an unreadable pane file (editor); summon clean --orphans names it`]);

    writePane(ID, "editor", SESSION, blockId(1));
    writePane(ID, "shell", "session:0000bbbb-0000-0000-0000-000000000009", blockId(2));
    const live = fakeCli({ "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] }), "session-view": () => liveView([blockId(1)]) });
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: live }))).toEqual([`earlier launch ${ID} of chapa has pane files that do not belong to its session (shell); summon clean --orphans names it`]);
    expect(readStatusRecord("chapa")).toBeNull();
    expect(existsSync(launchArtifactPaths("chapa", ID).pane("shell").file)).toBe(true);
  });

  it("reports an extra live session while another record is live, and adopts only the first of two adoptable orphans", async () => {
    withOwnedRecord("chapa", "replace", () => recordFor(ID2));
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const cli = fakeCli({
      "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }, { session_id: "session:0000cccc-0000-0000-0000-000000000001", label: "chapa" }] }),
      "session-view": (_argv, input) => (JSON.parse(input!).session_id === SESSION ? liveView([blockId(1)]) : ok("session-view", { ...viewJson([blockId(9)]), session_id: "session:0000cccc-0000-0000-0000-000000000001", windows: [{ window_id: "window:0000cccc-0000-0000-0000-000000000002", label: "[chapa]", layers: [{ layer_id: "l", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: [{ block_id: blockId(9) }] }] }] })),
    });
    expect(adoptOrphans("chapa", depsFor({ [SERVER]: cli }))).toEqual([`extra Rex session [chapa] ${SESSION} from earlier launch ${ID}; rex kill ${SESSION} closes it`]);
    expect(readStatusRecord("chapa")!.launchId).toBe(ID2);

    // Two adoptable orphans, no live record: the oldest is adopted, the newer is reported as extra.
    rmSync(join(STATUS_DIR, "chapa.json"));
    const session2 = "session:0000eeee-0000-0000-0000-000000000001";
    writeLaunchManifest(manifestFor(ID2, { startedAt: "2026-10-29T11:00:00.000Z" }));
    writePane(ID2, "editor", session2, blockId(6));
    const cli2 = fakeCli({
      "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }, { session_id: session2, label: "chapa" }] }),
      "session-view": (_argv, input) => (JSON.parse(input!).session_id === SESSION ? liveView([blockId(1)]) : ok("session-view", { ...viewJson([blockId(6)]), session_id: session2 })),
    });
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli2 }));
    expect(notices).toEqual([
      `adopted earlier launch ${ID} of chapa (Rex session ${SESSION})`,
      `extra Rex session [chapa] ${session2} from earlier launch ${ID2}; rex kill ${session2} closes it`,
    ]);
    expect(readStatusRecord("chapa")!.launchId).toBe(ID);
  });

  it("treats a live Ghostty record like any live record (the orphan is reported, not adopted)", async () => {
    withOwnedRecord("chapa", "replace", () => { const r = recordFor(ID2); delete r.backend; delete r.rex; return r; });
    writeLaunchManifest(manifestFor());
    writePane(ID, "editor", SESSION, blockId(1));
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] }), "session-view": () => liveView([blockId(1)]) });
    const notices = adoptOrphans("chapa", depsFor({ [SERVER]: cli }, { ghosttyState: () => "active" }));
    expect(notices[0]).toContain("extra Rex session");
  });
});

describe("refreshPaneMapping", () => {
  it("fills in delayed pane files for the current generation under the lock and ignores a changed generation", () => {
    writeLaunchManifest(manifestFor());
    const record = recordFor(ID, { rex: { server: SERVER, hostId: "host-1", sessionId: SESSION, windowId: WINDOW, rootBlockId: blockId(1), blocks: [{ name: "editor", blockId: blockId(1), label: "editor · vim" }] } });
    withOwnedRecord("chapa", "replace", () => record);
    expect(refreshPaneMapping(record)).toEqual({ notices: [], changed: false });
    writePane(ID, "shell", SESSION, blockId(4));
    writePane(ID, "right-1", SESSION, blockId(3), { raw: "nope" });
    writePane(ID, "sidebar", "session:0000bbbb-0000-0000-0000-000000000009", blockId(5));
    const { notices, changed } = refreshPaneMapping(record);
    expect(changed).toBe(true);
    expect(notices).toEqual(["pane sidebar of chapa has a pane file from another session; summon clean --orphans names it", "pane right-1 of chapa has an unreadable pane file; summon clean --orphans names it"]);
    const refreshed = readStatusRecord("chapa")!;
    expect(refreshed.rex!.blocks).toEqual([{ name: "editor", blockId: blockId(1), label: "editor · vim" }, { name: "shell", blockId: blockId(4), label: "shell" }]);

    // Generation changed meanwhile: nothing written.
    withOwnedRecord("chapa", "replace", () => recordFor(ID2));
    writePane(ID, "editor-2", SESSION, blockId(2));
    // Defective files are still reported; nothing is written, but the caller is told the record moved on.
    expect(refreshPaneMapping(record)).toEqual({ notices, changed: true });
    expect(readStatusRecord("chapa")!.launchId).toBe(ID2);
    expect(readStatusRecord("chapa")!.rex!.blocks.map((b) => b.name)).toEqual(["editor"]);
  });

  it("does nothing for a record without unverified panes or without a Rex identity", () => {
    const complete = recordFor(ID, { panes: ["editor"] });
    expect(refreshPaneMapping(complete)).toEqual({ notices: [], changed: false });
    const ghostty = recordFor(ID); delete ghostty.rex;
    expect(refreshPaneMapping(ghostty)).toEqual({ notices: [], changed: false });
  });
});

describe("artifacts", () => {
  it("the manifest written by createWorkspace is readable through listLaunchManifests", async () => {
    const cli = fakeCli({ "ls": () => ok("ls", { sessions: [] }), "session-create": () => fail("session-create", "rejected", "rolled-back", "nope") });
    await createWorkspace(manifestFor(), fullBuild().request, ctxFor(cli));
    expect(listLaunchManifests("chapa").map((m) => m.launchId)).toEqual([ID]);
    expect(JSON.parse(readFileSync(launchArtifactPaths("chapa", ID).manifest, "utf-8")).server).toBe(SERVER);
  });
});

describe("maybeSwitchToExisting (plan P2) and showWorkspace", () => {
  const liveRecord = () => recordFor(ID, { rex: { server: SERVER, hostId: "host-1", sessionId: SESSION, windowId: WINDOW, rootBlockId: blockId(1), blocks: [{ name: "editor", blockId: blockId(1), label: "editor · vim" }, { name: "sidebar", blockId: blockId(5), label: "sidebar · lazygit" }] } });
  const lsPresent = () => ok("ls", { sessions: [{ session_id: SESSION, label: "chapa" }] });
  let stderrText = "";
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { stderrText = ""; errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { stderrText += String(chunk); return true; }); });
  afterEach(() => { errSpy.mockRestore(); });

  it("proceeds without any Rex call when there is no record, a Ghostty record, or --new-window", () => {
    const cli = fakeCli({});
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "proceed" });
    withOwnedRecord("chapa", "replace", () => { const r = recordFor(ID); delete r.backend; delete r.rex; return r; });
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "proceed" });
    withOwnedRecord("chapa", "replace", liveRecord);
    expect(maybeSwitchToExisting("chapa", true, { cliFor: () => cli })).toEqual({ kind: "proceed" });
    expect(cli.calls).toEqual([]);
  });

  it("a Rex record whose identity was discarded refuses an ordinary launch without a Rex call; --new-window proceeds", () => {
    withOwnedRecord("chapa", "replace", () => { const r = recordFor(ID); delete r.rex; return r; });
    const cli = fakeCli({});
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "refused", reason: "chapa is recorded in Rex but the record has no Rex identity; run summon chapa --new-window to relaunch" });
    expect(maybeSwitchToExisting("chapa", true, { cliFor: () => cli })).toEqual({ kind: "proceed" });
    expect(cli.calls).toEqual([]);
  });

  it("proceeds when the session is stopped and refuses with the reason when it cannot be verified", () => {
    withOwnedRecord("chapa", "replace", liveRecord);
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => fakeCli({ "ls": () => ok("ls", { sessions: [] }) }) })).toEqual({ kind: "proceed" });
    const refused = maybeSwitchToExisting("chapa", false, { cliFor: () => fakeCli({ "ls": () => fail("ls", "unreachable", "none", "no socket") }) });
    expect(refused).toEqual({ kind: "refused", reason: `chapa is recorded in Rex but could not be verified on ${SERVER}: no socket. Open the Rex app and retry, or run summon doctor.` });
  });

  it("switches to an active session: select in the newest app, no focus, one line", () => {
    withOwnedRecord("chapa", "replace", liveRecord);
    const cli = fakeCli({ "ls": lsPresent, "session-view": () => ok("session-view", viewJson([blockId(1), blockId(5)])), "client-ls": () => ok("client-ls", { clients: [CLIENT] }), "do-select": () => ok("do-select", {}) });
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "switched" });
    expect(cli.calls.map((c) => c.op)).toEqual(["ls", "session-view", "client-ls", "do-select"]);
    expect(cli.calls.find((c) => c.op === "do-select")!.argv).toEqual(["-C", "client:app", "do", "session.select", `session_id=${SESSION}`, `window_id=${WINDOW}`, "--json"]);
    expect(stderrText).toContain("Workspace [chapa] is already running in Rex; switched to it (use --new-window for a fresh one)");
  });

  it("reuse prefers the app attached to the caller's session over a newer unrelated app, with the several-apps notice (P7)", () => {
    withOwnedRecord("chapa", "replace", liveRecord);
    const attached = { client_id: "client:mine", connected_at: "2026-10-29T07:00:00Z", connection_state: "connected", info: { kind: "app", label: "Laptop" }, session_ids: ["session:caller"] };
    const cli = fakeCli({ "ls": lsPresent, "session-view": () => ok("session-view", viewJson([blockId(1), blockId(5)])), "client-ls": () => ok("client-ls", { clients: [CLIENT, attached] }), "do-select": () => ok("do-select", {}) });
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli, callerSession: "session:caller" })).toEqual({ kind: "switched" });
    expect(cli.calls.find((c) => c.op === "do-select")!.argv[1]).toBe("client:mine");
    expect(stderrText).not.toContain("Several Rex apps");
    // Without a caller session the newest app wins and the user is told which one.
    cli.calls.length = 0;
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "switched" });
    expect(cli.calls.find((c) => c.op === "do-select")!.argv[1]).toBe("client:app");
    expect(stderrText).toContain("summon: note: Several Rex apps are connected; using Studio (client:app), not client:mine");
    // showRecordedWorkspace carries the same preference.
    cli.calls.length = 0;
    expect(showWorkspace(cli, liveRecord(), [], "session:caller")).toEqual({ shown: true, clientId: "client:mine" });
  });

  it("a partial session focuses the first live pane before selecting", () => {
    withOwnedRecord("chapa", "replace", liveRecord);
    const cli = fakeCli({ "ls": lsPresent, "session-view": () => ok("session-view", viewJson([blockId(5)])), "client-ls": () => ok("client-ls", { clients: [CLIENT] }), "focus": () => ok("focus", {}), "do-select": () => ok("do-select", {}) });
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "switched" });
    expect(cli.calls.map((c) => c.op)).toEqual(["ls", "session-view", "client-ls", "focus", "do-select"]);
    expect(cli.calls.find((c) => c.op === "focus")!.argv).toEqual(["focus", "-s", SESSION, blockId(5)]);
  });

  it("fills in a delayed pane file before probing and says when the session could not be shown", () => {
    writeLaunchManifest(manifestFor());
    const record = liveRecord();
    record.rex!.blocks = [record.rex!.blocks[0]!];
    withOwnedRecord("chapa", "replace", () => record);
    writePane(ID, "shell", SESSION, blockId(4));
    const cli = fakeCli({ "ls": lsPresent, "session-view": () => ok("session-view", viewJson([blockId(1)])), "client-ls": () => ok("client-ls", { clients: [] }) });
    expect(maybeSwitchToExisting("chapa", false, { cliFor: () => cli })).toEqual({ kind: "switched" });
    expect(readStatusRecord("chapa")!.rex!.blocks.map((b) => b.name)).toEqual(["editor", "shell"]);
    expect(stderrText).toContain("Workspace [chapa] is already running in Rex but could not be shown (no Rex app is connected; open Rex and pick [chapa]); run summon open chapa");
    expect(stderrText).not.toContain("switched to it");
  });

  it("showWorkspace reports a failed select, and showRecordedWorkspace needs a Rex record", () => {
    const record = liveRecord();
    const failing = fakeCli({ "client-ls": () => ok("client-ls", { clients: [CLIENT] }), "do-select": () => fail("do-select", "failed", "unknown", "select exploded") });
    expect(showWorkspace(failing, record)).toEqual({ shown: false, reason: "select exploded" });
    const ghostty = recordFor(ID); delete ghostty.rex;
    expect(showWorkspace(failing, ghostty)).toEqual({ shown: false, reason: "the record has no Rex identity" });
    expect(showRecordedWorkspace("chapa", "/nonexistent/rex")).toEqual({ shown: false, reason: "chapa has no Rex record" });
    withOwnedRecord("chapa", "replace", liveRecord);
    // A missing binary surfaces as "no app connected": nothing is spawned beyond the ENOENT attempt.
    expect(showRecordedWorkspace("chapa", "/nonexistent/rex")).toEqual({ shown: false, reason: "no Rex app is connected; open Rex and pick [chapa]" });
  });
});
