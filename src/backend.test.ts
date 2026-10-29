import { describe, it, expect, vi } from "vitest";

const mockProbeWhoami = vi.hoisted(() => vi.fn((_binary: string, _server: string): unknown => ({ answers: false, reason: "no server" })));
vi.mock("./backends/rex/cli.js", async (original) => ({
  ...(await original<typeof import("./backends/rex/cli.js")>()),
  probeWhoami: (binary: string, server: string) => mockProbeWhoami(binary, server),
}));
const { resolveBackendForLaunch, resolveBackendForRecord, isBackendId } = await import("./backend.js");

const REX_BIN = "/fake/rex";
const SERVER = "unix:///tmp/rex.sock";

describe("resolveBackendForLaunch", () => {
  it("uses the injected probes and returns a Rex context inside Rex", () => {
    const context = resolveBackendForLaunch({
      env: { TERM_PROGRAM: "rex", REX_SERVER: SERVER },
      ghosttyInstalled: () => true,
      discoverRex: () => ({ path: REX_BIN, searched: ["PATH"] }),
      whoami: () => { throw new Error("whoami must not run when TERM_PROGRAM is present"); },
    });
    expect(context).toEqual({ ok: true, backend: "rex", placement: "inside-rex", server: SERVER, rexBinary: REX_BIN, notices: [] });
  });

  it("consults whoami only when TERM_PROGRAM is absent and REX_SERVER is set", () => {
    const asked: string[] = [];
    const context = resolveBackendForLaunch({
      env: { REX_SERVER: SERVER },
      ghosttyInstalled: () => true,
      discoverRex: () => ({ path: REX_BIN, searched: ["PATH"] }),
      whoami: (server) => { asked.push(server); return true; },
    });
    expect(asked).toEqual([SERVER]);
    expect(context).toMatchObject({ ok: true, backend: "rex", placement: "outside", server: SERVER });
  });

  it("validates an inherited REX_SERVER with rex whoami through the discovered binary (plan P5, Phase 3)", () => {
    mockProbeWhoami.mockReturnValue({ answers: true, hostId: "host-1" });
    let discoveries = 0;
    const context = resolveBackendForLaunch({
      env: { REX_SERVER: SERVER },
      ghosttyInstalled: () => true,
      discoverRex: () => { discoveries += 1; return { path: REX_BIN, searched: ["PATH"] }; },
    });
    expect(mockProbeWhoami).toHaveBeenCalledWith(REX_BIN, SERVER);
    expect(context).toMatchObject({ ok: true, backend: "rex", placement: "outside", server: SERVER, rexBinary: REX_BIN });
    expect(discoveries).toBe(1);
  });

  it("falls to the installed rules when whoami does not answer or no binary is found", () => {
    mockProbeWhoami.mockReturnValue({ answers: false, reason: "no server" });
    const silent = resolveBackendForLaunch({ env: { REX_SERVER: SERVER }, ghosttyInstalled: () => true, discoverRex: () => ({ path: REX_BIN, searched: ["PATH"] }) });
    expect(silent).toEqual({ ok: true, backend: "ghostty", placement: "outside", notices: [] });
    mockProbeWhoami.mockClear();
    const noBinary = resolveBackendForLaunch({ env: { REX_SERVER: SERVER }, ghosttyInstalled: () => true, discoverRex: () => ({ path: null, searched: ["PATH"] }) });
    expect(noBinary).toEqual({ ok: true, backend: "ghostty", placement: "outside", notices: [] });
    expect(mockProbeWhoami).not.toHaveBeenCalled();
  });

  it("returns a Ghostty context with the notice when Rex's CLI is missing", () => {
    const context = resolveBackendForLaunch({
      env: { TERM_PROGRAM: "rex" },
      ghosttyInstalled: () => true,
      discoverRex: () => ({ path: null, searched: ["PATH", "/a/rex"] }),
    });
    expect(context).toEqual({ ok: true, backend: "ghostty", placement: "inside-rex", notices: ["Rex detected but its CLI was not found at PATH, /a/rex"] });
  });

  it("returns a failed detection naming both terminals when neither is usable", () => {
    const result = resolveBackendForLaunch({
      env: { TERM_PROGRAM: "iTerm.app" },
      ghosttyInstalled: () => false,
      discoverRex: () => ({ path: null, searched: ["PATH"] }),
    });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("Neither Ghostty.app nor the Rex CLI was found") });
  });

  it("uses the default server socket when a rex-only machine launches from another terminal", () => {
    const context = resolveBackendForLaunch({
      env: { TERM_PROGRAM: "vscode" },
      ghosttyInstalled: () => false,
      discoverRex: () => ({ path: REX_BIN, searched: ["PATH"] }),
      defaultServer: "unix:///default.sock",
    });
    expect(context).toMatchObject({ ok: true, backend: "rex", server: "unix:///default.sock" });
  });

  it("derives the default server from the home directory when none is injected", () => {
    const context = resolveBackendForLaunch({
      env: { TERM_PROGRAM: "vscode" },
      ghosttyInstalled: () => false,
      discoverRex: () => ({ path: REX_BIN, searched: ["PATH"] }),
    });
    expect(context).toMatchObject({ ok: true, backend: "rex", server: expect.stringMatching(/^unix:\/\/.*\/rex\/server\.sock$/) });
  });
});

describe("resolveBackendForRecord (plan P6)", () => {
  it("treats a record without backend as Ghostty", () => {
    expect(resolveBackendForRecord({})).toEqual({ backend: "ghostty" });
  });

  it("returns the recorded Rex server", () => {
    expect(resolveBackendForRecord({ backend: "rex", rex: { server: SERVER, hostId: "h", sessionId: "session:x", windowId: "window:x", rootBlockId: "block:x", blocks: [] } }))
      .toEqual({ backend: "rex", server: SERVER });
  });

  it("returns rex without a server when the identity is missing", () => {
    expect(resolveBackendForRecord({ backend: "rex" })).toEqual({ backend: "rex" });
  });
});

describe("isBackendId", () => {
  it("accepts the two ids and nothing else", () => {
    expect(isBackendId("ghostty")).toBe(true);
    expect(isBackendId("rex")).toBe(true);
    expect(isBackendId("zsh")).toBe(false);
    expect(isBackendId(undefined)).toBe(false);
  });
});
