import { afterEach, describe, it, expect, vi } from "vitest";
import { createRexBackend, unknownOutcomeMessage, unreachableMessage } from "./backend.js";
import type { RexBackendDeps } from "./backend.js";
import { planLayout, getPreset } from "../../layout.js";
import { buildTreePlan, parseTreeDSL, resolveTreeCommands } from "../../tree.js";
import type { BackendLaunchContext } from "../port.js";
import type { LaunchOutcome } from "./launch.js";

const CONTEXT = { ok: true as const, backend: "rex" as const, placement: "inside-rex" as const, server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] };
const ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const IDS = {
  sessionId: "session:0000aaaa-0000-0000-0000-000000000001",
  windowId: "window:0000aaaa-0000-0000-0000-000000000002",
  rootBlockId: "block:0000aaaa-0000-0000-0000-000000000010",
  hostId: "host-1",
  blocks: [
    { name: "editor", blockId: "block:0000aaaa-0000-0000-0000-000000000010", label: "editor · vim" },
    { name: "sidebar", blockId: "block:0000aaaa-0000-0000-0000-000000000011", label: "sidebar" },
  ],
  unverified: [],
};

function ctx(overrides: Partial<BackendLaunchContext> = {}): BackendLaunchContext {
  return {
    targetDir: "/tmp/x",
    envVars: { FOO: "bar" },
    projectName: "x",
    onStop: "echo bye",
    launchId: ID,
    layoutLabel: "minimal",
    ensureAndResolve: async (cmd) => cmd,
    resolveStarship: () => "/cfg/starship.toml",
    ...overrides,
  };
}

function deps(outcome: LaunchOutcome, extra: Partial<RexBackendDeps> = {}) {
  const create = vi.fn(async (..._args: unknown[]) => outcome);
  const cli = { binary: "/usr/local/bin/rex", server: CONTEXT.server, call: vi.fn() };
  const d: RexBackendDeps = {
    cliFor: vi.fn(() => cli),
    probeWhoami: vi.fn(() => ({ answers: true as const, hostId: "host-1" })),
    createWorkspace: create,
    app: { discover: () => null, open: () => false },
    callerSession: "session:caller",
    keptSession: vi.fn(() => undefined),
    ...extra,
  };
  return { d, create, cli };
}

describe("createRexBackend", () => {
  it("probes the server, writes a manifest with the display panes and hands the request to createWorkspace", async () => {
    const { d, create, cli } = deps({ kind: "created", ids: IDS, clientId: "client:app", notices: ["Several Rex apps are connected; using a"] });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const plan = planLayout({ editor: "vim", ...getPreset("minimal") });
    const result = await createRexBackend(CONTEXT, d).launchTraditional(plan, ctx());
    expect(d.probeWhoami).toHaveBeenCalledWith("/usr/local/bin/rex", "unix:///tmp/rex.sock");
    expect(d.cliFor).toHaveBeenCalledWith("/usr/local/bin/rex", "unix:///tmp/rex.sock");
    const [manifest, request, context] = create.mock.calls[0]! as unknown as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    expect(manifest).toMatchObject({ version: 1, launchId: ID, project: "x", directory: "/tmp/x", layout: "minimal", panes: ["editor", "sidebar"], paneOrder: ["editor", "sidebar"], backend: "rex", server: "unix:///tmp/rex.sock" });
    expect(manifest["blockLabels"]).toEqual({ editor: "editor · vim", sidebar: "sidebar · lazygit" });
    expect(request["label"]).toBe("x");
    expect(JSON.stringify(request)).toContain('--layout \\"minimal\\"');
    expect(JSON.stringify(request)).toContain("STARSHIP_CONFIG=/cfg/starship.toml");
    expect(context).toMatchObject({ cli, hostId: "host-1", callerSession: "session:caller", newWindow: false, app: d.app });
    expect(result).toEqual({ rex: { server: "unix:///tmp/rex.sock", hostId: "host-1", sessionId: IDS.sessionId, windowId: IDS.windowId, rootBlockId: IDS.rootBlockId, blocks: IDS.blocks } });
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("summon: note: Several Rex apps are connected");
    expect(outSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("Workspace [x] ready in Rex.");
    errSpy.mockRestore();
    outSpy.mockRestore();
  });

  it("UX-H1: a config new-window=true (plan.newWindow without the flag) is not --new-window under Rex: no notice, no kept-session lookup", async () => {
    const { d, create } = deps({ kind: "created", ids: IDS, clientId: "client:app", notices: [] });
    const plan = planLayout({ editor: "vim", ...getPreset("minimal") });
    plan.newWindow = true;
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createRexBackend(CONTEXT, d).launchTraditional(plan, ctx());
    outSpy.mockRestore();
    expect((create.mock.calls[0]! as unknown as [unknown, unknown, Record<string, unknown>])[2]["newWindow"]).toBe(false);
    expect(d.keptSession).not.toHaveBeenCalled();
  });

  it("names only the display panes in the manifest (sidebar without a command stays in paneOrder) and forwards --new-window", async () => {
    const editorOnly = { ...IDS, blocks: [IDS.blocks[0]!] };
    const { d, create } = deps({ kind: "created-unselected", ids: editorOnly, notices: [] }, { newWindow: true });
    const plan = planLayout({ editor: "vim", ...getPreset("minimal") });
    plan.sidebarCommand = "";
    plan.newWindow = true;
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await createRexBackend(CONTEXT, d).launchTraditional(plan, ctx());
    outSpy.mockRestore();
    // createWorkspace applies the display-pane policy to the ids; the adapter records them as given.
    expect(result?.rex?.blocks.map((b) => b.name)).toEqual(["editor"]);
    const [manifest, , context] = create.mock.calls[0]! as unknown as [Record<string, unknown>, unknown, Record<string, unknown>];
    expect(manifest["panes"]).toEqual(["editor"]);
    expect(manifest["paneOrder"]).toEqual(["editor", "sidebar"]);
    expect(context["newWindow"]).toBe(true);
  });

  it("--new-window says once, after the launch, that the earlier session stays open and records what it keeps; a plain launch never asks (F12)", async () => {
    const notice = "the earlier [x] session session:old stays open; summon x now switches to this one, and rex kill session:old closes the earlier one";
    const keptSession = vi.fn((_project: string, _cliFor: (server: string) => unknown, _listings?: unknown) => ({ notice, keeps: [ID] }));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = () => errSpy.mock.calls.map((c) => String(c[0])).join("");
    const plan = planLayout({ editor: "vim", ...getPreset("minimal") });
    const { d, cli, create } = deps({ kind: "created", ids: IDS, clientId: "client:app", notices: [] }, { keptSession });
    await createRexBackend(CONTEXT, d).launchTraditional(plan, ctx());
    expect(keptSession).not.toHaveBeenCalled();
    expect(create.mock.calls[0]![0]).not.toHaveProperty("keeps");
    plan.newWindow = true;
    // PE-L1: the launch's shared listing reaches the kept-session check (createWorkspace still lists for itself, P13).
    const listings = { of: vi.fn() };
    await createRexBackend(CONTEXT, { ...d, newWindow: true, listings }).launchTraditional(plan, ctx());
    expect(keptSession).toHaveBeenCalledWith("x", expect.any(Function), listings);
    expect(create.mock.calls[1]![2]).not.toHaveProperty("listings");
    expect(keptSession.mock.calls[0]![1]("unix:///other.sock")).toBe(cli);
    expect(d.cliFor).toHaveBeenLastCalledWith("/usr/local/bin/rex", "unix:///other.sock");
    expect(create.mock.calls[1]![0]).toMatchObject({ keeps: [ID] });
    expect(stderr()).toContain(`summon: note: ${notice}`);
    // Created but not shown is still a new session: the note stays.
    errSpy.mockClear();
    const unselected = deps({ kind: "created-unselected", ids: IDS, notices: [] }, { keptSession, newWindow: true });
    await createRexBackend(CONTEXT, unselected.d).launchTraditional(plan, ctx());
    expect(stderr()).toContain(notice);
    // A launch that fails or is unconfirmed says nothing about the earlier session.
    const failure = { ok: false as const, op: "session-create" as const, kind: "rejected" as const, outcome: "rolled-back" as const, reason: "boom", raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } };
    for (const outcome of [{ kind: "failed" as const, reason: "boom", failure, notices: [] }, { kind: "unknown" as const, reason: "timeout", candidates: [], notices: [] }]) {
      errSpy.mockClear();
      await expect(createRexBackend(CONTEXT, deps(outcome, { keptSession, newWindow: true }).d).launchTraditional(plan, ctx())).rejects.toThrow();
      expect(stderr()).not.toContain("stays open");
    }
    errSpy.mockRestore();
    outSpy.mockRestore();
  });

  describe("UX-M1: transient progress line", () => {
    const env = { NO_COLOR: process.env["NO_COLOR"], SUMMON_NO_SPINNER: process.env["SUMMON_NO_SPINNER"], FORCE_COLOR: process.env["FORCE_COLOR"] };
    const isTTY = process.stdout.isTTY;
    function setTTY(value: boolean): void {
      Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
      delete process.env["NO_COLOR"];
      delete process.env["SUMMON_NO_SPINNER"];
      delete process.env["FORCE_COLOR"];
    }
    afterEach(() => {
      Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
      for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    });
    function capture() {
      const out: string[] = [];
      const errs: string[] = [];
      const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { out.push(String(chunk)); return true; });
      const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { errs.push(String(chunk)); return true; });
      return { out, errs, restore: () => { outSpy.mockRestore(); errSpy.mockRestore(); } };
    }

    it("on a TTY shows Summoning <project>… on stdout during creation, updates it when the app opens, and clears it before the result", async () => {
      setTTY(true);
      const create = vi.fn(async (_m: unknown, _r: unknown, context: { progress?: (label: string) => void }) => {
        context.progress?.("Summoning x… opening the Rex app");
        return { kind: "created" as const, ids: IDS, clientId: "client:app", notices: ["Several Rex apps are connected; using a"] };
      });
      const { d } = deps({ kind: "created", ids: IDS, clientId: "client:app", notices: [] }, { createWorkspace: create as never });
      const io = capture();
      try {
        await createRexBackend(CONTEXT, d).launchTraditional(planLayout({ editor: "vim", ...getPreset("minimal") }), ctx());
      } finally {
        io.restore();
      }
      expect(io.out).toEqual(["⠋ Summoning x…", "\r\x1b[K⠋ Summoning x… opening the Rex app", "\r\x1b[K", "✓ Workspace [x] ready in Rex.\n"]);
      expect(io.errs.join("")).not.toContain("Summoning");
      expect(io.errs.join("")).toContain("summon: note: Several Rex apps are connected");
    });

    it("clears the line before a failure is thrown", async () => {
      setTTY(true);
      const failure = { ok: false as const, op: "session-create" as const, kind: "rejected" as const, outcome: "rolled-back" as const, reason: "boom", raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } };
      const { d } = deps({ kind: "failed", reason: "boom", failure, notices: [] });
      const io = capture();
      try {
        await expect(createRexBackend(CONTEXT, d).launchTraditional(planLayout({ editor: "vim" }), ctx())).rejects.toThrow("boom");
      } finally {
        io.restore();
      }
      expect(io.out).toEqual(["⠋ Summoning x…", "\r\x1b[K"]);
    });

    it("prints nothing extra when stdout is not a TTY", async () => {
      setTTY(false);
      const { d } = deps({ kind: "created", ids: IDS, clientId: "client:app", notices: [] });
      const io = capture();
      try {
        await createRexBackend(CONTEXT, d).launchTraditional(planLayout({ editor: "vim", ...getPreset("minimal") }), ctx());
      } finally {
        io.restore();
      }
      expect(io.out).toEqual(["✓ Workspace [x] ready in Rex.\n"]);
      expect(io.errs).toEqual([]);
    });
  });

  it("launches a tree layout with its leaves as panes", async () => {
    const { d, create } = deps({ kind: "created", ids: IDS, clientId: "client:app", notices: [] });
    const resolved = resolveTreeCommands(parseTreeDSL("a | b"), new Map([["a", "vim"], ["b", "htop"]]), undefined, "/tmp/x");
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createRexBackend(CONTEXT, d).launchTree(buildTreePlan(resolved), ctx({ layoutLabel: "custom" }));
    outSpy.mockRestore();
    expect((create.mock.calls[0]![0] as Record<string, unknown>)).toMatchObject({ layout: "custom", panes: ["a", "b"], paneOrder: ["a", "b"] });
  });

  it("fails before creating anything when the server does not answer", async () => {
    const { d, create } = deps({ kind: "created", ids: IDS, clientId: "c", notices: [] }, { probeWhoami: vi.fn(() => ({ answers: false as const, reason: "dial unix: no such file" })) });
    await expect(createRexBackend(CONTEXT, d).launchTraditional(planLayout({ editor: "vim" }), ctx())).rejects.toThrow(unreachableMessage("unix:///tmp/rex.sock", "dial unix: no such file"));
    expect(create).not.toHaveBeenCalled();
  });

  it("throws the server's reason plus the hint on failed, and the unknown message with candidates on unknown", async () => {
    const failure = { ok: false as const, op: "session-create" as const, kind: "rejected" as const, outcome: "rolled-back" as const, reason: "bad_request: nope", hint: "fix it", raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } };
    const { d } = deps({ kind: "failed", reason: "bad_request: nope", failure, notices: [] });
    await expect(createRexBackend(CONTEXT, d).launchTraditional(planLayout({ editor: "vim" }), ctx())).rejects.toThrow("bad_request: nope. fix it");

    const { d: d2 } = deps({ kind: "unknown", reason: "rex did not answer in time; no pane file", candidates: ["session:1"], notices: [] });
    await expect(createRexBackend(CONTEXT, d2).launchTraditional(planLayout({ editor: "vim" }), ctx())).rejects.toThrow(unknownOutcomeMessage("x", ["session:1"], "rex did not answer in time; no pane file"));
    expect(unknownOutcomeMessage("x", "unlisted", "r")).toContain("unknown (the session list could not be read)");
    expect(unknownOutcomeMessage("x", [], "r")).toContain("Sessions that appeared meanwhile: none.");
  });
});
