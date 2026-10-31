import { spawn } from "node:child_process";
import type { LaunchContext } from "../../backend.js";
import { markAttention, needsAttention, resetAttentionForTests, watchForAttention } from "../../ui/attention.js";
import { debugLog } from "../../utils.js";
import { createRexCli } from "./cli.js";
import type { RexCli } from "./cli.js";
import { viewSession } from "./status.js";
import { asRecord, isKindId } from "./types.js";

/**
 * D1 (owner decision 2026-10-31): a launch from inside Rex opens the workspace in its own session,
 * so the tab the user typed `summon` in would stay behind (Ghostty reused that tab). After a
 * successful launch or switch, that tab is closed once the process exits with status 0, when it
 * holds only the caller's pane, is not a workspace tab (`[<project>]`) and has this Summon as its
 * foreground program (typed at the prompt, not run by an agent or a script in that pane). A tab
 * with splits is never touched. When the tab is its session's last, the whole session is ended (`rex kill`), as the
 * owner chose: closing only the tab leaves an empty session in the app's sidebar once the app shows another one.
 */
export interface LauncherTab {
  sessionId: string;
  windowId: string;
  /** The caller's pane, the tab's only block. */
  blockId: string;
}

/** BE-L5: the exit-time probes hold the user's prompt, so a slow server keeps the tab instead of delaying the exit. */
export const EXIT_PROBE_TIMEOUT_MS = 2000;

/** The caller's tab when it is a bare launcher: one pane (the caller's), not a workspace tab, Summon in the foreground. */
export function findLauncherTab(rexCli: RexCli, env: NodeJS.ProcessEnv = process.env, pid: number = process.pid): LauncherTab | undefined {
  const sessionId = env["REX_SESSION"];
  const blockId = env["REX_BLOCK"];
  if (!isKindId(sessionId, "session") || !isKindId(blockId, "block")) return;
  // A probe that fails or times out keeps the tab.
  const cli: RexCli = { ...rexCli, call: (op, argv, opts) => rexCli.call(op, argv, { ...opts, timeoutMs: EXIT_PROBE_TIMEOUT_MS }) };
  const viewed = viewSession(cli, sessionId);
  if (!viewed.ok) return;
  const window = viewed.view.windows.find((w) => w.blockIds.includes(blockId));
  if (!window || window.blockIds.length !== 1 || /^\[.+\]$/.test(window.label)) return;
  // An agent (Claude Code, Codex) or a script running Summon is the foreground program, not Summon: its tab stays.
  const processInfo = cli.call("block-call", ["block", "call", "-s", sessionId, "-b", blockId, "process"]);
  const foreground = processInfo.ok ? asRecord(asRecord(processInfo.json)?.["foreground"]) : undefined;
  if (foreground?.["pid"] !== pid) return;
  return { sessionId, windowId: window.windowId, blockId };
}

export interface LauncherTabDeps {
  find: () => LauncherTab | undefined;
  onExit: (handler: (code: number) => void) => void;
  spawnDetached: (binary: string, args: string[]) => void;
  needsAttention: () => boolean;
  env: NodeJS.ProcessEnv;
}

let armed = false;

/** @internal test hook */
export function resetLauncherTabForTests(): void {
  armed = false;
  resetAttentionForTests();
}

// The D1 stderr watch is generic (ui/attention.ts); re-exported for the launcher-tab callers and tests.
export { markAttention, needsAttention, watchForAttention };

/**
 * BE-L5: the close runs detached, 0.3 s after Summon exits (the shell must be back at its prompt first), and decides
 * again from a fresh `session.view`: the tab must still hold only the caller's pane, and the session is ended only
 * when that tab is still its only one, so a tab or a split added since the exit-time check survives. A failed or slow
 * view closes nothing. Each rex call carries `--timeout`. The ids arrive as argv words, never inside the source.
 */
const DETACHED_CLOSE_SOURCE = [
  'const { execFileSync } = require("node:child_process");',
  "const [rex, server, session, win, block] = process.argv.slice(1);",
  'const rexCall = (args, input) => execFileSync(rex, ["--color", "never", "--timeout", "2s", "--autostart=false", "-S", server, ...args], { input, encoding: "utf8", timeout: 4000, killSignal: "SIGKILL", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"] });',
  "setTimeout(() => {",
  "  try {",
  '    const windows = JSON.parse(rexCall(["api", "call", "session.view", "-"], JSON.stringify({ session_id: session }))).windows;',
  "    const blocks = windows.find((w) => w.window_id === win).layers.flatMap((l) => (l.blocks ?? []).map((b) => b.block_id));",
  "    if (blocks.length !== 1 || blocks[0] !== block) return;",
  '    rexCall(windows.length === 1 ? ["kill", session] : ["window", "close", "-s", session, win]);',
  "  } catch {}",
  "}, 300);",
].join("\n");

/** @internal exported for tests: the `node` arguments of the detached close. */
export function detachedCloseArgs(context: { rexBinary: string; server: string }, tab: LauncherTab): string[] {
  return ["-e", DETACHED_CLOSE_SOURCE, "--", context.rexBinary, context.server, tab.sessionId, tab.windowId, tab.blockId];
}

/**
 * Arrange (once per process) for the launcher tab to close when Summon exits with status 0 and printed nothing the
 * user must read (a note, a warning, an error, a skipped project). The tab is looked up at exit, not when armed, so a
 * split added during a long `summon session` keeps it. A pane of a Summon workspace (`SUMMON_WORKSPACE`) never closes.
 */
export function closeLauncherTabOnExit(context: { rexBinary: string; server: string }, deps?: Partial<LauncherTabDeps>): void {
  if (armed) return;
  armed = true;
  const find = deps?.find ?? (() => findLauncherTab(createRexCli(context.rexBinary, context.server)));
  const onExit = deps?.onExit ?? ((handler) => { process.once("exit", handler); });
  const spawnDetached = deps?.spawnDetached ?? ((binary, args) => { spawn(binary, args, { detached: true, stdio: "ignore" }).unref(); });
  const attention = deps?.needsAttention ?? needsAttention;
  const env = deps?.env ?? process.env;
  onExit((code) => {
    if (code !== 0 || attention() || env["SUMMON_WORKSPACE"]) return;
    const tab = find();
    if (!tab) return;
    debugLog(`closing launcher tab ${tab.windowId}`);
    spawnDetached(process.execPath, detachedCloseArgs(context, tab));
  });
}

function insideRex(context: LaunchContext): context is Extract<LaunchContext, { backend: "rex" }> {
  return context.backend === "rex" && context.placement === "inside-rex";
}

/** Start the stderr watch for a Rex launch made from inside Rex; any other backend or placement does nothing. */
export function startLauncherTabWatch(context: LaunchContext): void {
  if (insideRex(context)) watchForAttention();
}

/** A Rex launch or switch made from inside Rex closes its launcher tab on a successful exit; any other backend or placement does nothing. */
export function closeLauncherTabAfterRexLaunch(context: LaunchContext, deps?: Partial<LauncherTabDeps>): void {
  if (insideRex(context)) closeLauncherTabOnExit({ rexBinary: context.rexBinary, server: context.server }, deps);
}
