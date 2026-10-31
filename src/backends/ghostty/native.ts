import { execFileSync } from "node:child_process";
import { escapeAppleScript } from "../../shell-escape.js";
import { probeGhosttyNative } from "./probe.js";
import { TERMINAL_ID_RE } from "./pane-inventory.js";
import { validateTitleText } from "../../ui/sanitize.js";
import type { FocusResult, NativeFailure, TitleOperation, TitleResult, TitleScope } from "../port.js";

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
  const wanted = [...new Set(ids.map((id) => id.toUpperCase()))]
    .map((id) => `"${escapeAppleScript(id)}"`)
    .join(", ");
  return (
    PRELUDE +
    `set wantedIds to {${wanted}}
set remainingCount to count of wantedIds
set resultValue to current application's NSMutableArray's array()
tell application "Ghostty"
  repeat with w in windows
    repeat with t in tabs of w
      set liveIds to id of every terminal of t
      repeat with wantedId in wantedIds
        if liveIds contains (wantedId as text) then
          set p to terminal id (wantedId as text)
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
          set remainingCount to remainingCount - 1
        end if
        if remainingCount is 0 then exit repeat
      end repeat
      if remainingCount is 0 then exit repeat
    end repeat
    if remainingCount is 0 then exit repeat
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
    `set wantedId to "${escapeAppleScript(terminalId.toUpperCase())}"
set targetFound to false
set resultValue to current application's NSMutableDictionary's dictionary()
resultValue's setObject:false forKey:"focused"
tell application "Ghostty"
  repeat with w in windows
    repeat with t in tabs of w
      set liveIds to id of every terminal of t
      if liveIds contains wantedId then
          set p to terminal id wantedId
          set targetFound to true
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
      if targetFound then exit repeat
    end repeat
    if targetFound then exit repeat
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
  const support = nativeSupport("foreground", app);
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
  const support = nativeSupport("identity", app);
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
  required: "identity" | "foreground" | "title",
  app?: string,
): NativeFailure | undefined {
  const capabilities = probeGhosttyNative(app);
  for (const capability of [
    capabilities.nativeIdentity,
    ...(required === "foreground" ? [capabilities.foreground] : required === "title" ? [capabilities.titleOverride] : []),
  ]) {
    if (capability.state !== "supported")
      return {
        kind: "unavailable",
        code: "unavailable",
        reason: `${capability.reason} ${RECOVERY}`,
      };
  }
}



export function generateTitleScript(
  terminalId: string,
  scope: TitleScope,
  operation: TitleOperation,
): string {
  validateIds([terminalId]);
  if (scope !== "tab" && scope !== "pane")
    throw new Error("Invalid title target scope.");
  if (operation.kind === "set") {
    const invalid = validateTitleText(operation.text);
    if (invalid) throw new Error(invalid);
  }
  const mutation =
    operation.kind === "read"
      ? ""
      : `set name override of titleTarget to "${escapeAppleScript(operation.kind === "reset" ? "" : operation.text)}"`;
  return (
    PRELUDE +
    `set wantedId to "${escapeAppleScript(terminalId.toUpperCase())}"
set targetFound to false
set resultValue to current application's NSMutableDictionary's dictionary()
resultValue's setObject:false forKey:"found"
tell application "Ghostty"
  repeat with w in windows
    repeat with t in tabs of w
      set liveIds to id of every terminal of t
      if liveIds contains wantedId then
        set p to terminal id wantedId
        set titleTarget to ${scope === "tab" ? "t" : "p"}
        ${mutation}
        resultValue's setObject:(name override of titleTarget as text) forKey:"override"
        resultValue's setObject:(id of p as text) forKey:"terminalId"
        resultValue's setObject:"${scope}" forKey:"scope"
        resultValue's setObject:true forKey:"found"
        set targetFound to true
      end if
      if targetFound then exit repeat
    end repeat
    if targetFound then exit repeat
  end repeat
end tell
` +
    JSON_RESULT
  );
}

export function titleTerminal(
  terminalId: string,
  scope: TitleScope,
  operation: TitleOperation,
  app?: string,
): TitleResult {
  const script = generateTitleScript(terminalId, scope, operation);
  const support = nativeSupport("title", app);
  if (support) return support;
  const response = runNativeScript(script);
  if (response.kind !== "available") {
    if (operation.kind === "read" || response.code === "permission")
      return response;
    return unknownTitleOutcome(response.code);
  }
  const value = response.value as {
    found?: unknown;
    terminalId?: unknown;
    scope?: unknown;
    override?: unknown;
  } | null;
  if (value?.found === false)
    return {
      kind: "unavailable",
      code: "missing",
      reason:
        "Exact native title target is closed or unavailable. Run summon inspect <project>; no title change was confirmed.",
    };
  if (
    value?.found === true &&
    value.terminalId === terminalId.toUpperCase() &&
    value.scope === scope &&
    typeof value.override === "string"
  ) {
    const expected =
      operation.kind === "reset"
        ? ""
        : operation.kind === "set"
          ? operation.text
          : undefined;
    if (expected === undefined || value.override === expected)
      return {
        kind: "title",
        terminalId: terminalId.toUpperCase(),
        scope,
        override: value.override,
      };
  }
  return operation.kind === "read"
    ? malformed()
    : unknownTitleOutcome("unavailable");
}

function unknownTitleOutcome(code: NativeFailure["code"]): NativeFailure {
  return {
    kind: "failed",
    code,
    reason:
      "Title change outcome is unknown. Read with summon title <project> [pane] or inspect before retrying; no automatic retry was made.",
  };
}
