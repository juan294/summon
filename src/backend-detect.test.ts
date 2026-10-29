import { describe, it, expect } from "vitest";
import { detectBackend, snapshotEnv, NEITHER_TERMINAL_MSG } from "./backend-detect.js";
import type { DetectionInputs } from "./backend-detect.js";

const DEFAULT_SERVER = "unix:///Users/me/Library/Application%20Support/rex/server.sock";
const INHERITED_SERVER = "unix:///tmp/inherited.sock";
const REX_BIN = "/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex";

interface Row {
  env?: DetectionInputs["env"];
  ghosttyInstalled?: boolean;
  rexBinary?: string | null;
  rexSearched?: string[];
  whoamiAnswers?: boolean;
  defaultServer?: string;
}

/** Table rows as plain values; the probes become thunks the table may or may not call. */
function inputs(row: Row): DetectionInputs {
  return {
    env: row.env ?? {},
    ghosttyInstalled: () => row.ghosttyInstalled ?? false,
    rex: () => ({ path: row.rexBinary ?? null, searched: row.rexSearched ?? ["PATH", REX_BIN] }),
    whoamiAnswers: () => row.whoamiAnswers ?? false,
    defaultServer: row.defaultServer ?? DEFAULT_SERVER,
  };
}

describe("detectBackend (plan §3 detection table, P5)", () => {
  it("row: TERM_PROGRAM=rex with the rex binary -> rex, inside-rex, REX_SERVER when set", () => {
    const result = detectBackend(inputs({ env: { termProgram: "rex", rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, ghosttyInstalled: true }));
    expect(result).toEqual({ ok: true, backend: "rex", placement: "inside-rex", server: INHERITED_SERVER, rexBinary: REX_BIN, notices: [] });
  });

  it("row: TERM_PROGRAM=rex with the rex binary and no REX_SERVER -> default socket", () => {
    const result = detectBackend(inputs({ env: { termProgram: "rex" }, rexBinary: REX_BIN }));
    expect(result).toMatchObject({ ok: true, backend: "rex", server: DEFAULT_SERVER });
  });

  it("row: TERM_PROGRAM=rex without the rex binary -> ghostty when installed, with a notice naming the searched paths", () => {
    const result = detectBackend(inputs({ env: { termProgram: "rex" }, ghosttyInstalled: true }));
    expect(result).toMatchObject({ ok: true, backend: "ghostty", placement: "inside-rex" });
    expect(result.notices).toEqual([`Rex detected but its CLI was not found at PATH, ${REX_BIN}`]);
  });

  it("row: TERM_PROGRAM=rex without the rex binary and without Ghostty -> fail naming both", () => {
    const result = detectBackend(inputs({ env: { termProgram: "rex" } }));
    expect(result).toMatchObject({ ok: false, reason: NEITHER_TERMINAL_MSG });
    expect(result.notices).toHaveLength(1);
  });

  it("row: TERM_PROGRAM=ghostty -> ghostty, inherited REX_* ignored", () => {
    const result = detectBackend(inputs({ env: { termProgram: "ghostty", rexServer: INHERITED_SERVER, rexSession: "session:x" }, rexBinary: REX_BIN, whoamiAnswers: true }));
    expect(result).toEqual({ ok: true, backend: "ghostty", placement: "outside", notices: [] });
  });

  it("row: another TERM_PROGRAM with Ghostty installed -> ghostty, REX_SERVER ignored", () => {
    const result = detectBackend(inputs({ env: { termProgram: "iTerm.app", rexServer: INHERITED_SERVER }, ghosttyInstalled: true, rexBinary: REX_BIN, whoamiAnswers: true }));
    expect(result).toMatchObject({ ok: true, backend: "ghostty", placement: "outside" });
  });

  it("row: another TERM_PROGRAM, no Ghostty, rex binary found -> rex on the default socket (REX_SERVER ignored)", () => {
    const result = detectBackend(inputs({ env: { termProgram: "Apple_Terminal", rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, whoamiAnswers: true }));
    expect(result).toEqual({ ok: true, backend: "rex", placement: "outside", server: DEFAULT_SERVER, rexBinary: REX_BIN, notices: [] });
  });

  it("row: another TERM_PROGRAM, nothing installed -> fail", () => {
    expect(detectBackend(inputs({ env: { termProgram: "vscode" } }))).toEqual({ ok: false, reason: NEITHER_TERMINAL_MSG, notices: [] });
  });

  it("row: TERM_PROGRAM absent, REX_SERVER validated by whoami -> rex, outside, that server", () => {
    const result = detectBackend(inputs({ env: { rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, whoamiAnswers: true, ghosttyInstalled: true }));
    expect(result).toEqual({ ok: true, backend: "rex", placement: "outside", server: INHERITED_SERVER, rexBinary: REX_BIN, notices: [] });
  });

  it("row: TERM_PROGRAM absent, REX_SERVER set but whoami silent -> installed rules (Ghostty first)", () => {
    const result = detectBackend(inputs({ env: { rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, whoamiAnswers: false, ghosttyInstalled: true }));
    expect(result).toMatchObject({ ok: true, backend: "ghostty", placement: "outside" });
  });

  it("row: TERM_PROGRAM absent, REX_SERVER set, whoami silent, no Ghostty -> rex on the default socket", () => {
    const result = detectBackend(inputs({ env: { rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, whoamiAnswers: false }));
    expect(result).toMatchObject({ ok: true, backend: "rex", server: DEFAULT_SERVER });
  });

  it("row: TERM_PROGRAM absent, Ghostty installed -> ghostty, outside", () => {
    expect(detectBackend(inputs({ ghosttyInstalled: true }))).toEqual({ ok: true, backend: "ghostty", placement: "outside", notices: [] });
  });

  it("row: TERM_PROGRAM absent, only the rex binary -> rex, outside, default socket", () => {
    expect(detectBackend(inputs({ rexBinary: REX_BIN }))).toMatchObject({ ok: true, backend: "rex", placement: "outside", server: DEFAULT_SERVER });
  });

  it("row: nothing found -> fail naming both terminals", () => {
    expect(detectBackend(inputs({}))).toEqual({ ok: false, reason: NEITHER_TERMINAL_MSG, notices: [] });
  });

  it("extra: TERM_PROGRAM=ghostty with REX_SERVER set -> ghostty", () => {
    expect(detectBackend(inputs({ env: { termProgram: "ghostty", rexServer: INHERITED_SERVER } }))).toMatchObject({ backend: "ghostty" });
  });

  it("extra: TERM_PROGRAM=iTerm.app with REX_SERVER and whoami true -> ghostty when installed, rex when only the binary is found", () => {
    const base = { env: { termProgram: "iTerm.app", rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, whoamiAnswers: true };
    expect(detectBackend(inputs({ ...base, ghosttyInstalled: true }))).toMatchObject({ backend: "ghostty" });
    expect(detectBackend(inputs({ ...base, ghosttyInstalled: false }))).toMatchObject({ backend: "rex", server: DEFAULT_SERVER });
  });

  it("extra: REX_SERVER set, no TERM_PROGRAM, whoami false -> falls to the installed rules", () => {
    expect(detectBackend(inputs({ env: { rexServer: INHERITED_SERVER }, rexBinary: REX_BIN }))).toMatchObject({ backend: "rex" });
    expect(detectBackend(inputs({ env: { rexServer: INHERITED_SERVER } }))).toMatchObject({ ok: false });
  });

  it("extra: a validated REX_SERVER without a rex binary cannot select rex", () => {
    expect(detectBackend(inputs({ env: { rexServer: INHERITED_SERVER }, whoamiAnswers: true, ghosttyInstalled: true }))).toMatchObject({ backend: "ghostty" });
  });
});

describe("detectBackend probe laziness", () => {
  it("does not probe for Rex or Ghostty when TERM_PROGRAM=ghostty decides", () => {
    const probes = { ghostty: 0, rex: 0, whoami: 0 };
    const result = detectBackend({
      env: { termProgram: "ghostty", rexServer: INHERITED_SERVER },
      ghosttyInstalled: () => { probes.ghostty++; return true; },
      rex: () => { probes.rex++; return { path: REX_BIN, searched: [] }; },
      whoamiAnswers: () => { probes.whoami++; return true; },
      defaultServer: DEFAULT_SERVER,
    });
    expect(result).toMatchObject({ backend: "ghostty" });
    expect(probes).toEqual({ ghostty: 0, rex: 0, whoami: 0 });
  });

  it("asks whoami only with TERM_PROGRAM absent, REX_SERVER set and a rex binary, passing the server", () => {
    const asked: string[] = [];
    detectBackend(inputs({ env: { rexServer: INHERITED_SERVER }, rexBinary: REX_BIN, ghosttyInstalled: true }));
    const result = detectBackend({
      env: { rexServer: INHERITED_SERVER },
      ghosttyInstalled: () => true,
      rex: () => ({ path: REX_BIN, searched: [] }),
      whoamiAnswers: (server) => { asked.push(server); return true; },
      defaultServer: DEFAULT_SERVER,
    });
    expect(asked).toEqual([INHERITED_SERVER]);
    expect(result).toMatchObject({ backend: "rex", server: INHERITED_SERVER });
    const noBinary = { ghostty: 0, whoami: 0 };
    detectBackend({
      env: { rexServer: INHERITED_SERVER },
      ghosttyInstalled: () => { noBinary.ghostty++; return true; },
      rex: () => ({ path: null, searched: [] }),
      whoamiAnswers: () => { noBinary.whoami++; return true; },
      defaultServer: DEFAULT_SERVER,
    });
    expect(noBinary).toEqual({ ghostty: 1, whoami: 0 });
  });
});

describe("snapshotEnv", () => {
  it("keeps only the detection variables and drops empty values", () => {
    expect(snapshotEnv({ TERM_PROGRAM: "rex", REX_SERVER: "", REX_SESSION: "session:a", REX_BLOCK: "block:b", HOME: "/x" }))
      .toEqual({ termProgram: "rex", rexSession: "session:a", rexBlock: "block:b" });
    expect(snapshotEnv({})).toEqual({});
  });
});
