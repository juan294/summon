import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliBuild } from "./fixtures/cli-builds.js";
import { createRexCli, whoamiOf } from "./backends/rex/cli.js";
import { listAppClients } from "./backends/rex/app.js";
import { listSessions, viewSession } from "./backends/rex/status.js";

/**
 * QA-M2: the built CLI composed end to end under Rex (launcher -> Rex backend -> layout -> CLI adapter -> launcher
 * tab) against a scripted fake `rex` at the process boundary, in the normal `pnpm test` run. The fake keeps its
 * server state in a JSON file and answers in the shapes the unit suites and the rex-cli E2E pin for the real CLI
 * (`ls`, `session.view`, `session.create`, `client.list`, `whoami`, `block call process`); the first test checks
 * those answers through Summon's own parsers. Nothing here starts Rex, Ghostty or osascript: an app client is
 * always connected, so no launch path opens the Rex app.
 */
const root = mkdtempSync(join(tmpdir(), "summon-rex-hermetic-"));
const home = join(root, "home");
const binDir = join(root, "bin");
const rex = join(binDir, "rex");
const stateFile = join(root, "rex-state.json");
const logFile = join(root, "rex-log.jsonl");
const SERVER = `unix://${join(root, "fake.sock")}`;
const projectDir = (name: string) => join(root, "projects", name);
const statusDir = join(home, ".config", "summon", "status");

const FAKE_REX = String.raw`
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const [stateFile, logFile] = [process.env.FAKE_REX_STATE, process.env.FAKE_REX_LOG];
const argv = process.argv.slice(2);
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--color" || a === "--timeout" || a === "-S" || a === "-C") { i++; continue; }
  if (a.startsWith("--autostart=")) continue;
  rest.push(a);
}
const input = rest[0] === "api" && rest[rest.length - 1] === "-" ? fs.readFileSync(0, "utf8") : undefined;
fs.appendFileSync(logFile, JSON.stringify({ argv, input }) + "\n");
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const print = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const id = (kind) => kind + ":" + randomUUID();
const find = (sessionId) => state.sessions.find((s) => s.session_id === sessionId);
const notFound = () => { process.stderr.write("Error: session_not_found: no such session\n"); process.exit(3); };
const view = (s) => ({
  session_id: s.session_id, label: s.label, revision: 1,
  windows: s.windows.map((w) => ({ window_id: w.window_id, label: w.label, layers: [{ layer_id: "layer:1", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: w.blocks.map((b) => ({ block_id: b, host_id: "host-fake" })) }] })),
});
const leaves = (node) => (node.block ? [node] : [...leaves(node.split.before), ...leaves(node.split.after)]);
const [cmd, sub, method] = rest;
if (cmd === "whoami") print({ host_id: "host-fake", session_id: process.env.REX_SESSION, endpoint: "fake" });
else if (cmd === "ls") print({ sessions: state.sessions.map((s) => ({ session_id: s.session_id, label: s.label })) });
else if (cmd === "api" && method === "session.view") { const s = find(JSON.parse(input).session_id); if (!s) notFound(); print(view(s)); }
else if (cmd === "api" && method === "client.list") print({ clients: state.clients });
else if (cmd === "api" && method === "session.create") {
  const request = JSON.parse(input);
  const first = request.initial_windows[0];
  const s = { session_id: id("session"), label: request.label, windows: [{ window_id: id("window"), label: first.window_label, blocks: leaves(first.layout).map(() => id("block")) }] };
  state.sessions.push(s);
  save();
  // A lost answer: the session exists on the server, the CLI reports a timeout.
  if (state.createMode === "lost") { process.stderr.write("Error: request timed out\n"); process.exit(1); }
  print({ session_id: s.session_id, initial_windows: [{ window_id: s.windows[0].window_id, block_ids: s.windows[0].blocks, revision: 1 }] });
}
else if (cmd === "do" && sub === "session.select") print({});
else if (cmd === "block" && rest.includes("process")) print({ foreground: { pid: state.foreground === "agent" ? 1 : process.ppid, name: "node" }, ancestors: [{ pid: 1, name: "zsh" }] });
else if (cmd === "kill") { const s = find(rest[1]); if (!s) notFound(); state.sessions = state.sessions.filter((x) => x !== s); save(); }
else if (cmd === "window" && sub === "close") { const s = find(rest[rest.indexOf("-s") + 1]); if (!s) notFound(); s.windows = s.windows.filter((w) => w.window_id !== rest[rest.length - 1]); save(); }
else { process.stderr.write("unexpected fake rex operation: " + argv.join(" ") + "\n"); process.exit(2); }
`;

interface FakeSession { session_id: string; label: string; windows: Array<{ window_id: string; label: string; blocks: string[] }> }
interface FakeState { sessions: FakeSession[]; clients: unknown[]; createMode?: "lost"; foreground?: "agent" }

const LAUNCHER: FakeSession = {
  session_id: "session:0000aaaa-0000-0000-0000-000000000001",
  label: "zsh",
  windows: [{ window_id: "window:0000aaaa-0000-0000-0000-000000000002", label: "zsh ~", blocks: ["block:0000aaaa-0000-0000-0000-000000000003"] }],
};
const OTHER_TAB = { window_id: "window:0000aaaa-0000-0000-0000-000000000004", label: "zsh ~", blocks: ["block:0000aaaa-0000-0000-0000-000000000005"] };
const CLIENT = { client_id: "client:app-1", connected_at: "2026-10-31T08:00:00Z", connection_state: "connected", info: { kind: "app", label: "Fake Rex" }, session_ids: [LAUNCHER.session_id] };

const readState = (): FakeState => JSON.parse(readFileSync(stateFile, "utf8")) as FakeState;
const writeState = (state: FakeState) => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const rexCalls = (): string[][] => readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { argv: string[] }).argv);
/** Each call's operation without its global flags: `api call <method>`, `block call`, `window close`, `do <action>`, else the command. */
const opsOf = (calls: string[][]) => calls.map((argv) => {
  const words = argv.filter((a, i) => !["--color", "--timeout", "-S", "-C"].includes(argv[i - 1] ?? "") && !a.startsWith("-"));
  return words.slice(0, words[0] === "api" ? 3 : ["block", "window", "do"].includes(words[0] ?? "") ? 2 : 1).join(" ");
});
const launcherAlive = () => readState().sessions.some((s) => s.session_id === LAUNCHER.session_id);
const record = (project: string) => JSON.parse(readFileSync(join(statusDir, `${project}.json`), "utf8")) as { launchId: string; backend: string; rex: { sessionId: string; rootBlockId: string } };

function env(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(REX_|SUMMON_|GIT_)/.test(key)) result[key] = value;
  return {
    ...result,
    HOME: home, PATH: `${binDir}:${process.env["PATH"] ?? ""}`, SHELL: "/bin/zsh", NO_COLOR: "1", SUMMON_NO_CACHE: "1",
    TERM_PROGRAM: "rex", REX_SERVER: SERVER, REX_BIN_DIR: binDir, REX_SESSION: LAUNCHER.session_id, REX_BLOCK: LAUNCHER.windows[0]!.blocks[0]!,
    FAKE_REX_STATE: stateFile, FAKE_REX_LOG: logFile,
  };
}

function summon(project: string, ...flags: string[]) {
  const run = spawnSync(process.execPath, [cliBuild("production"), ".", "--editor", "sleep 300", "--sidebar", "sleep 300", "--layout", "minimal", ...flags], { cwd: projectDir(project), env: env(), encoding: "utf8", input: "", timeout: 30_000 });
  if (run.error) throw run.error;
  return run;
}

/** The detached close runs 0.3 s after Summon exits; wait for its decision (or for the time it would take). */
async function settle(until: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (until()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return until();
}

beforeAll(() => {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  for (const name of ["alpha", "beta", "gamma"]) mkdirSync(projectDir(name), { recursive: true });
  writeFileSync(rex, `#!${process.execPath}\n${FAKE_REX}`);
  chmodSync(rex, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  // The launcher tab is back for every launch; workspace sessions persist across tests like a real server.
  const sessions = existsSync(stateFile) ? readState().sessions.filter((s) => s.session_id !== LAUNCHER.session_id) : [];
  writeState({ sessions: [structuredClone(LAUNCHER), ...sessions], clients: [CLIENT] });
  writeFileSync(logFile, "");
});

describe("Rex launch composition through the built CLI and a fake rex (QA-M2)", () => {
  it("the fake answers in the shapes Summon's own parsers read", () => {
    const cli = createRexCli(rex, SERVER);
    const prior = process.env;
    process.env = { ...prior, FAKE_REX_STATE: stateFile, FAKE_REX_LOG: logFile, REX_SESSION: LAUNCHER.session_id };
    try {
      expect(whoamiOf(cli)).toEqual({ answers: true, hostId: "host-fake", sessionId: LAUNCHER.session_id });
      expect(listSessions(cli)).toEqual({ ok: true, sessions: [{ sessionId: LAUNCHER.session_id, label: "zsh" }] });
      const viewed = viewSession(cli, LAUNCHER.session_id);
      expect(viewed.ok && viewed.view.windows).toEqual([{ windowId: LAUNCHER.windows[0]!.window_id, label: "zsh ~", blockIds: LAUNCHER.windows[0]!.blocks, hostIds: ["host-fake"] }]);
      expect(viewSession(cli, "session:0000ffff-0000-0000-0000-000000000000")).toMatchObject({ ok: false, kind: "not-found" });
      const clients = listAppClients(cli);
      expect(clients.ok && clients.clients.map((c) => c.clientId)).toEqual(["client:app-1"]);
    } finally {
      process.env = prior;
    }
  });

  it("launches a workspace, records its identity, and closes the single-pane launcher tab by ending its session", async () => {
    const run = summon("alpha");
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Workspace [alpha] ready in Rex.");
    expect(run.stderr).toBe("");
    const created = readState().sessions.find((s) => s.label === "alpha")!;
    expect(created.windows[0]!.label).toBe("[alpha]");
    expect(record("alpha")).toMatchObject({ backend: "rex", rex: { sessionId: created.session_id, rootBlockId: created.windows[0]!.blocks[0] } });
    expect(await settle(() => !launcherAlive())).toBe(true);
    const ops = opsOf(rexCalls());
    expect(ops.slice(0, 5)).toEqual(["whoami", "ls", "api call session.create", "api call client.list", "do session.select"]);
    // BE-L5: the exit-time check, then the detached re-check and the kill, each bounded by --timeout.
    expect(ops.slice(5)).toEqual(["api call session.view", "block call", "api call session.view", "kill"]);
    expect(rexCalls().at(-1)).toEqual(["--color", "never", "--timeout", "2s", "--autostart=false", "-S", SERVER, "kill", LAUNCHER.session_id]);
  });

  it("switches to the running workspace instead of creating another, and closes only the launcher tab when the session has others", async () => {
    const state = readState();
    state.sessions[0]!.windows.push(structuredClone(OTHER_TAB));
    writeState(state);
    const before = readState().sessions.filter((s) => s.label === "alpha").length;
    const run = summon("alpha");
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe("Workspace [alpha] is already running in Rex; switched to it (use --new-window for a fresh one)\n");
    expect(readState().sessions.filter((s) => s.label === "alpha")).toHaveLength(before);
    expect(opsOf(rexCalls())).not.toContain("api call session.create");
    expect(await settle(() => readState().sessions[0]!.windows.length === 1)).toBe(true);
    expect(launcherAlive()).toBe(true);
    expect(readState().sessions[0]!.windows.map((w) => w.window_id)).toEqual([OTHER_TAB.window_id]);
    expect(opsOf(rexCalls()).at(-1)).toBe("window close");
  });

  it("a lost create answer records nothing; the next launch adopts the session from its pane files and switches to it", { timeout: 60_000 }, async () => {
    writeState({ ...readState(), createMode: "lost" });
    const lost = summon("beta");
    expect(lost.status).not.toBe(0);
    expect(lost.stderr).toContain("Rex did not confirm the workspace (Error: request timed out; no pane file confirmed the session within 8 s)");
    expect(existsSync(join(statusDir, "beta.json"))).toBe(false);
    const session = readState().sessions.find((s) => s.label === "beta")!;
    expect(session).toBeDefined();
    // The pane shells start late: they write their own ids after the launch gave up.
    const launches = join(statusDir, "beta.launches");
    const manifestName = readdirSync(launches).find((f) => f.endsWith(".json"))!;
    const manifest = JSON.parse(readFileSync(join(launches, manifestName), "utf8")) as { launchId: string; paneOrder: string[] };
    manifest.paneOrder.forEach((pane, i) => writeFileSync(join(launches, `${manifest.launchId}.pane.${pane}`), `${session.session_id}\n${session.windows[0]!.blocks[i]}\n`));

    writeState({ ...readState(), createMode: undefined } as FakeState);
    writeFileSync(logFile, "");
    const next = summon("beta");
    expect(next.status, next.stderr).toBe(0);
    expect(next.stderr).toContain(`summon: note: adopted earlier launch ${manifest.launchId} of beta (Rex session ${session.session_id})`);
    expect(next.stderr).toContain("Workspace [beta] is already running in Rex; switched to it");
    expect(record("beta")).toMatchObject({ launchId: manifest.launchId, rex: { sessionId: session.session_id } });
    expect(readState().sessions.filter((s) => s.label === "beta")).toHaveLength(1);
    expect(opsOf(rexCalls())).not.toContain("api call session.create");
    // The adoption note is something to read: the launcher tab stays.
    await settle(() => false, 1000);
    expect(launcherAlive()).toBe(true);
  });

  it("keeps the launcher tab when the launch printed a note", async () => {
    const run = summon("gamma", "--maximize");
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain("summon: note: Rex cannot honor maximize; ignored");
    await settle(() => false, 1000);
    expect(launcherAlive()).toBe(true);
    expect(opsOf(rexCalls()).filter((op) => op === "kill" || op === "window close" || op === "block call")).toEqual([]);
  });
});
