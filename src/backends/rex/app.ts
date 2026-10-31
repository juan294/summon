import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { escapeControlChars, isDisplaySafe } from "../../ui/sanitize.js";
import { BUNDLE_NAMES } from "./cli.js";
import type { RexCli } from "./cli.js";
import type { RexFailure, RexResult } from "./types.js";

/**
 * Rex app clients (plan P7): deterministic choice of the app that shows a session, and the
 * open-and-wait fallback when none is connected.
 */

export interface AppClient {
  clientId: string;
  /** RFC 3339, as the server reports it. */
  connectedAt: string;
  /** `connected`, or `lost` while the server waits for a reconnect; a missing value counts as connected. */
  connectionState: string;
  label?: string;
  sessionIds: string[];
}

export interface AppClientChoice {
  chosen: AppClient;
  others: AppClient[];
}

/** Clock seam for the wait loop (tests inject a fake). */
export interface WaitClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const realClock: WaitClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  clock: WaitClock;
}

/** Poll `read` every `intervalMs` until it yields a value or the deadline would pass before the next read. */
export async function pollUntil<T>(read: () => T | undefined, options: PollOptions): Promise<T | undefined> {
  const deadline = options.clock.now() + options.timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (options.clock.now() + options.intervalMs > deadline) return undefined;
    await options.clock.sleep(options.intervalMs);
  }
}

/** App clients from a `client.list` answer: kind `app`; `lost` clients are dropped unless `includeLost`. */
export function parseAppClients(json: unknown, options: { includeLost?: boolean } = {}): AppClient[] {
  if (!json || typeof json !== "object") return [];
  const clients = (json as Record<string, unknown>)["clients"];
  if (!Array.isArray(clients)) return [];
  const result: AppClient[] = [];
  for (const item of clients as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const info = raw["info"];
    const kind = info && typeof info === "object" ? (info as Record<string, unknown>)["kind"] : undefined;
    const connectionState = typeof raw["connection_state"] === "string" ? raw["connection_state"] : "connected";
    if (kind !== "app" || (connectionState === "lost" && !options.includeLost)) continue;
    if (typeof raw["client_id"] !== "string" || typeof raw["connected_at"] !== "string") continue;
    // Server text: an id Summon could not pass back as one argv element is dropped, and display
    // text is escaped before it reaches the terminal (like errors, pane titles, program status).
    if (!isDisplaySafe(raw["client_id"]) || raw["client_id"].startsWith("-")) continue;
    const label = (info as Record<string, unknown>)["label"];
    const sessionIds = Array.isArray(raw["session_ids"]) ? (raw["session_ids"] as unknown[]).filter((id): id is string => typeof id === "string") : [];
    result.push({ clientId: raw["client_id"], connectedAt: raw["connected_at"], connectionState: escapeControlChars(connectionState), ...(typeof label === "string" ? { label: escapeControlChars(label) } : {}), sessionIds });
  }
  return result;
}

/** `client.list { kinds: ["app"] }` on the bound server (one call; callers filter by session). */
export function listAppClients(cli: RexCli, options: { includeLost?: boolean } = {}): { ok: true; clients: AppClient[] } | RexFailure {
  const result = cli.call("client-ls", ["api", "call", "client.list", "-"], { input: JSON.stringify({ kinds: ["app"] }) });
  if (!result.ok) return result;
  return { ok: true, clients: parseAppClients(result.json, options) };
}

/**
 * Plan P7: the apps attached to `preferSession` (the caller's `REX_SESSION`) when any, else every
 * app; within the set the newest `connected_at` wins and equal timestamps resolve to the
 * lexicographically smallest client id.
 */
export function chooseAppClient(all: readonly AppClient[], preferSession?: string): AppClientChoice | undefined {
  const attached = preferSession ? all.filter((c) => c.sessionIds.includes(preferSession)) : [];
  const candidates = attached.length > 0 ? attached : all;
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => {
    const byTime = Date.parse(b.connectedAt) - Date.parse(a.connectedAt);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
  });
  return { chosen: sorted[0]!, others: sorted.slice(1) };
}

/** Show a session (and window) in an app client: `rex -C <client> do session.select …`. */
export function selectInApp(cli: RexCli, clientId: string, sessionId: string, windowId?: string): RexResult {
  const argv = ["-C", clientId, "do", "session.select", `session_id=${sessionId}`];
  if (windowId) argv.push(`window_id=${windowId}`);
  argv.push("--json");
  return cli.call("do-select", argv);
}

/** One listing and the P7 choice; a failed listing counts as no client. */
export function pickAppClient(cli: RexCli, preferSession?: string): AppClientChoice | undefined {
  const listed = listAppClients(cli);
  return listed.ok ? chooseAppClient(listed.clients, preferSession) : undefined;
}

/** Poll `client.list` until an app client is connected or the deadline passes. */
export function waitForAppClient(cli: RexCli, preferSession: string | undefined, options: PollOptions): Promise<AppClientChoice | undefined> {
  return pollUntil(() => pickAppClient(cli, preferSession), options);
}

/** First installed Rex app bundle: /Applications first, then ~/Applications (same bundles as the CLI search). */
export function discoverRexApp(exists: (path: string) => boolean = existsSync, home: string = homedir()): string | null {
  for (const dir of ["/Applications", join(home, "Applications")]) {
    for (const name of BUNDLE_NAMES) {
      const candidate = join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** `open -a <bundle>`; false when launching failed (the caller reports and continues). */
export function openRexApp(bundlePath: string, exec: (file: string, args: string[], options: { stdio: "ignore"; timeout: number }) => unknown = execFileSync): boolean {
  try {
    exec("/usr/bin/open", ["-a", bundlePath], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
