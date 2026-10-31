import { spawn } from "node:child_process";
import type { LaunchContext } from "../../backend.js";
import { writingRoutine } from "../../ui/output.js";
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
  /** The session's only tab: ending the session is what closing it means. */
  lastTab: boolean;
}

/** The caller's tab when it is a bare launcher: one pane (the caller's), not a workspace tab, Summon in the foreground. */
export function findLauncherTab(cli: RexCli, env: NodeJS.ProcessEnv = process.env, pid: number = process.pid): LauncherTab | undefined {
  const sessionId = env["REX_SESSION"];
  const blockId = env["REX_BLOCK"];
  if (!isKindId(sessionId, "session") || !isKindId(blockId, "block")) return;
  const viewed = viewSession(cli, sessionId);
  if (!viewed.ok) return;
  const window = viewed.view.windows.find((w) => w.blockIds.includes(blockId));
  if (!window || window.blockIds.length !== 1 || /^\[.+\]$/.test(window.label)) return;
  // An agent (Claude Code, Codex) or a script running Summon is the foreground program, not Summon: its tab stays.
  const processInfo = cli.call("block-call", ["block", "call", "-s", sessionId, "-b", blockId, "process"]);
  const foreground = processInfo.ok ? asRecord(asRecord(processInfo.json)?.["foreground"]) : undefined;
  if (foreground?.["pid"] !== pid) return;
  return { sessionId, windowId: window.windowId, lastTab: viewed.view.windows.length === 1 };
}

export interface LauncherTabDeps {
  find: () => LauncherTab | undefined;
  onExit: (handler: (code: number) => void) => void;
  spawnDetached: (binary: string, args: string[]) => void;
  needsAttention: () => boolean;
  env: NodeJS.ProcessEnv;
}

let armed = false;
let watching = false;
let attention = false;

/** @internal test hook */
export function resetLauncherTabForTests(): void {
  armed = false;
  watching = false;
  attention = false;
}

/**
 * QA-M3: flag the watch for output it cannot see: a child that inherited stdio (the on-start hook, an installer) writes
 * to the terminal directly, so the tab stays for the user to read it. Without a watch (Ghostty, Rex from another terminal)
 * nothing changes.
 */
export function markAttention(): void {
  if (watching) attention = true;
}

/** Whether anything other than output marked routine reached stderr since the watch started. */
export function needsAttention(): boolean {
  return attention;
}

/**
 * Watch stderr from the start of a Rex launch made inside Rex: a note, a warning, an error or a skipped project
 * keeps the launcher tab open, so nothing the user must read disappears with it. Unknown output keeps the tab.
 */
export function watchForAttention(stream: NodeJS.WriteStream = process.stderr): void {
  if (watching) return;
  watching = true;
  const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    // D1: a write its source marked routine (note/err with `{ routine: true }`) and blank output pass; anything else is for the user.
    if (!writingRoutine() && text.trim() !== "") attention = true;
    return write(chunk, ...rest);
  }) as NodeJS.WriteStream["write"];
}

/** @internal exported for tests: the shell must be back at its prompt before its tab closes, so a short delay, detached. */
export function spawnAfterExit(binary: string, args: string[], spawnFn: typeof spawn = spawn): void {
  spawnFn("/bin/sh", ["-c", 'sleep 0.3; exec "$@"', "sh", binary, ...args], { detached: true, stdio: "ignore" }).unref();
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
  const spawnDetached = deps?.spawnDetached ?? ((binary, args) => spawnAfterExit(binary, args));
  const attention = deps?.needsAttention ?? needsAttention;
  const env = deps?.env ?? process.env;
  onExit((code) => {
    if (code !== 0 || attention() || env["SUMMON_WORKSPACE"]) return;
    const tab = find();
    if (!tab) return;
    debugLog(`closing launcher tab ${tab.windowId}`);
    const close = tab.lastTab ? ["kill", tab.sessionId] : ["window", "close", "-s", tab.sessionId, tab.windowId];
    spawnDetached(context.rexBinary, ["--color", "never", "--autostart=false", "-S", context.server, ...close]);
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
