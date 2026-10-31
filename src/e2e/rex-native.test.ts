import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Rex end-to-end suite (plan §5, phase-3.md deliverable 9). Gated:
 *   SUMMON_REX_E2E=1           run; skip with a printed reason when a prerequisite is missing
 *   SUMMON_REX_E2E_REQUIRED=1  run; a missing prerequisite is a failure (phase acceptance mode)
 * It creates sessions labelled `summon-e2e-<suffix>` on the local server and destroys only those.
 */

const { destroySessions, removeStatusFiles, rexGate, rexWindowCount, until } = await import("./rex-harness.js");
const { discoverRex, createRexCli, defaultRexServer } = await import("../backends/rex/cli.js");
const { listSessions, viewSession } = await import("../backends/rex/status.js");
const { readStatusRecord } = await import("../status.js");
const { launchArtifactPaths, launchesDir } = await import("../launch-identity.js");
const { launch } = await import("../launcher.js");

const harness = rexGate(process.env, "rex-native e2e", { window: true });
const { prereq } = harness;

function splitDirections(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  const split = (node as Record<string, unknown>)["split"] as Record<string, unknown> | undefined;
  if (split) {
    out.push(String(split["direction"]));
    splitDirections(split["before"], out);
    splitDirections(split["after"], out);
  }
  return out;
}

describe("rex native e2e", () => {
  it("prerequisites are present", (ctx) => {
    if (!harness.gate(ctx)) return;
    expect(prereq).toBeNull();
  });

  it("creates, proves ownership through the pane files, switches on relaunch, keeps a dry run read-only and handles --new-window", { timeout: 120_000 }, async (ctx) => {
    if (!harness.gate(ctx)) return;
    const binary = discoverRex().path!;
    const server = defaultRexServer();
    const cli = createRexCli(binary, server);
    const suffix = Math.random().toString(16).slice(2, 10);
    const project = `summon-e2e-${suffix}`;
    const root = mkdtempSync(join(tmpdir(), "summon-rex-e2e-"));
    const dir = join(root, project);
    const zdot = join(root, "zdot");
    const onStartLog = join(root, "onstart.log");
    const onStart = join(root, "onstart.sh");
    const sessions: string[] = [];
    const savedEnv = { ...process.env };
    const logSpy: string[] = [];
    const stderrSpy: string[] = [];
    let cleanupFailures: string[];
    const origLog = console.log;
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    console.log = (...args: unknown[]) => { logSpy.push(args.map(String).join(" ")); };
    process.stderr.write = ((chunk: unknown) => { stderrSpy.push(String(chunk)); return origStderrWrite(String(chunk)); }) as typeof process.stderr.write;
    try {
      mkdirSync(dir, { recursive: true });
      mkdirSync(zdot, { recursive: true });
      writeFileSync(onStart, `#!/bin/sh\nprintf 'start\\n' >> ${JSON.stringify(onStartLog)}\n`);
      chmodSync(onStart, 0o755);
      // Startup-file proof: zsh reads .zshenv before anything else, so the variables must already exist.
      writeFileSync(join(zdot, ".zshenv"), `print -r -- "$SUMMON_WORKSPACE|$SUMMON_LAUNCH_ID|$SUMMON_TAB_TITLE" >> ${JSON.stringify(join(zdot, "startup.log"))}\n`);
      process.env.TERM_PROGRAM = "rex";
      delete process.env.REX_SESSION;
      delete process.env.REX_BLOCK;
      delete process.env.REX_SERVER;
      delete process.env.SUMMON_WORKSPACE;
      process.env.SHELL = "/bin/zsh";
      const overrides = { layout: "pair", editor: "sleep 300", sidebar: "sleep 300", shell: "true", "on-start": onStart, env: [`ZDOTDIR=${zdot}`], "no-project-config": "true" };

      // 1. Create.
      const before = listSessions(cli);
      expect(before.ok).toBe(true);
      await launch(dir, overrides);
      const record = readStatusRecord(project);
      expect(record?.backend).toBe("rex");
      expect(record?.rex).toBeDefined();
      const identity = record!.rex!;
      const launchId = record!.launchId!;
      sessions.push(identity.sessionId);
      expect(identity.server).toBe(server);
      expect(record!.panes).toEqual(["editor", "sidebar", "right-1", "shell"]);

      // session.view: labels, count, directions.
      const viewed = viewSession(cli, identity.sessionId);
      expect(viewed.ok).toBe(true);
      if (!viewed.ok) return;
      expect(viewed.view.label).toBe(project);
      expect(viewed.view.windows[0]!.label).toBe(`[${project}]`);
      expect(viewed.view.windows[0]!.blockIds).toHaveLength(4);
      const raw = cli.call("session-view", ["api", "call", "session.view", "-"], { input: JSON.stringify({ session_id: identity.sessionId }) });
      expect(raw.ok).toBe(true);
      const layout = ((raw as { json: Record<string, unknown> }).json["windows"] as Array<Record<string, unknown>>)[0]!["layers"] as Array<Record<string, unknown>>;
      expect(splitDirections(layout[0]!["layout"])).toEqual(["horizontal", "horizontal", "vertical"]);
      const labelsInView = new Set(layout.flatMap((layer) => (layer["blocks"] as Array<Record<string, unknown>>).map((b) => String(b["label"]))));
      expect(labelsInView).toEqual(new Set(["editor · sleep 300", "editor · sleep 300", "shell", "sidebar · sleep 300"]));

      // 2. Manifest and the panes' own files (within 8 s), the active marker, no .tmp.
      const paths = launchArtifactPaths(project, launchId);
      expect(existsSync(paths.manifest)).toBe(true);
      const blockOf = new Map(identity.blocks.map((b) => [b.name, b.blockId]));
      expect([...blockOf.keys()].sort()).toEqual(["editor", "right-1", "shell", "sidebar"]);
      for (const name of blockOf.keys()) {
        const lines = await until(() => (existsSync(paths.pane(name).file) ? readFileSync(paths.pane(name).file, "utf-8").split("\n") : undefined), 8000, `pane file ${name}`);
        expect(lines[0]).toBe(identity.sessionId);
        expect(lines[1]).toBe(blockOf.get(name));
      }
      expect(readFileSync(paths.active, "utf-8").trim()).toBe(launchId);
      expect(readdirSync(launchesDir(project)).filter((f) => f.endsWith(".tmp"))).toEqual([]);

      // 3. Startup-file proof: every pane's zsh saw the variables while reading .zshenv.
      const startup = await until(() => {
        const file = join(zdot, "startup.log");
        if (!existsSync(file)) return undefined;
        const lines = readFileSync(file, "utf-8").trim().split("\n");
        return lines.length >= 4 ? lines : undefined;
      }, 8000, "four startup lines");
      for (const line of startup) expect(line).toBe(`1|${launchId}|${project}`);
      expect(readFileSync(onStartLog, "utf-8")).toBe("start\n");

      // 4. Relaunch switches: select performed, no new session, on-start not rerun, record unchanged.
      stderrSpy.length = 0;
      await launch(dir, overrides);
      expect(stderrSpy.join("")).toContain(`Workspace [${project}] is already running in Rex; switched to it`);
      // Only this project's sessions count: other suites (or the owner) may create sessions on the same server meanwhile.
      const after = listSessions(cli);
      const own = (listing: typeof after) => (listing.ok ? listing.sessions.filter((s) => s.label === project).length : -1);
      expect(own(after)).toBe(own(before) + 1);
      expect(readStatusRecord(project)!.launchId).toBe(launchId);
      expect(readFileSync(onStartLog, "utf-8")).toBe("start\n");

      // 5. Dry run with the live record: prints the request, mutates nothing.
      const revisionBefore = viewSession(cli, identity.sessionId);
      logSpy.length = 0;
      await launch(dir, { ...overrides, dryRun: true });
      const printed = logSpy.join("\n");
      expect(printed).toContain("-- Backend: rex");
      expect(printed).toContain(`-- Note: ${project} is recorded as a Rex workspace (${identity.sessionId})`);
      expect(printed).toContain('"initial_windows"');
      const revisionAfter = viewSession(cli, identity.sessionId);
      expect(revisionAfter.ok && revisionBefore.ok && revisionAfter.view.revision).toBe(revisionBefore.ok ? revisionBefore.view.revision : -1);
      expect(readStatusRecord(project)!.launchId).toBe(launchId);

      // 6. --new-window (P9 fallback): a fresh session, shown in the current window, no new app window.
      const windowsBefore = rexWindowCount();
      stderrSpy.length = 0;
      await launch(dir, { ...overrides, "new-window": "true" });
      const second = readStatusRecord(project)!;
      expect(second.launchId).not.toBe(launchId);
      expect(second.rex!.sessionId).not.toBe(identity.sessionId);
      sessions.push(second.rex!.sessionId);
      expect(stderrSpy.join("")).toContain(`Rex shows [${project}] in the current window; --new-window opens a new session, not a new window`);
      await new Promise((r) => setTimeout(r, 1000));
      expect(rexWindowCount().count).toBe(windowsBefore.count);
      const listed = listSessions(cli);
      expect(listed.ok && listed.sessions.some((s) => s.sessionId === second.rex!.sessionId)).toBe(true);
    } finally {
      console.log = origLog;
      process.stderr.write = origStderrWrite;
      // The suite's own sessions must be proven gone (guide C20): a kill the server rejected or a
      // session still listed fails the test instead of leaving it for the owner to find.
      cleanupFailures = await destroySessions(cli, sessions);
      removeStatusFiles(project);
      rmSync(launchesDir(project), { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env, savedEnv);
    }
    expect(cleanupFailures, `sessions of ${project} not confirmed gone`).toEqual([]);
  });
});
