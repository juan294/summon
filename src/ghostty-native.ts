import { execFileSync } from "node:child_process";
import { escapeAppleScript } from "./shell-escape.js";
import { probeGhosttyNative } from "./ghostty.js";
import { TERMINAL_ID_RE } from "./pane-inventory.js";

export interface NativePane {
  terminalId: string;
  pid: number | null;
  tty: string | null;
  title: string;
  directory: string;
  tabId: string;
  windowId: string;
  focused: boolean;
}
export interface NativeFailure {
  kind: "unavailable" | "failed";
  code: "permission" | "timeout" | "missing" | "unavailable";
  reason: string;
}
export type FocusResult =
  { kind: "focused"; terminalId: string } | NativeFailure;
export type InventoryResult =
  { kind: "available"; panes: NativePane[] } | NativeFailure;
const RECOVERY =
  "Run summon doctor; check System Settings > Privacy & Security > Automation and Accessibility, then retry.";
const PRELUDE =
  'use framework "Foundation"\nuse scripting additions\nif application "Ghostty" is not running then error "summon-not-running"\n';
const JSON_RESULT = `set dataBytes to current application's NSJSONSerialization's dataWithJSONObject:resultValue options:0 |error|:(missing value)
return (current application's NSString's alloc()'s initWithData:dataBytes encoding:(current application's NSUTF8StringEncoding)) as text`;

function validateIds(ids: string[]): void {
  if (ids.some((id) => !TERMINAL_ID_RE.test(id)))
    throw new Error("Invalid native terminal identity.");
}

/** Read-only JSON transport; no delimiter framing for native process-controlled strings. */
export function generateInventoryScript(ids: string[]): string {
  validateIds(ids);
  const wanted = ids
    .map((id) => `"${escapeAppleScript(id.toUpperCase())}"`)
    .join(", ");
  return (
    PRELUDE +
    `set wantedIds to {${wanted}}
set resultValue to current application's NSMutableArray's array()
tell application "Ghostty"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with p in terminals of t
        if wantedIds contains (id of p as text) then
          set entry to current application's NSMutableDictionary's dictionary()
          entry's setObject:(id of p as text) forKey:"terminalId"
          entry's setObject:(pid of p as integer) forKey:"pid"
          entry's setObject:(tty of p as text) forKey:"tty"
          entry's setObject:(name of p as text) forKey:"title"
          entry's setObject:(working directory of p as text) forKey:"directory"
          entry's setObject:(id of t as text) forKey:"tabId"
          entry's setObject:(id of w as text) forKey:"windowId"
          entry's setObject:((id of focused terminal of t as text) is (id of p as text)) forKey:"focused"
          resultValue's addObject:entry
        end if
      end repeat
    end repeat
  end repeat
end tell
` +
    JSON_RESULT
  );
}

/** Resolve the current container by UUID each time; tabs/windows are never persisted targets. */
export function generateNativeFocusScript(terminalId: string): string {
  validateIds([terminalId]);
  return (
    PRELUDE +
    `set resultValue to current application's NSMutableDictionary's dictionary()
resultValue's setObject:false forKey:"focused"
tell application "Ghostty"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with p in terminals of t
        if (id of p as text) is "${escapeAppleScript(terminalId.toUpperCase())}" then
          activate
          activate window w
          select tab t
          focus p
          repeat 10 times
            if (id of focused terminal of selected tab of front window as text) is (id of p as text) then
              resultValue's setObject:true forKey:"focused"
              resultValue's setObject:(id of p as text) forKey:"terminalId"
              exit repeat
            end if
            delay 0.05
          end repeat
        end if
      end repeat
    end repeat
  end repeat
end tell
` +
    JSON_RESULT
  );
}

/** One bounded attempt. Never automatically retry an action with unknown outcome. */
export function runNativeScript(
  script: string,
): { kind: "available"; value: unknown } | NativeFailure {
  try {
    const output = execFileSync("osascript", [], {
      input: script,
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
      killSignal: "SIGKILL",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (Buffer.byteLength(output) > 1024 * 1024) throw new Error("oversized");
    return { kind: "available", value: JSON.parse(output) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const timeout = (error as NodeJS.ErrnoException)?.code === "ETIMEDOUT";
    const permission = /-1743|-1719|not authorized|assistive access/i.test(
      message,
    );
    return {
      kind: "unavailable",
      code: timeout ? "timeout" : permission ? "permission" : "unavailable",
      reason: `${timeout ? "Native query timed out." : permission ? "Native permission unavailable." : "Native query unavailable; Ghostty must be running with scripting support."} ${RECOVERY}`,
    };
  }
}

export function readNativeInventory(
  ids: string[],
  app?: string,
): InventoryResult {
  const support = nativeSupport(true, app);
  if (support) return support;
  const response = runNativeScript(generateInventoryScript(ids));
  if (response.kind !== "available") return response;
  if (!Array.isArray(response.value)) return malformed();
  const panes: NativePane[] = [];
  const seen = new Set<string>();
  for (const raw of response.value as unknown[]) {
    if (!raw || typeof raw !== "object") return malformed();
    const p = raw as Record<string, unknown>;
    if (
      typeof p.terminalId !== "string" ||
      !TERMINAL_ID_RE.test(p.terminalId) ||
      typeof p.pid !== "number" ||
      !Number.isInteger(p.pid) ||
      p.pid < 0 ||
      typeof p.tty !== "string" ||
      typeof p.title !== "string" ||
      typeof p.directory !== "string" ||
      typeof p.tabId !== "string" ||
      typeof p.windowId !== "string" ||
      typeof p.focused !== "boolean"
    )
      return malformed();
    const terminalId = p.terminalId.toUpperCase();
    if (
      !ids.some((id) => id.toUpperCase() === terminalId) ||
      seen.has(terminalId)
    )
      return malformed();
    seen.add(terminalId);
    panes.push({
      terminalId,
      pid: p.pid === 0 ? null : p.pid,
      tty: p.tty || null,
      title: p.title,
      directory: p.directory,
      tabId: p.tabId,
      windowId: p.windowId,
      focused: p.focused,
    });
  }
  return { kind: "available", panes };
}
function malformed(): NativeFailure {
  return {
    kind: "unavailable",
    code: "unavailable",
    reason: `Invalid native response. ${RECOVERY}`,
  };
}

export function focusTerminal(terminalId: string, app?: string): FocusResult {
  const support = nativeSupport(false, app);
  if (support) return support;
  const response = runNativeScript(generateNativeFocusScript(terminalId));
  if (response.kind !== "available") return response;
  const value = response.value as {
    focused?: unknown;
    terminalId?: unknown;
  } | null;
  if (value?.focused === true && value.terminalId === terminalId.toUpperCase())
    return { kind: "focused", terminalId: terminalId.toUpperCase() };
  if (value?.focused === false)
    return {
      kind: "unavailable",
      code: "missing",
      reason:
        "Exact native pane is unavailable or closed. Run summon inspect; select it in Ghostty or explicitly relaunch when ready to capture identity.",
    };
  return { ...malformed(), kind: "failed" };
}

function nativeSupport(
  foreground: boolean,
  app?: string,
): NativeFailure | undefined {
  const capabilities = probeGhosttyNative(app);
  for (const capability of [
    capabilities.nativeIdentity,
    ...(foreground ? [capabilities.foreground] : []),
  ]) {
    if (capability.state !== "supported")
      return {
        kind: "unavailable",
        code: "unavailable",
        reason: `${capability.reason} ${RECOVERY}`,
      };
  }
}
