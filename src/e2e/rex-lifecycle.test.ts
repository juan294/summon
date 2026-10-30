import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Rex lifecycle observations (plan D6, phase-5.md Step 0). Gated like rex-native:
 *   SUMMON_REX_E2E=1 runs (skips without prerequisites); SUMMON_REX_E2E_REQUIRED=1 fails instead.
 * Each observation runs in its own disposable session created by Summon and destroyed here.
 * The EXPECTED table holds the values observed on the owner's machine on 2026-10-29
 * (Rex 0.0.1793131181-gdd9a20, api revision 7); a later Rex build that behaves differently fails.
 */

const { destroySessions, rexGate, sleep, until, withRexEnv } = await import("./rex-harness.js");
const { discoverRex, createRexCli, defaultRexServer } = await import("../backends/rex/cli.js");
const { readStatusRecord, readStatus, clearStatus, resetReadAllStatusesCache } = await import("../status.js");
const { launchArtifactPaths, launchesDir } = await import("../launch-identity.js");
const { clearSnapshot } = await import("../snapshot.js");
const { launch } = await import("../launcher.js");
const harness = rexGate(process.env, "rex-lifecycle e2e");
const { prereq } = harness;

/** Observed on 2026-10-29. `trapFired` means the per-launch .pid and .active were removed within 2 s. */
const EXPECTED = {
  kill: { trapFired: true, state: "stopped" as const },
  rootBlockClose: { trapFired: true, state: "partial" as const },
  editorExit: { trapFired: false, state: "active" as const },
  userExit: { trapFired: true, state: "partial" as const },
  cliDisconnect: { trapFired: false, state: "active" as const },
};

describe("rex lifecycle observations (plan D6, Phase 5 step 0)", () => {
  it("prerequisites are present", (ctx) => {
    if (!harness.gate(ctx)) return;
    expect(prereq).toBeNull();
  });

  it("records what the per-launch trap and the state table do on kill, root close, editor exit, user exit and a CLI disconnect", { timeout: 240_000 }, async (ctx) => {
    if (!harness.gate(ctx)) return;
    const binary = discoverRex().path!;
    const server = defaultRexServer();
    const cli = createRexCli(binary, server);
    const root = mkdtempSync(join(tmpdir(), "summon-rex-lifecycle-"));
    const origLog = console.log;
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    console.log = () => {};
    process.stderr.write = (() => true) as typeof process.stderr.write;
    const created: Array<{ project: string; sessionId: string }> = [];
    const observed: Record<string, { trapFired: boolean; state: string; reason?: string }> = {};
    let cleanupFailures: string[];
    try {
      await withRexEnv(async () => {
      async function launchOne(name: string, editor = "sleep 300") {
        const project = `summon-e2e-${name}-${Math.random().toString(16).slice(2, 8)}`;
        const dir = join(root, project);
        mkdirSync(dir, { recursive: true });
        await launch(dir, { layout: "pair", editor, sidebar: "sleep 300", shell: "true", "no-project-config": "true" });
        const record = readStatusRecord(project)!;
        const identity = record.rex!;
        created.push({ project, sessionId: identity.sessionId });
        const paths = launchArtifactPaths(project, record.launchId!);
        // Every pane bootstrapped: the root token and the active marker exist.
        await until(() => (existsSync(paths.active) && existsSync(paths.pane("editor").file) ? true : undefined), 8000, `bootstrap of ${project}`);
        return { project, record, identity, paths };
      }
      const trapFiredWithin = async (paths: ReturnType<typeof launchArtifactPaths>, ms: number) => {
        try {
          await until(() => (!existsSync(paths.pid) && !existsSync(paths.active) ? true : undefined), ms, "trap");
          return true;
        } catch {
          return false;
        }
      };
      const stateOf = (project: string) => {
        resetReadAllStatusesCache();
        const status = readStatus(project)!;
        return { state: status.state, reason: status.reason };
      };

      // 1. rex kill with the trap installed.
      {
        const w = await launchOne("kill");
        expect(cli.call("kill", ["kill", w.identity.sessionId]).ok).toBe(true);
        const trapFired = await trapFiredWithin(w.paths, 2000);
        observed.kill = { trapFired, ...stateOf(w.project) };
      }
      // 2. rex block close on the root block only.
      {
        const w = await launchOne("rootclose");
        expect(cli.call("kill", ["block", "close", "-s", w.identity.sessionId, w.identity.rootBlockId]).ok).toBe(true);
        const trapFired = await trapFiredWithin(w.paths, 2000);
        await sleep(500);
        observed.rootBlockClose = { trapFired, ...stateOf(w.project) };
      }
      // 3. The editor exits normally: the shell stays, the trap stays armed.
      {
        const w = await launchOne("editorexit", "sleep 1");
        await sleep(3000);
        const trapFired = !existsSync(w.paths.pid) && !existsSync(w.paths.active);
        observed.editorExit = { trapFired, ...stateOf(w.project) };
      }
      // 4. The user types exit in the root shell (after its command returned the prompt).
      {
        const w = await launchOne("userexit", "sleep 1");
        await sleep(3000);
        expect(cli.call("block-call", ["block", "call", "-s", w.identity.sessionId, "-b", w.identity.rootBlockId, "write", JSON.stringify({ data: "exit\n" })]).ok).toBe(true);
        const trapFired = await trapFiredWithin(w.paths, 2000);
        await sleep(500);
        observed.userExit = { trapFired, ...stateOf(w.project) };
      }
      // 5. A CLI client attaches and exits.
      {
        const w = await launchOne("clidisconnect");
        expect(cli.call("block-call", ["block", "call", "-s", w.identity.sessionId, "-b", w.identity.rootBlockId, "process"]).ok).toBe(true);
        await sleep(1500);
        const trapFired = !existsSync(w.paths.pid) && !existsSync(w.paths.active);
        observed.cliDisconnect = { trapFired, ...stateOf(w.project) };
      }
      origLog(`OBSERVED ${JSON.stringify(observed)}`);
      for (const [name, expected] of Object.entries(EXPECTED)) {
        expect(observed[name], name).toMatchObject(expected);
      }
      // The state table's reasons for the closed cases.
      expect(observed.kill!.reason).toBe("Rex session no longer exists");
      expect(observed.rootBlockClose!.reason).toBe("root pane closed");
      expect(observed.userExit!.reason).toBe("root pane closed");
      });
    } finally {
      console.log = origLog;
      process.stderr.write = origStderrWrite;
      // Most of these sessions are already gone (killed or closed by the observation itself); the
      // rest are killed here and every one is proven absent (guide C20).
      cleanupFailures = await destroySessions(cli, created.map((c) => c.sessionId));
      for (const { project } of created) {
        try { clearStatus(project); } catch { /* best effort */ }
        try { clearSnapshot(project); } catch { /* best effort */ }
        rmSync(launchesDir(project), { recursive: true, force: true });
      }
      rmSync(root, { recursive: true, force: true });
    }
    expect(cleanupFailures, "lifecycle sessions not confirmed gone").toEqual([]);
  });
});
