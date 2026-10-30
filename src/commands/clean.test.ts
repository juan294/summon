import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_STATUS_DIR = join(tmpdir(), `summon-clean-test-${process.pid}`);
const TEST_SNAPSHOTS_DIR = join(tmpdir(), `summon-clean-snapshots-${process.pid}`);
vi.mock("../paths.js", () => ({ STATUS_DIR: TEST_STATUS_DIR, CONFIG_DIR: join(tmpdir(), `summon-clean-config-${process.pid}`), SNAPSHOTS_DIR: TEST_SNAPSHOTS_DIR }));

// The Rex server is faked at the op level; the command's own calls (view, kill) are recorded.
type RexResult = import("../backends/rex/types.js").RexResult;
const rex = vi.hoisted(() => {
  const calls: Array<{ server: string; op: string; argv: string[]; input?: string }> = [];
  const answers: Record<string, (argv: readonly string[], server: string, input?: string) => RexResult> = {};
  return { calls, answers };
});
vi.mock("../backends/rex/cli.js", async (original) => ({
  ...(await original<typeof import("../backends/rex/cli.js")>()),
  discoverRex: () => ({ path: "/mock/rex", searched: ["PATH"] }),
  createRexCli: (binary: string, server: string) => ({
    binary,
    server,
    call(op: string, argv: readonly string[], opts?: { input?: string }) {
      rex.calls.push({ server, op, argv: [...argv], ...(opts?.input !== undefined ? { input: opts.input } : {}) });
      const answer = rex.answers[op];
      if (!answer) throw new Error(`unexpected rex op ${op}`);
      return answer(argv, server, opts?.input);
    },
  }),
}));
vi.mock("../snapshot.js", async (original) => ({
  ...(await original<typeof import("../snapshot.js")>()),
  collectSnapshot: () => null,
}));

const { handleCleanCommand } = await import("./clean.js");
const { writeStatus, readStatusRecord, resetRexBinaryMemo, resetReadAllStatusesCache } = await import("../status.js");
const { writeLaunchManifest, launchArtifactPaths } = await import("../launch-identity.js");
type WorkspaceStatus = import("../status.js").WorkspaceStatus;
type LaunchManifest = import("../launch-identity.js").LaunchManifest;

const GEN = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const GEN2 = "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f";
const GEN3 = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f";
const SERVER = "unix:///tmp/rex.sock";
const SESSION = "session:0000aaaa-0000-0000-0000-000000000001";
const SESSION2 = "session:0000aaaa-0000-0000-0000-000000000002";
const WINDOW = "window:0000aaaa-0000-0000-0000-000000000002";
const BLOCK = "block:0000aaaa-0000-0000-0000-000000000010";

function record(extra: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return { project: "chapa", directory: "/tmp/chapa", pid: 1, startedAt: "2026-10-29T09:00:00.000Z", layout: "minimal", panes: ["editor"], source: "summon", version: 1, launchId: GEN, backend: "rex", rex: { server: SERVER, hostId: "host-1", sessionId: SESSION, windowId: WINDOW, rootBlockId: BLOCK, blocks: [{ name: "editor", blockId: BLOCK, label: "editor · vim" }] }, ...extra };
}
function manifest(launchId: string, extra: Partial<LaunchManifest> = {}): LaunchManifest {
  return { version: 1, launchId, project: "chapa", directory: "/tmp/chapa", layout: "minimal", panes: ["editor"], paneOrder: ["editor"], blockLabels: { editor: "editor" }, backend: "rex", server: SERVER, startedAt: "2026-10-29T08:00:00.000Z", ...extra };
}
function writePane(launchId: string, sessionId: string, raw?: string) {
  const paths = launchArtifactPaths("chapa", launchId);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pane("editor").file, raw ?? `${sessionId}\n${BLOCK}\n`);
}
function writeSidecars(launchId: string, pid = process.pid) {
  const paths = launchArtifactPaths("chapa", launchId);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pid, `${pid}\n`);
  writeFileSync(paths.active, `${launchId}\n`);
}
const ok = (op: RexResult["op"], json: unknown): RexResult => ({ ok: true, op, stdout: JSON.stringify(json), json });
const fail = (op: RexResult["op"], kind: "unreachable" | "not-found" | "failed", reason: string): RexResult => ({ ok: false, op, kind, outcome: "none", reason, raw: { code: 1, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "" } });
const view = (sessionId: string, blockIds: string[]) => ({ session_id: sessionId, label: "chapa", revision: 1, windows: [{ window_id: WINDOW, label: "[chapa]", layers: [{ layer_id: "l", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: blockIds.map((id) => ({ block_id: id, host_id: "host-1" })) }] }] });
/** `present` sessions on the server and the blocks each one shows. */
function server(sessions: Record<string, string[]>, extra: Partial<typeof rex.answers> = {}) {
  rex.answers.ls = () => ok("ls", { sessions: Object.keys(sessions).map((id) => ({ session_id: id, label: "chapa" })) });
  rex.answers["session-view"] = (_argv, _server, input) => {
    const id = JSON.parse(input ?? "{}").session_id as string;
    return id in sessions ? ok("session-view", view(id, sessions[id]!)) : fail("session-view", "not-found", "session not found");
  };
  rex.answers.kill = (argv) => { delete sessions[(argv as string[])[1]!]; return ok("kill", {}); };
  Object.assign(rex.answers, extra);
}
const context = (args: string[], values: Record<string, unknown> = {}) => ({ parsed: { values, positionals: [], args }, values, subcommand: "clean", args, overrides: {} });

let logs: string[];
let errs: string[];
beforeEach(() => {
  rmSync(TEST_STATUS_DIR, { recursive: true, force: true });
  mkdirSync(TEST_STATUS_DIR, { recursive: true });
  rmSync(TEST_SNAPSHOTS_DIR, { recursive: true, force: true });
  rex.calls.length = 0;
  for (const key of Object.keys(rex.answers)) delete rex.answers[key];
  resetRexBinaryMemo();
  resetReadAllStatusesCache();
  logs = [];
  errs = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { logs.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { errs.push(String(chunk)); return true; });
  vi.spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit:${code}`); }) as never);
});
afterEach(() => { vi.restoreAllMocks(); });
const stdout = () => logs.join("");
const stderr = () => errs.join("");
const paths = (launchId = GEN) => launchArtifactPaths("chapa", launchId);
const viewCalls = () => rex.calls.filter((c) => c.op === "session-view").length;

describe("summon clean <project> (plan P17)", () => {
  it("refuses without a record, on an unknown state, and never runs a mutating op for them", async () => {
    await expect(handleCleanCommand(context(["chapa"]))).rejects.toThrow("exit:2");
    expect(stderr()).toContain("has no workspace record");
    writeStatus(record());
    rex.answers.ls = () => fail("ls", "unreachable", "no socket");
    await expect(handleCleanCommand(context(["chapa"]))).rejects.toThrow("exit:2");
    expect(stderr()).toContain("could not be verified: no socket");
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
  });

  it.each([["layers: string", "malformed"], ["layers: [[]]", [[]]]])("a malformed session view (%s) is unverifiable: no kill, exit 2, record untouched", async (_label, layers) => {
    writeStatus(record());
    const malformed = { session_id: SESSION, revision: 1, windows: [{ window_id: WINDOW, layers }] };
    server({ [SESSION]: [] }, { "session-view": () => ok("session-view", malformed) });
    await expect(handleCleanCommand(context(["chapa"]))).rejects.toThrow("exit:2");
    expect(stderr()).toContain("[chapa] could not be verified");
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
    expect(readStatusRecord("chapa")!.endedAt).toBeUndefined();
  });

  it("refuses with the live pane names (recorded and unrecorded) and leaves everything in place", async () => {
    writeStatus(record());
    writeSidecars(GEN);
    server({ [SESSION]: [BLOCK, "block:0000aaaa-0000-0000-0000-000000000099"] });
    await expect(handleCleanCommand(context(["chapa"]))).rejects.toThrow("exit:2");
    expect(stderr()).toContain("[chapa] still has live panes (editor; 1 unrecorded block); not cleaned.");
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
    expect(existsSync(paths().pid)).toBe(true);
    expect(readStatusRecord("chapa")!.endedAt).toBeUndefined();
  });

  it("refuses when the pre-destroy recheck finds a block that appeared after the first check", async () => {
    writeStatus(record());
    const sessions: Record<string, string[]> = { [SESSION]: [] };
    server(sessions);
    let views = 0;
    const base = rex.answers["session-view"]!;
    rex.answers["session-view"] = (argv, s, input) => { views += 1; if (views === 2) sessions[SESSION] = ["block:0000aaaa-0000-0000-0000-000000000077"]; return base(argv, s, input); };
    await expect(handleCleanCommand(context(["chapa"]))).rejects.toThrow("exit:2");
    expect(stderr()).toContain("1 unrecorded block");
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
  });

  it("a session whose panes closed between the probe and the recheck is not cleaned on this run, with a clear line", async () => {
    writeStatus(record());
    const sessions: Record<string, string[]> = { [SESSION]: ["block:0000aaaa-0000-0000-0000-000000000099"] };
    server(sessions);
    let views = 0;
    const base = rex.answers["session-view"]!;
    rex.answers["session-view"] = (argv, s, input) => { views += 1; if (views === 2) sessions[SESSION] = []; return base(argv, s, input); };
    await expect(handleCleanCommand(context(["chapa"]))).rejects.toThrow("exit:2");
    expect(stderr()).toContain("[chapa] was not empty when checked (no live panes); run summon clean chapa again.");
    expect(stderr()).not.toContain("live panes ()");
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
  });

  it("closes an empty session on the record's server, then runs the ordered end steps and prints the limitation", async () => {
    writeStatus(record());
    writeSidecars(GEN);
    writeLaunchManifest(manifest(GEN));
    writePane(GEN, SESSION);
    server({ [SESSION]: [] });
    await handleCleanCommand(context(["chapa"]));
    const kill = rex.calls.find((c) => c.op === "kill")!;
    expect(kill).toEqual({ server: SERVER, op: "kill", argv: ["kill", SESSION] });
    expect(viewCalls()).toBe(2); // the state probe and the recheck immediately before the destroy
    expect(stdout()).toContain(`Closed empty Rex session [chapa] (${SESSION}). Rex has no conditional destroy: anything added to it after the check was closed with it.`);
    expect(readStatusRecord("chapa")!.endedAt).toBeDefined();
    const p = paths();
    expect([p.pid, p.active, p.manifest, p.pane("editor").file].some(existsSync)).toBe(false);
    expect(stderr()).toContain("summon: note: session closed; snapshot skipped (no git repository)");
    expect(stderr()).not.toContain("ended outside Summon");
  });

  it("reports a step failure the same way as reconciliation and exits 0 (the session is closed)", async () => {
    writeStatus(record());
    writeSidecars(GEN);
    server({ [SESSION]: [] });
    chmodSync(paths().dir, 0o500);
    try {
      await handleCleanCommand(context(["chapa"]));
    } finally {
      chmodSync(paths().dir, 0o700);
    }
    expect(stdout()).toContain("Closed empty Rex session");
    expect(stderr()).toMatch(/launch files of \[chapa\] could not be removed: .*; will retry/);
    expect(readStatusRecord("chapa")!.endedAt).toBeDefined();
  });

  it("a session that is already gone is reconciled without a kill; a Ghostty record only sweeps dead launches", async () => {
    writeStatus(record());
    writeSidecars(GEN);
    server({});
    await handleCleanCommand(context(["chapa"]));
    expect(stdout()).toContain("already gone; nothing to close");
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
    expect(readStatusRecord("chapa")!.endedAt).toBeDefined();
    expect(existsSync(paths().pid)).toBe(false);

    logs.length = 0;
    writeStatus({ ...record({ launchId: GEN2 }), backend: "ghostty", rex: undefined });
    writeSidecars(GEN2, process.pid);          // the current launch: kept
    writeSidecars(GEN3, 2_147_483_000);         // a dead earlier launch: removed
    await handleCleanCommand(context(["chapa"]));
    expect(stdout()).toContain("[chapa] is a Ghostty workspace; nothing to close. 1 stale launch file pair removed.");
    expect(existsSync(paths(GEN2).pid)).toBe(true);
    expect(existsSync(paths(GEN3).pid)).toBe(false);
  });

  it("the Ghostty sweep removes only files whose pid is proven dead", async () => {
    // Kept: a live pid without its marker (bootstrap window), a malformed marker beside a live pid, an unreadable pid file.
    writeStatus({ ...record(), backend: "ghostty", rex: undefined });
    const bootstrapping = "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f";
    const unreadable = "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f";
    mkdirSync(paths().dir, { recursive: true });
    writeFileSync(paths(bootstrapping).pid, `${process.pid}\n`);                 // pid written, marker not yet: alive
    writeSidecars(GEN2, process.pid);
    writeFileSync(paths(GEN2).active, "garbage\n");                                // malformed marker, live pid: alive
    writeFileSync(paths(unreadable).pid, "\n");                                    // no pid to prove anything: kept
    writeSidecars(GEN3, 2_147_483_000);                                            // dead pid: removed, marker or not
    await handleCleanCommand(context(["chapa"]));
    expect(stdout()).toContain("1 stale launch file pair removed.");
    expect(existsSync(paths(bootstrapping).pid)).toBe(true);
    expect(existsSync(paths(GEN2).pid)).toBe(true);
    expect(existsSync(paths(GEN2).active)).toBe(true);
    expect(existsSync(paths(unreadable).pid)).toBe(true);
    expect(existsSync(paths(GEN3).pid)).toBe(false);
    expect(existsSync(paths(GEN3).active)).toBe(false);
  });
});

describe("summon clean --orphans <project>", () => {
  it("prints the rm command for an unconfirmed or unreadable launch and never deletes it", async () => {
    writeStatus(record());
    writeLaunchManifest(manifest(GEN2));
    writeLaunchManifest(manifest(GEN3, { startedAt: "2026-10-29T08:30:00.000Z" }));
    writePane(GEN3, SESSION2, "half");
    server({ [SESSION]: [BLOCK] });
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(stdout()).toContain(`launch ${GEN2} of [chapa] (started 2026-10-29T08:00:00.000Z, server ${SERVER}): never confirmed its session; left in place as evidence.`);
    expect(stdout()).toContain(`launch ${GEN3} of [chapa] (started 2026-10-29T08:30:00.000Z, server ${SERVER}): has an unreadable pane file; left in place as evidence.`);
    expect(stdout()).toContain(`rm -f ${JSON.stringify(paths(GEN2).manifest)}`);
    expect(existsSync(paths(GEN2).manifest)).toBe(true);
    expect(existsSync(paths(GEN3).pane("editor").file)).toBe(true);
    expect(rex.calls.some((c) => c.op === "kill")).toBe(false);
  });

  it("closes an empty orphan session and removes its files; leaves one with blocks and prints the kill command", async () => {
    writeStatus(record());
    writeLaunchManifest(manifest(GEN2));
    writePane(GEN2, SESSION2);
    const SESSION3 = "session:0000aaaa-0000-0000-0000-000000000003";
    writeLaunchManifest(manifest(GEN3, { startedAt: "2026-10-29T08:30:00.000Z" }));
    writePane(GEN3, SESSION3);
    server({ [SESSION]: [BLOCK], [SESSION2]: [], [SESSION3]: ["block:0000aaaa-0000-0000-0000-000000000031"] });
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(rex.calls.filter((c) => c.op === "kill").map((c) => c.argv)).toEqual([["kill", SESSION2]]);
    expect(stdout()).toContain(`closed its empty Rex session ${SESSION2}; files removed.`);
    expect(existsSync(paths(GEN2).manifest)).toBe(false);
    expect(stdout()).toContain(`Rex session ${SESSION3} still has 1 block; close it yourself with: rex -S ${SERVER} kill ${SESSION3}`);
    expect(existsSync(paths(GEN3).manifest)).toBe(true);
    expect(readStatusRecord("chapa")!.launchId).toBe(GEN);
  });

  it("removes the files of a gone orphan, reports an unreachable manifest server, and never touches the current launch", async () => {
    writeStatus(record());
    writeLaunchManifest(manifest(GEN2));
    writePane(GEN2, SESSION2);
    const other = "unix:///other/server.sock";
    writeLaunchManifest(manifest(GEN3, { server: other, startedAt: "2026-10-29T08:30:00.000Z" }));
    writePane(GEN3, "session:0000aaaa-0000-0000-0000-000000000003");
    writeSidecars(GEN);
    server({ [SESSION]: [BLOCK] });
    const ls = rex.answers.ls!;
    rex.answers.ls = (argv, s) => (s === other ? fail("ls", "unreachable", "no socket") : ls(argv, s));
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(stdout()).toContain(`launch ${GEN2} of [chapa] (started 2026-10-29T08:00:00.000Z, server ${SERVER}): its Rex session is gone; files removed.`);
    expect(existsSync(paths(GEN2).manifest)).toBe(false);
    expect(stdout()).toContain(`server unreachable (no socket); left in place.`);
    expect(existsSync(paths(GEN3).manifest)).toBe(true);
    expect(existsSync(paths().pid)).toBe(true);
    expect(readStatusRecord("chapa")!.launchId).toBe(GEN);
  });

  it("reports a file that could not be removed, keeps the manifest, and the next review removes everything", async () => {
    writeStatus(record());
    writeLaunchManifest(manifest(GEN2));
    writePane(GEN2, SESSION2);
    server({ [SESSION]: [BLOCK] });
    chmodSync(paths().dir, 0o500);
    try {
      await handleCleanCommand(context(["chapa"], { orphans: true }));
    } finally {
      chmodSync(paths().dir, 0o700);
    }
    // With one pane and a read-only directory the first unlink that can fail is the manifest's (the token comes after it).
    expect(stdout()).toMatch(new RegExp(`its Rex session is gone; a file could not be removed \\(.*${GEN2}\\.json: .*\\); the manifest is kept, run summon clean --orphans again\\.`));
    expect(stdout()).not.toContain("files removed.");
    expect(existsSync(paths(GEN2).manifest)).toBe(true);
    expect(existsSync(paths(GEN2).pane("editor").file)).toBe(true);
    // The next review: adoption (which runs first) finds the manifest again and removes everything.
    logs.length = 0;
    errs.length = 0;
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(stderr()).toContain(`removed the files of earlier launch ${GEN2} (its Rex session is gone)`);
    expect(existsSync(paths(GEN2).manifest)).toBe(false);
    expect(existsSync(paths(GEN2).pane("editor").file)).toBe(false);
  });

  it("names a manifest without a server and leaves it; a legacy current record stops the review", async () => {
    writeStatus(record());
    writeLaunchManifest(manifest(GEN2, { server: undefined }));
    writePane(GEN2, SESSION2);
    server({ [SESSION]: [BLOCK] });
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(stdout()).toContain(`launch ${GEN2} of [chapa] (started 2026-10-29T08:00:00.000Z, server none): manifest names no server; left in place.`);
    expect(existsSync(paths(GEN2).manifest)).toBe(true);

    logs.length = 0;
    writeStatus({ ...record(), launchId: undefined, backend: undefined, rex: undefined });
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(stderr()).toContain("summon: note: chapa has a record from an older Summon; run summon chapa to replace it, then review its launches");
    expect(existsSync(paths(GEN2).manifest)).toBe(true);
    // Neither form probed the server: a manifest without one is never a candidate, and a legacy record stops the review.
    expect(rex.calls.filter((c) => c.op === "ls").length).toBe(0);
  });

  it("says so when there is nothing to review", async () => {
    writeStatus(record());
    server({ [SESSION]: [BLOCK] });
    await handleCleanCommand(context(["chapa"], { orphans: true }));
    expect(stdout()).toContain("No earlier launches of [chapa] to review.");
    expect(readFileSync(join(TEST_STATUS_DIR, "chapa.json"), "utf-8")).toContain(GEN);
  });
});
