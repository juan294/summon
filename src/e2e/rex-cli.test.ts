import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rex CLI end-to-end suite (docs/release/rex-e2e-guide.md §2.2). Gated like rex-native:
 *   SUMMON_REX_E2E=1 runs (skips without prerequisites); SUMMON_REX_E2E_REQUIRED=1 fails instead.
 * Unlike rex-native, every step runs the built CLI (`dist/index.js`) as a child process under a
 * sandbox HOME with the environment a Rex terminal exports, so the dispatch, exit codes and printed
 * messages are the ones the owner sees. The pane shells resolve `$HOME` themselves (bootstrap and trap
 * are typed shell text), so the sandbox is handed to them through the `env.HOME` config key; without it
 * their pane files would land in the real home. Projects are named `e2e-<suffix>-<name>` (the status
 * table shows 16 characters); only sessions with that prefix are killed. An interrupted run leaves those
 * sessions and its `summon-rex-cli-*` temp directory (afterAll does not run): kill and remove them by hand.
 * Run the Rex suites one at a time: they share the server.
 */

const { rexGate, sleep, until } = await import("./rex-harness.js");
const { discoverRex, createRexCli, defaultRexServer } = await import("../backends/rex/cli.js");
const { listSessions, viewSession } = await import("../backends/rex/status.js");
const harness = rexGate(process.env, "rex-cli e2e");
const { prereq } = harness;

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist", "index.js");
const DEAD_SERVER = "unix:///tmp/summon-e2e-none.sock";
const PANES = ["editor", "sidebar", "right-1", "shell"];

interface Record_ { launchId?: string; backend?: string; panes?: string[]; endedAt?: string; rex?: { server: string; sessionId: string; windowId: string; rootBlockId: string; blocks: Array<{ name: string; blockId: string; label: string }> } }
interface Run { status: number | null; stdout: string; stderr: string; out: string }

let home = "";
let server = "";
let binary = "";
let cli: ReturnType<typeof createRexCli>;
let suffix = "";
const name = (topic: string) => `e2e-${suffix}-${topic}`;
const statusDir = () => join(home, ".config", "summon", "status");
const launchesDirOf = (project: string) => join(statusDir(), `${project}.launches`);
const readRecord = (project: string): Record_ | null => {
  const file = join(statusDir(), `${project}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record_) : null;
};
const writeRecord = (project: string, record: Record_) => writeFileSync(join(statusDir(), `${project}.json`), JSON.stringify(record, null, 2) + "\n");

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // GIT_* is stripped so a run under the pre-commit hook never points the projects' git at the repository.
  for (const [key, value] of Object.entries(process.env)) if (!/^(REX_|SUMMON_|GIT_)/.test(key)) env[key] = value;
  Object.assign(env, { HOME: home, TERM_PROGRAM: "rex", REX_SERVER: server, REX_BIN_DIR: dirname(binary), SUMMON_NO_CACHE: "1", SHELL: "/bin/zsh", NO_COLOR: "1" });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function summon(args: string[], opts: { env?: Record<string, string | undefined>; stdin?: string } = {}): Run {
  const result = spawnSync(process.execPath, [dist, ...args], { env: childEnv(opts.env), encoding: "utf8", input: opts.stdin ?? "", timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: result.stdout + result.stderr };
}

const windowLabel = (sessionId: string): string | undefined => {
  const viewed = viewSession(cli, sessionId);
  return viewed.ok ? viewed.view.windows[0]?.label : undefined;
};
/** Block ids of a session as the server lists them now (every window). */
function liveBlocks(sessionId: string): string[] {
  const viewed = viewSession(cli, sessionId);
  return viewed.ok ? viewed.view.windows.flatMap((w) => w.blockIds) : [];
}
function sessionExists(sessionId: string): boolean {
  const listed = listSessions(cli);
  return listed.ok && listed.sessions.some((s) => s.sessionId === sessionId);
}
function blockLabels(sessionId: string): Set<string> {
  const raw = cli.call("session-view", ["api", "call", "session.view", "-"], { input: JSON.stringify({ session_id: sessionId }) });
  if (!raw.ok) return new Set();
  const windows = (raw as { json: Record<string, unknown> }).json["windows"] as Array<Record<string, unknown>>;
  const layers = windows.flatMap((w) => w["layers"] as Array<Record<string, unknown>>);
  return new Set(layers.flatMap((layer) => (layer["blocks"] as Array<Record<string, unknown>>).map((b) => String(b["label"]))));
}
const rowOf = (out: string, project: string) => out.split("\n").find((line) => line.includes(project)) ?? "";
/** Sessions labelled `project`: other suites and the owner create sessions on the same server meanwhile. */
const ownSessions = (project: string): number => {
  const listed = listSessions(cli);
  return listed.ok ? listed.sessions.filter((s) => s.label === project).length : -1;
};
/** The record a previous scenario must have left; a clear failure instead of a null dereference. */
const requireRecord = (project: string): Record_ => {
  const record = readRecord(project);
  if (!record?.rex) throw new Error(`no Rex record for ${project}: an earlier scenario did not complete`);
  return record;
};
const ghosttyInstalled = existsSync("/Applications/Ghostty.app") || existsSync(join(homedir(), "Applications", "Ghostty.app"));
/** Like `toContain`, with the whole text in the failure message (vitest shortens long strings). */
const contains = (text: string, needle: string | RegExp) => {
  const found = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  expect(found, `expected ${JSON.stringify(needle instanceof RegExp ? String(needle) : needle)} in:\n${text}`).toBe(true);
};

describe("rex cli e2e", () => {
  beforeAll(() => {
    if (prereq) return;
    binary = discoverRex().path!;
    server = defaultRexServer();
    cli = createRexCli(binary, server);
    suffix = Math.random().toString(16).slice(2, 6);
    home = mkdtempSync(join(tmpdir(), "summon-rex-cli-"));
    mkdirSync(join(home, ".config"), { recursive: true });
    // The candidate under test is the built CLI: build it so a stale dist/ never passes for the sources.
    execFileSync("pnpm", ["build"], { cwd: root, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
    for (const topic of ["one", "two", "three", "four"]) {
      const dir = join(home, "projects", name(topic));
      mkdirSync(dir, { recursive: true });
      // A git repository with a commit (the snapshot reads HEAD), so a reconciliation writes a real snapshot.
      const git = (args: string[]) => execFileSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args], { cwd: dir, env: childEnv(), encoding: "utf8", timeout: 10_000 });
      git(["init", "-q"]);
      git(["commit", "-q", "--allow-empty", "-m", "init"]);
      expect(summon(["add", name(topic), dir]).status).toBe(0);
    }
    for (const [key, value] of [["editor", "sleep 300"], ["sidebar", "sleep 300"], ["shell", "true"], ["layout", "pair"], ["env.HOME", home]]) {
      expect(summon(["set", key!, value!]).status).toBe(0);
    }
  });

  afterAll(() => {
    if (!home) return;
    const listed = listSessions(cli);
    if (listed.ok) {
      for (const session of listed.sessions) {
        if (session.label.startsWith(`e2e-${suffix}-`)) {
          try { cli.call("kill", ["kill", session.sessionId]); } catch { /* best effort */ }
        }
      }
    } else {
      console.warn(`rex-cli e2e: could not list sessions (${listed.reason}); sessions labelled e2e-${suffix}-* may remain: rex kill them by hand`);
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("prerequisites are present", (ctx) => {
    if (!harness.gate(ctx)) return;
    expect(prereq).toBeNull();
    expect(existsSync(dist)).toBe(true);
  });

  it("C1-C8: launch, status, inspect, focus, title, switch, dry run and flags on a switch", { timeout: 180_000 }, async (ctx) => {
    if (!harness.gate(ctx)) return;
    const one = name("one");
    const two = name("two");

    // C1 launch.
    const launched = summon([one]);
    expect(launched.status, launched.out).toBe(0);
    const record = readRecord(one);
    expect(record?.backend).toBe("rex");
    expect(record?.panes).toEqual(PANES);
    const sessionId = record!.rex!.sessionId;
    const launchId = record!.launchId!;
    expect(record!.rex!.server).toBe(server);
    const viewed = viewSession(cli, sessionId);
    expect(viewed.ok && viewed.view.label).toBe(one);
    expect(viewed.ok && viewed.view.windows[0]!.label).toBe(`[${one}]`);
    await until(() => {
      const files = existsSync(launchesDirOf(one)) ? readdirSync(launchesDirOf(one)) : [];
      return PANES.every((pane) => files.includes(`${launchId}.pane.${pane}`)) ? true : undefined;
    }, 8000, "the four pane files");

    // C2 status --once: one active; a registered project that was never launched has no record and shows
    // `unknown` with its directory (monitor behavior since 0c6afb1, see the guide §4 F5).
    const status = summon(["status", "--once"]);
    expect(status.status, status.out).toBe(0);
    contains(rowOf(status.stdout, one), /active/);
    contains(rowOf(status.stdout, two), /unknown\s+—\s+\//);

    // C3 inspect, text and JSON.
    const inspect = summon(["inspect", one]);
    expect(inspect.status, inspect.out).toBe(0);
    contains(inspect.stdout, `${one}: active (available, Rex)`);
    // Block id instead of a terminal id, the shell's pid from the server, and the tty never available under Rex.
    const editorLine = inspect.stdout.split("\n").find((line) => line.trim().startsWith("editor ")) ?? "";
    expect(editorLine.trim().split(/\s+/).slice(0, 5), editorLine).toEqual(["editor", record!.rex!.rootBlockId, "PID", expect.stringMatching(/^\d+$/), "UNAVAILABLE"]);
    const inspected = JSON.parse(summon(["inspect", one, "--json"]).stdout) as { backend: string; panes: Array<{ name: string; blockId?: string }> };
    expect(inspected.backend).toBe("rex");
    expect(inspected.panes.map((p) => p.name)).toEqual(PANES);
    expect(inspected.panes.find((p) => p.name === "editor")?.blockId).toBe(record!.rex!.rootBlockId);
    for (const pane of inspected.panes) expect(pane.blockId, pane.name).toMatch(/^block:/);

    // C4 focus a pane; an unknown pane name exits 2.
    const focused = summon(["focus", one, "sidebar"]);
    expect(focused.status, focused.out).toBe(0);
    const missing = summon(["focus", one, "nope"]);
    expect(missing.status, missing.out).toBe(2);
    contains(missing.stderr, `Unknown pane. Valid panes: editor, sidebar, right-1, shell. Run summon inspect ${one}.`);

    // C5 title: window label by default, a block label for a pane; reset restores both.
    expect(summon(["title", one, "--set", "Spell book"]).status).toBe(0);
    expect(windowLabel(sessionId)).toBe("Spell book");
    const read = summon(["title", one]);
    expect(read.status, read.out).toBe(0);
    contains(read.stdout, "Spell book");
    expect(summon(["title", one, "--reset"]).status).toBe(0);
    expect(windowLabel(sessionId)).toBe(`[${one}]`);
    expect(summon(["title", one, "sidebar", "--set", "Grimoire"]).status).toBe(0);
    expect(blockLabels(sessionId).has("Grimoire")).toBe(true);
    expect(summon(["title", one, "sidebar", "--reset"]).status).toBe(0);
    expect(blockLabels(sessionId).has("sidebar · sleep 300")).toBe(true);
    expect(blockLabels(sessionId).has("Grimoire")).toBe(false);

    // C6 relaunch switches; nothing new.
    const again = summon([one]);
    expect(again.status, again.out).toBe(0);
    expect(again.stderr).toContain(`Workspace [${one}] is already running in Rex; switched to it (use --new-window for a fresh one)`);
    expect(readRecord(one)!.launchId).toBe(launchId);
    expect(ownSessions(one)).toBe(1);

    // C7 dry run: the request, the note, no mutation.
    const before = viewSession(cli, sessionId);
    const dry = summon([one, "--dry-run"]);
    expect(dry.status, dry.out).toBe(0);
    contains(dry.stdout, "-- Backend: rex");
    contains(dry.stdout, '"initial_windows"');
    contains(dry.stdout, `-- Note: ${one} is recorded as a Rex workspace (${sessionId})`);
    const after = viewSession(cli, sessionId);
    expect(after.ok && before.ok && after.view.revision).toBe(before.ok ? before.view.revision : -1);
    expect(readRecord(one)!.launchId).toBe(launchId);

    // C8 flags Rex cannot honor on a switch: nothing is created, so nothing is printed (guide §4 F7);
    // the notices of a creation are checked in C15.
    const flagged = summon([one, "--maximize", "--float", "--fullscreen", "--font-size", "14"]);
    expect(flagged.status, flagged.out).toBe(0);
    contains(flagged.stderr, "switched to it");
    expect(flagged.stderr).not.toContain("Rex cannot honor");
    expect(readRecord(one)!.launchId).toBe(launchId);
  });

  it("C9-C11: clean refuses a live session, a kill outside Summon is reconciled on the next read", { timeout: 120_000 }, async (ctx) => {
    if (!harness.gate(ctx)) return;
    const one = name("one");
    const record = requireRecord(one);
    const sessionId = record.rex!.sessionId;
    const launchId = record.launchId!;

    // C9 refuse with panes alive.
    const refused = summon(["clean", one]);
    expect(refused.status, refused.out).toBe(2);
    // Pane names come in builder order (paneOrder), not display order.
    contains(refused.stderr, `[${one}] still has live panes (editor, right-1, shell, sidebar); not cleaned. Close them or run rex kill ${sessionId} yourself.`);
    expect(sessionExists(sessionId)).toBe(true);

    // C10 rex kill, then one status read reconciles.
    expect(cli.call("kill", ["kill", sessionId]).ok).toBe(true);
    await until(() => (sessionExists(sessionId) ? undefined : true), 5000, "session gone");
    const status = summon(["status", "--once"]);
    expect(status.status, status.out).toBe(0);
    contains(rowOf(status.stdout, one), /stopped/);
    contains(rowOf(status.stdout, one), "Rex session no longer exists");
    // `--once` prints the reconciliation notice under the row, on stdout.
    contains(status.stdout, "note: workspace ended outside Summon; snapshot saved ");
    expect(existsSync(join(home, ".config", "summon", "snapshots", `${one}.json`))).toBe(true);
    expect(readRecord(one)!.endedAt).toBeDefined();
    const left = existsSync(launchesDirOf(one)) ? readdirSync(launchesDirOf(one)).filter((f) => f.startsWith(launchId)) : [];
    expect(left).toEqual([]);
    const second = summon(["status", "--once"]);
    expect(second.out).not.toContain("workspace ended outside Summon");

    // C11 clean after the session is gone.
    const cleaned = summon(["clean", one]);
    expect(cleaned.status, cleaned.out).toBe(0);
    expect(cleaned.stdout).toContain(`Rex session for [${one}] is already gone; nothing to close.`);
  });

  it("C12: a workspace whose shells all exit ends (destroyed, or left empty and closed by clean); a real empty session is closed by clean", { timeout: 120_000 }, async (ctx) => {
    if (!harness.gate(ctx)) return;
    const two = name("two");
    expect(summon([two]).status).toBe(0);
    const launched = readRecord(two)!;
    const sessionId = launched.rex!.sessionId;
    const blocks = liveBlocks(sessionId);
    expect(blocks).toHaveLength(4);
    // Observed on Rex 0.0.1793131181-gdd9a20 (guide §4 F6): when every shell of a session shown in the app exits,
    // the session is usually destroyed within a few seconds, and sometimes stays as an empty session. Both are
    // legitimate ends; the read must report the one that happened. This branch is disjunctive on purpose: the
    // empty-session path is pinned unconditionally below (C12b). The interrupt flushes pending input, so "exit"
    // goes in a second write.
    const type = (blockId: string, data: string) => cli.call("block-call", ["block", "call", "-s", sessionId, "-b", blockId, "write", JSON.stringify({ data })]);
    for (const blockId of blocks) expect(type(blockId, "\u0003").ok).toBe(true);
    await sleep(1000);
    for (const blockId of blocks) expect(type(blockId, "exit\n").ok).toBe(true);
    await until(() => (liveBlocks(sessionId).length === 0 ? true : undefined), 10_000, "every shell to exit");
    let destroyed = false;
    try {
      await until(() => (sessionExists(sessionId) ? undefined : true), 5000, "destruction");
      destroyed = true;
    } catch { /* the session stayed, empty */ }
    const status = summon(["status", "--once"]);
    contains(rowOf(status.stdout, two), /stopped/);
    if (destroyed) {
      contains(rowOf(status.stdout, two), "Rex session no longer exists");
      contains(status.stdout, "note: workspace ended outside Summon");
    } else {
      contains(rowOf(status.stdout, two), "empty Rex session remains");
      const closed = summon(["clean", two]);
      expect(closed.status, closed.out).toBe(0);
      contains(closed.stdout, `Closed empty Rex session [${two}] (${sessionId}).`);
      expect(sessionExists(sessionId)).toBe(false);
    }
    expect(readRecord(two)!.endedAt).toBeDefined();

    // An empty session does exist when no app shows it: a session whose only program exited. Point the
    // record at one (same shape as the record a launch wrote) to exercise the P17 close on a real server.
    // `--shell none` starts the program directly (no login shell startup in the way); it exits at once.
    const made = execFileSync(binary, ["-S", server, "--autostart=false", "new", `${two}-empty`, "--json", "--shell", "none", "--", "/bin/sh", "-c", "exit 0"], { encoding: "utf8", timeout: 15_000 });
    const json = JSON.parse(made) as { session_id: string; initial_windows: Array<{ window_id: string; block_ids: string[] }> };
    const emptyId = json.session_id;
    await until(() => (liveBlocks(emptyId).length === 0 ? true : undefined), 15_000, "the probe program to exit");
    expect(sessionExists(emptyId)).toBe(true);
    const rootBlockId = json.initial_windows[0]!.block_ids[0]!;
    const rex = { ...launched.rex!, sessionId: emptyId, windowId: json.initial_windows[0]!.window_id, rootBlockId, blocks: [{ name: "editor", blockId: rootBlockId, label: "editor" }] };
    writeRecord(two, { ...launched, panes: ["editor"], endedAt: undefined, rex });
    const empty = summon(["status", "--once"]);
    contains(rowOf(empty.stdout, two), /stopped/);
    contains(rowOf(empty.stdout, two), "empty Rex session remains");
    // The read marks the record ended (the session is empty); the close itself is clean's job.
    expect(readRecord(two)!.endedAt).toBeDefined();
    const cleaned = summon(["clean", two]);
    expect(cleaned.status, cleaned.out).toBe(0);
    contains(cleaned.stdout, `Closed empty Rex session [${two}] (${emptyId}). Rex has no conditional destroy: anything added to it after the check was closed with it.`);
    expect(sessionExists(emptyId)).toBe(false);
  });

  it("C13-C14: --new-window leaves an earlier session for the orphan review; an unconfirmed launch is printed with its rm line", { timeout: 180_000 }, async (ctx) => {
    if (!harness.gate(ctx)) return;
    const three = name("three");
    expect(summon([three]).status).toBe(0);
    const first = readRecord(three)!.rex!.sessionId;
    const fresh = summon([three, "--new-window"]);
    expect(fresh.status, fresh.out).toBe(0);
    expect(fresh.stderr).toContain(`Rex shows [${three}] in the current window; --new-window opens a new session, not a new window`);
    const second = readRecord(three)!.rex!.sessionId;
    expect(second).not.toBe(first);
    expect(sessionExists(first)).toBe(true);

    // C13 the earlier session still has blocks: named, not touched.
    const review = summon(["clean", "--orphans", three]);
    expect(review.status, review.out).toBe(0);
    expect(review.out).toContain(`Rex session ${first} still has 4 blocks; close it yourself with: rex -S '${server}' kill ${first}`);
    expect(sessionExists(first)).toBe(true);
    expect(cli.call("kill", ["kill", first]).ok).toBe(true);
    await until(() => (sessionExists(first) ? undefined : true), 5000, "first session gone");
    const removed = summon(["clean", "--orphans", three]);
    expect(removed.status, removed.out).toBe(0);
    // Adoption runs before the review (clean.ts) and, with a live current record, removes the files of a launch
    // whose session is gone itself; the review then has nothing left to report.
    contains(removed.out, "removed the files of earlier launch ");
    contains(removed.out, " (its Rex session is gone)");
    contains(removed.out, `No earlier launches of [${three}] to review.`);

    // C14 a manifest that never confirmed its session: printed with the exact rm line, kept.
    const launchId = randomUUID();
    const manifestPath = join(launchesDirOf(three), `${launchId}.json`);
    writeFileSync(manifestPath, JSON.stringify({
      version: 1, launchId, project: three, directory: join(home, "projects", three), layout: "pair",
      panes: PANES, paneOrder: PANES, blockLabels: {}, backend: "rex", server, startedAt: new Date().toISOString(),
    }, null, 2) + "\n");
    const unconfirmed = summon(["clean", "--orphans", three]);
    expect(unconfirmed.status, unconfirmed.out).toBe(0);
    contains(unconfirmed.out, `launch ${launchId} of [${three}]`);
    expect(unconfirmed.out).toContain("never confirmed its session; left in place as evidence.");
    const rmLine = unconfirmed.out.split("\n").find((line) => line.includes("rm -f"))!;
    expect(rmLine).toMatch(/^\s*rm -f '[^']*'$/);
    expect(rmLine).toContain(basename(manifestPath));
    expect(existsSync(manifestPath)).toBe(true);
    expect(sessionExists(second)).toBe(true);
  });

  it("C8 and C15: flag notices on a creation; a record whose server is unreachable is unknown and only --new-window replaces it", { timeout: 120_000 }, (ctx) => {
    if (!harness.gate(ctx)) return;
    const four = name("four");
    // C8 (creation path): one notice per flag Rex cannot honor, and the launch continues.
    const created = summon([four, "--maximize", "--float", "--fullscreen", "--font-size", "14"]);
    expect(created.status, created.out).toBe(0);
    for (const flag of ["maximize", "float", "fullscreen", "font-size"]) contains(created.stderr, `Rex cannot honor ${flag}; ignored`);
    const record = readRecord(four)!;
    const first = record.rex!.sessionId;
    writeRecord(four, { ...record, rex: { ...record.rex!, server: DEAD_SERVER } });
    const status = summon(["status", "--once"]);
    contains(rowOf(status.stdout, four), /unknown/);
    const focus = summon(["focus", four]);
    expect(focus.status, focus.out).toBe(2);
    contains(focus.stderr, `[${four}] could not be verified`);
    const launch = summon([four]);
    expect(launch.status, launch.out).toBe(2);
    contains(launch.stderr, "could not be verified");
    expect(readRecord(four)!.rex!.sessionId).toBe(first);
    const replaced = summon([four, "--new-window"]);
    expect(replaced.status, replaced.out).toBe(0);
    const after = readRecord(four)!;
    expect(after.rex!.sessionId).not.toBe(first);
    expect(after.rex!.server).toBe(server);
    expect(sessionExists(after.rex!.sessionId)).toBe(true);
  });

  it("C16: a named session creates one Rex session per project and a dry run creates none", { timeout: 180_000 }, (ctx) => {
    if (!harness.gate(ctx)) return;
    const one = name("one");
    const two = name("two");
    expect(summon(["session", "add", "trio", one, two]).status).toBe(0);
    const before = { one: ownSessions(one), two: ownSessions(two) };
    const dry = summon(["session", "trio", "--dry-run"]);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.stdout.split("-- Backend: rex")).toHaveLength(3);
    expect({ one: ownSessions(one), two: ownSessions(two) }).toEqual(before);
    const run = summon(["session", "trio"]);
    expect(run.status, run.out).toBe(0);
    contains(run.stdout, `[1/2] Launched ${one}`);
    contains(run.stdout, `[2/2] Launched ${two}`);
    for (const project of [one, two]) {
      const record = readRecord(project)!;
      expect(record.backend).toBe("rex");
      expect(record.endedAt).toBeUndefined();
      expect(sessionExists(record.rex!.sessionId)).toBe(true);
    }
  });

  it("C17: doctor reports the Rex section from a Rex shell", { timeout: 60_000 }, (ctx) => {
    if (!harness.gate(ctx)) return;
    // The doctor report is written to stderr; its exit code reflects unrelated checks (ports, commands).
    // The app client line needs a labelled app (the prerequisite check only needs a connected one).
    const doctor = summon(["doctor"]);
    contains(doctor.out, "Checking Rex...");
    contains(doctor.out, `Rex CLI found at ${binary}`);
    contains(doctor.out, `Rex server reachable at ${server}`);
    expect(doctor.out).toMatch(/app client client:\S+ .* connected/);
    contains(doctor.out, "this shell launches in rex");
  });

  it("C18: the detection table through --dry-run", { timeout: 120_000 }, (ctx) => {
    if (!harness.gate(ctx)) return;
    const one = name("one");
    const backendOf = (env: Record<string, string | undefined>) => {
      const run = summon([one, "--dry-run"], { env });
      expect(run.status, run.out).toBe(0);
      return run.stdout.split("\n").find((line) => line.startsWith("-- Backend:"));
    };
    // Rows 3 and 5 fall through to Ghostty only when it is installed (else Rex, whose CLI is present).
    const fallback = ghosttyInstalled ? "-- Backend: ghostty" : "-- Backend: rex";
    expect(backendOf({ TERM_PROGRAM: "rex" })).toBe("-- Backend: rex");
    expect(backendOf({ TERM_PROGRAM: "ghostty" })).toBe("-- Backend: ghostty");
    expect(backendOf({ TERM_PROGRAM: "iTerm.app" })).toBe(fallback);
    expect(backendOf({ TERM_PROGRAM: undefined })).toBe("-- Backend: rex");
    expect(backendOf({ TERM_PROGRAM: undefined, REX_SERVER: DEAD_SERVER })).toBe(fallback);
  });

  it.todo("C19: summon open <project> (guide §4 F1: the command is a picker that ignores the argument; pinned once the owner decides)");
});
