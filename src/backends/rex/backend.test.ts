import { describe, it, expect, vi } from "vitest";
import { createRexBackend, unknownOutcomeMessage, unreachableMessage } from "./backend.js";
import type { RexBackendDeps } from "./backend.js";
import { planLayout, getPreset } from "../../layout.js";
import { buildTreePlan, parseTreeDSL, resolveTreeCommands } from "../../tree.js";
import type { BackendLaunchContext } from "../ghostty.js";
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

  it("names only the display panes in the manifest (sidebar without a command stays in paneOrder) and forwards --new-window", async () => {
    const editorOnly = { ...IDS, blocks: [IDS.blocks[0]!] };
    const { d, create } = deps({ kind: "created-unselected", ids: editorOnly, notices: [] });
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
