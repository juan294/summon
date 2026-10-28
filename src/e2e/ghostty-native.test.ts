import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverGhostty, probeGhosttyNative } from "../ghostty.js";
import { readNativeInventory, focusTerminal } from "../ghostty-native.js";
import { generateAppleScript, generateTreeAppleScript } from "../script.js";
import { planLayout } from "../layout.js";
import { buildTreePlan, parseTreeDSL } from "../tree.js";
import type { NativeMetadata } from "../pane-inventory.js";
import {
  traditionalInventory,
  treeInventory,
  parseNativeCapture,
  TERMINAL_ID_RE,
} from "../pane-inventory.js";
import { escapeAppleScript, shellQuote } from "../shell-escape.js";

type NativeMode = "off" | "advisory" | "required";
export function resolveNativeMode(env: NodeJS.ProcessEnv): NativeMode {
  return env.SUMMON_NATIVE_E2E_REQUIRED
    ? "required"
    : env.SUMMON_NATIVE_E2E
      ? "advisory"
      : "off";
}
const mode = resolveNativeMode(process.env);
function run(script: string): string {
  return execFileSync("osascript", [], {
    input: script,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
}

/** Read-only ownership recovery. Never select, activate, close, or change user terminals. */
function terminalDirectories(): Array<{
  terminalId: string;
  directory: string;
  windowId: string;
  pid: number;
}> {
  return JSON.parse(
    run(`use framework "Foundation"
use scripting additions
if application "Ghostty" is not running then error "summon-not-running"
set rows to current application's NSMutableArray's array()
tell application "Ghostty"
 repeat with w in windows
  set liveIds to id of every terminal of w
  set liveDirectories to working directory of every terminal of w
  set livePids to pid of every terminal of w
  set windowId to id of w as text
  if (count of liveIds) is not (count of liveDirectories) or (count of liveIds) is not (count of livePids) then error "inconsistent-native-inventory"
  repeat with i from 1 to count of liveIds
   set entry to current application's NSMutableDictionary's dictionary()
   entry's setObject:((item i of liveIds) as text) forKey:"terminalId"
   entry's setObject:((item i of liveDirectories) as text) forKey:"directory"
   entry's setObject:windowId forKey:"windowId"
   entry's setObject:((item i of livePids) as integer) forKey:"pid"
   rows's addObject:entry
  end repeat
 end repeat
end tell
set dataBytes to current application's NSJSONSerialization's dataWithJSONObject:rows options:0 |error|:(missing value)
return (current application's NSString's alloc()'s initWithData:dataBytes encoding:(current application's NSUTF8StringEncoding)) as text`),
  ) as Array<{
    terminalId: string;
    directory: string;
    windowId: string;
    pid: number;
  }>;
}
async function eventually(check: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(
        "Native fixture readback timed out; run summon doctor and retry required native E2E.",
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
function exactTerminal(id: string): string {
  if (!TERMINAL_ID_RE.test(id)) throw new Error("Invalid owned fixture UUID");
  return `terminal id "${escapeAppleScript(id)}"`;
}

type VisibilityTraceEvent = { tag: string; status?: number; at: number };

/** Event order is authoritative; timestamps only describe the observed advisory span. */
function inspectHiddenSpan(events: VisibilityTraceEvent[]): { complete: boolean; durationMs: number | null } {
  const hidden = events.findIndex(event => event.tag === "visibility" && event.status === 2);
  if (hidden < 0) return { complete: false, durationMs: null };
  const visible = events.findIndex((event, index) => index > hidden && event.tag === "visibility" && event.status === 1);
  if (events.slice(hidden + 1, visible < 0 ? undefined : visible).some(event => event.tag === "frame")) {
    throw new Error("Frame emitted while terminal reported hidden");
  }
  if (visible < 0) return { complete: false, durationMs: null };
  const durationMs = events[visible]!.at - events[hidden]!.at;
  return { complete: true, durationMs };
}

/** Actual monitor under an owned terminal PTY; HOME and all status files are disposable. */
async function checkMonitorVisibility(dir: string, root: string, recover: () => void): Promise<void> {
  const home = join(dir, "monitor-home");
  const bundle = join(dir, "monitor-bundle");
  const statusDir = join(home, ".config/summon/status");
  mkdirSync(statusDir, { recursive: true });
  writeFileSync(join(home, ".config/summon/config"), "");
  writeFileSync(join(home, ".config/summon/projects"), `native-monitor=${dir}\n`);
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  execFileSync("pnpm", ["exec", "tsup", "src/monitor.ts", "src/monitor-input.ts", "--format", "esm", "--out-dir", bundle], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  const statePath = join(dir, "visibility-state.json");
  const childPath = join(dir, "visibility-child.mjs");
  writeFileSync(childPath, `import {writeFileSync,renameSync} from 'node:fs';
import {runMonitor} from './monitor-bundle/monitor.js';
import {createMonitorInputDecoder} from './monitor-bundle/monitor-input.js';
const statePath=${JSON.stringify(statePath)};
const state={childPid:process.pid,reports:[],events:[],fallback:false,startedAt:Date.now(),frames:0,initialMode:null,finalMode:null,ready:false,done:false};
const save=()=>{writeFileSync(statePath+'.tmp',JSON.stringify(state));renameSync(statePath+'.tmp',statePath);};
save();
const original=process.stdout.write.bind(process.stdout);
process.stdout.write=(bytes,...args)=>{const text=String(bytes);for(const [tag,wire] of [['query','\\x1b[?2033$p'],['enable','\\x1b[?2033h'],['disable','\\x1b[?2033l']])if(text===wire){state.events.push({tag,at:Date.now()-state.startedAt});save();}if(text.includes('Visibility unavailable')){state.fallback=true;save();}if(text.includes('\\x1b[H')){state.events.push({tag:'frame',at:Date.now()-state.startedAt});state.frames++;save();}return original(bytes,...args);};
const reportDecoder=createMonitorInputDecoder();
process.stdin.on('data',bytes=>{for(const event of reportDecoder.push(bytes,Date.now())){if(event.type!=='key'){state.events.push({tag:event.type,status:event.status,at:Date.now()-state.startedAt});if(event.type==='visibility')state.reports.push(event.status);save();}}});
const mode=()=>new Promise((resolve,reject)=>{let pending='';const timer=setTimeout(()=>{process.stdin.off('data',listen);reject(new Error('mode query timed out'));},2000);const listen=bytes=>{pending=(pending+bytes).slice(-256);const match=/\\x1b\\[\\?2033;(\\d+)\\$y/.exec(pending);if(match){clearTimeout(timer);process.stdin.off('data',listen);resolve(Number(match[1]));}};process.stdin.on('data',listen);original('\\x1b[?2033$p');});
process.stdin.setRawMode(true);process.stdin.resume();
process.once('SIGUSR2',()=>{state.events.push({tag:'diagnostic-query',at:Date.now()-state.startedAt});save();original('\\x1b[?998n');});
state.initialMode=await mode();
writeFileSync(${JSON.stringify(join(statusDir, "native-monitor.json"))},JSON.stringify({version:1,source:'summon',project:'native-monitor',directory:${JSON.stringify(dir)},pid:process.pid,startedAt:new Date().toISOString(),layout:'full',panes:['editor']}));
writeFileSync(${JSON.stringify(join(statusDir, "native-monitor.active"))},'');
writeFileSync(${JSON.stringify(join(statusDir, "native-monitor.pid"))},String(process.pid));
state.ready=true;save();
await runMonitor();
process.stdin.setRawMode(true);process.stdin.resume();state.finalMode=await mode();state.done=true;save();process.stdin.setRawMode(false);process.stdin.pause();
`);
  const state = (): { reports: number[]; events: Array<{tag:string;status?:number;at:number}>; frames: number; ready: boolean; done: boolean; childPid: number; fallback: boolean; initialMode: number; finalMode: number } => JSON.parse(readFileSync(statePath, "utf8"));
  const command = ["env", `HOME=${shellQuote(home)}`, "SUMMON_NO_CACHE=1", shellQuote(process.execPath), shellQuote(childPath)].join(" ") + " 2>" + shellQuote(join(dir,"visibility-child.stderr"));
  run(`tell application "Ghostty"
input text "${escapeAppleScript(command)}" to ${exactTerminal(root)}
send key "enter" to ${exactTerminal(root)}
end tell`);
  await eventually(() => existsSync(statePath) && state().ready && (state().reports.some(value => value === 1 || value === 2) || state().fallback), 10_000);
  expect(state().fallback, "Real monitor must negotiate support without falling back").toBe(false);
  expect(focusTerminal(root).kind).toBe("focused");
  await eventually(() => state().reports.at(-1) === 1);
  const live = readNativeInventory([root]);
  if (live.kind !== "available" || !live.panes[0]) throw new Error("Owned monitor root unavailable");
  const windowId = live.panes[0].windowId;
  const before = new Set(terminalDirectories().map(p => p.terminalId));
  try {
    run(`tell application "Ghostty"
set cfg to new surface configuration
set initial working directory of cfg to "${escapeAppleScript(dir)}"
set command of cfg to "/bin/zsh -f"
new tab in window id "${escapeAppleScript(windowId)}" with configuration cfg
end tell`);
  } finally { recover(); }
  const covering = terminalDirectories().filter(p => !before.has(p.terminalId) && p.windowId === windowId);
  expect(covering).toHaveLength(1);
  expect(focusTerminal(covering[0]!.terminalId).kind).toBe("focused");
  await new Promise(resolve => setTimeout(resolve,500));
  const childPid=state().childPid;
  expect(Number.isInteger(childPid) && childPid > 0 && childPid !== process.pid).toBe(true);
  const childCommand=execFileSync("/bin/ps",["-ww","-p",String(childPid),"-o","command="],{encoding:"utf8",timeout:3000});
  expect(childCommand).toContain(childPath);
  const cwd=execFileSync("lsof",["-a","-p",String(childPid),"-d","cwd","-Fn"],{encoding:"utf8",timeout:3000,stdio:["ignore","pipe","ignore"]});
  expect(cwd.split("\n")).toContain(`n${dir}`);
  const previous=state().reports.length;
  process.kill(childPid,"SIGUSR2");
  await eventually(()=>state().reports.length > previous);
  const tabVisibility=state().reports.at(-1);
  expect([1,2]).toContain(tabVisibility);
  const tabSuppression=tabVisibility === 2 ? "NATIVE_VERIFIED" : "PARTIAL: provider reports conservative visible; tab-only savings unproven";
  writeFileSync(join(process.cwd(),"logs/ghostty-p3-native-tab-observation.json"),JSON.stringify({root,covering:covering[0]!.terminalId,windowId,tabVisibility,tabSuppression,...state()},null,2));
  if (process.env.SUMMON_NATIVE_VISIBILITY_DIAGNOSTIC === "1") return;
  if (tabVisibility === 2) {
    const framesWhileHidden=state().frames;
    await new Promise(resolve=>setTimeout(resolve,3300));
    expect(state().frames).toBe(framesWhileHidden);
  }
  expect(focusTerminal(root).kind).toBe("focused");
  await eventually(() => state().reports.at(-1) === 1);
  const framesBeforeHelp=state().frames;
  run(`tell application "Ghostty" to input text "?" to ${exactTerminal(root)}`);
  await eventually(() => state().frames > framesBeforeHelp);
  run(`tell application "Ghostty" to input text "q" to ${exactTerminal(root)}`); // dismiss help
  let manualHiddenDurationMs: number | null = null;
  if (process.env.SUMMON_NATIVE_VISIBILITY_MANUAL === "1") {
    const title = `Summon visibility check ${dir.split("/").at(-1)}`;
    run(`tell application "Ghostty" to perform action "set_tab_title:${escapeAppleScript(title)}" on ${exactTerminal(root)}`);
    const tabId = live.panes[0].tabId;
    const readback = JSON.parse(run(`use framework "Foundation"
use scripting additions
set resultValue to current application's NSMutableDictionary's dictionary()
tell application "Ghostty"
set ownedWindow to window id "${escapeAppleScript(windowId)}"
set ownedTab to tab id "${escapeAppleScript(tabId)}" of ownedWindow
resultValue's setObject:(name of ownedWindow as text) forKey:"windowTitle"
resultValue's setObject:(name override of ownedTab as text) forKey:"tabTitle"
resultValue's setObject:(id of selected tab of ownedWindow as text) forKey:"selectedTabId"
end tell
set dataBytes to current application's NSJSONSerialization's dataWithJSONObject:resultValue options:0 |error|:(missing value)
return (current application's NSString's alloc()'s initWithData:dataBytes encoding:(current application's NSUTF8StringEncoding)) as text`)) as {windowTitle:string;tabTitle:string;selectedTabId:string};
    expect(readback.tabTitle).toBe(title);
    expect(readback.selectedTabId).toBe(tabId);
    const readiness = {title, actualWindowTitle:readback.windowTitle,windowId,tabId,terminalId:root,statePath,instructions:"Minimize this owned Ghostty window, then restore it. Do not type in it or close it."};
    writeFileSync(join(dir, "manual-minimize-ready.json"), JSON.stringify(readiness));
    writeFileSync(join(process.cwd(), "logs/ghostty-p3-manual-ready.json"), JSON.stringify(readiness,null,2));
    console.error(`Manual minimize ready: ${JSON.stringify(readiness)}`);
    const eventCount=state().events.length;
    const deadline=Date.now()+180_000;
    let observation: ReturnType<typeof inspectHiddenSpan> = {complete:false,durationMs:null};
    while(Date.now()<deadline) {
      observation=inspectHiddenSpan(state().events.slice(eventCount));
      if(observation.complete) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!observation.complete) throw new Error("Manual owned-window minimize/restore2→1 was not observed; native gate remains unavailable.");
    manualHiddenDurationMs=observation.durationMs;
    writeFileSync(join(dir,"manual-minimize-result.json"),JSON.stringify({title,windowId,terminalId:root,reports:state().reports,manualHiddenDurationMs,passed:true}));
  }
  run(`tell application "Ghostty" to input text "q" to ${exactTerminal(root)}`);
  await eventually(() => state().done);
  expect(state().finalMode).toBe(state().initialMode);
  writeFileSync(join(dir, "visibility-result.json"), JSON.stringify({ ...state(), tabSuppression, manualHiddenDurationMs, classification: process.env.SUMMON_NATIVE_VISIBILITY_MANUAL === "1" ? "GREEN" : "PARTIAL", minimize: process.env.SUMMON_NATIVE_VISIBILITY_MANUAL === "1" ? "observed" : "UNAVAILABLE: no native minimize action; manual owned-window check required" }));
  // Native assertions are copied outside the disposable workspace for phase evidence.
  writeFileSync(join(process.cwd(), "logs/ghostty-p3-native-visibility.json"), JSON.stringify({ directory:dir, terminalId:root,windowId,tabSuppression,manualHiddenDurationMs,classification:process.env.SUMMON_NATIVE_VISIBILITY_MANUAL === "1" ? "GREEN" : "PARTIAL",...state(),minimize:process.env.SUMMON_NATIVE_VISIBILITY_MANUAL === "1" ? "observed" : "UNAVAILABLE" },null,2));
}

describe("native visibility trace", () => {
  it.each([0, 1, 1722])("accepts ordered reports with informational %sms duration", durationMs => {
    expect(inspectHiddenSpan([
      {tag:"visibility",status:2,at:100},
      {tag:"visibility",status:1,at:100+durationMs},
    ])).toEqual({complete:true,durationMs});
  });
  it("requires ordered hidden then visible even if timestamps are identical", () => {
    expect(inspectHiddenSpan([{tag:"visibility",status:1,at:100}])).toEqual({complete:false,durationMs:null});
    expect(inspectHiddenSpan([{tag:"visibility",status:1,at:100},{tag:"visibility",status:2,at:100}])).toEqual({complete:false,durationMs:null});
  });
  it("rejects frames during a complete or pending hidden span", () => {
    const pending=[{tag:"visibility",status:2,at:100},{tag:"frame",at:100}];
    expect(()=>inspectHiddenSpan(pending)).toThrow("Frame emitted while terminal reported hidden");
    expect(()=>inspectHiddenSpan([...pending,{tag:"visibility",status:1,at:100}])).toThrow("Frame emitted while terminal reported hidden");
  });
  it("allows frames outside the ordered hidden span", () => {
    expect(inspectHiddenSpan([
      {tag:"frame",at:0},{tag:"visibility",status:2,at:100},
      {tag:"visibility",status:1,at:100},{tag:"frame",at:100},
    ])).toEqual({complete:true,durationMs:0});
  });
});
describe("native E2E mode contract", () => {
  it("required wins and ordinary unit tests never mutate GUI", () => {
    expect(resolveNativeMode({})).toBe("off");
    expect(resolveNativeMode({ SUMMON_NATIVE_E2E: "1" })).toBe("advisory");
    expect(
      resolveNativeMode({
        SUMMON_NATIVE_E2E: "1",
        SUMMON_NATIVE_E2E_REQUIRED: "1",
      }),
    ).toBe("required");
  });
});
describe("native ownership inventory readback", () => {
  it("reads batched ownership fields/count without GUI mutation", ctx => {
    if(mode === "off") {ctx.skip("Native provider readback is separately opt-in");return;}
    const started=Date.now();
    const rows=terminalDirectories();
    const expected=Number(run('tell application "Ghostty" to count of terminals').trim());
    expect(rows).toHaveLength(expected);
    expect(new Set(rows.map(row=>row.terminalId)).size).toBe(expected);
    for(const row of rows) {
      expect(TERMINAL_ID_RE.test(row.terminalId)).toBe(true);
      expect(typeof row.directory).toBe("string");
      expect(typeof row.windowId).toBe("string");
      expect(Number.isInteger(row.pid)).toBe(true);
      expect(row.pid).toBeGreaterThanOrEqual(0);
    }
    const elapsedMs=Date.now()-started;
    writeFileSync(join(process.cwd(), "logs/ghostty-p3-baseline-readback.json"),JSON.stringify({count:expected,elapsedMs,unique:true,fieldsValidated:true},null,2));
    console.error(`Read-only batched ownership inventory: ${expected} terminals, ${elapsedMs}ms`);
  });
});
describe("Ghostty native behavior E2E", () => {
  it("captures both layouts, exact focus, JSON observations, foreground change and owned closure", async (ctx) => {
    if (mode === "off") {
      ctx.skip(
        "Native GUI E2E is separately opt-in (SUMMON_NATIVE_E2E_REQUIRED=1)",
      );
      return;
    }
    const app = discoverGhostty();
    const support = probeGhosttyNative(app);
    if (
      !app ||
      support.nativeIdentity.state !== "supported" ||
      support.foreground.state !== "supported"
    ) {
      if (mode === "advisory") {
        ctx.skip("Installed native capabilities unavailable — advisory only");
        return;
      }
      throw new Error(
        "Required native E2E unavailable. Install/run Ghostty 1.4+, enable scripting and Automation, then run summon doctor and retry.",
      );
    }
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), "summon-native-owned-")),
    );
    const baseline = terminalDirectories();
    const before = new Set(baseline.map((p) => p.terminalId));
    writeFileSync(
      join(dir, "baseline.json"),
      JSON.stringify({ directory: dir, terminals: baseline }),
    );
    const owned = new Set<string>();
    const ownedWindows = new Set<string>();
    const processDirectory = (pid: number) => {
      if (pid <= 0) return "";
      try {
        return (
          execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
            encoding: "utf8",
            timeout: 3000,
            stdio: ["ignore", "pipe", "ignore"],
          })
            .split("\n")
            .find((line) => line.startsWith("n"))
            ?.slice(1) ?? ""
        );
      } catch {
        return "";
      }
    };
    const recover = () => {
      for (const p of terminalDirectories()) {
        if (
          !before.has(p.terminalId) &&
          (p.directory === dir ||
            ownedWindows.has(p.windowId) ||
            processDirectory(p.pid) === dir)
        ) {
          owned.add(p.terminalId);
          ownedWindows.add(p.windowId);
        }
      }
      writeFileSync(
        join(dir, "owned-terminal-ids.json"),
        JSON.stringify([...owned]),
      );
    };
    try {
      // No reference to front/user windows. A unique cwd plus baseline IDs recovers
      // ownership if Cocoa fails to return the newly-created window object.
      let createdId = "";
      try {
        createdId = run(`tell application "Ghostty"
set cfg to new surface configuration
set initial working directory of cfg to "${escapeAppleScript(dir)}"
set command of cfg to "/bin/zsh -f"
set testWindow to new window with configuration cfg
return id of terminal 1 of selected tab of testWindow
end tell`).trim();
        writeFileSync(join(dir, "created-root-id.txt"), createdId);
      } finally {
        recover();
      }
      await eventually(() => {
        recover();
        return owned.size === 1;
      });
      const root = [...owned][0]!;
      if (TERMINAL_ID_RE.test(createdId)) expect(root).toBe(createdId);
      expect(focusTerminal(root).kind).toBe("focused");
      const adoptCapture = (capture: NativeMetadata | undefined) => {
        expect(capture?.rootTerminalId).toBe(root);
        const ids = capture!.panes.map((p) => p.terminalId);
        for (const id of ids) expect(before.has(id)).toBe(false);
        const readback = readNativeInventory(ids);
        expect(readback.kind).toBe("available");
        if (readback.kind !== "available") throw new Error(readback.reason);
        expect(readback.panes).toHaveLength(ids.length);
        for (const p of readback.panes)
          expect(ownedWindows.has(p.windowId)).toBe(true);
        for (const id of ids) owned.add(id);
      };
      if (process.env.SUMMON_NATIVE_VISIBILITY_ONLY === "1") {
        await checkMonitorVisibility(dir, root, recover);
        return;
      }
      const plan = planLayout({
        editor: "",
        editorPanes: 4,
        shell: "true",
        sidebarCommand: "",
        autoResize: false,
        cleanRestoredPanes: false,
      });
      const anchor = (script: string, variable: string) => {
        const binding = `set ${variable} to terminal 1 of selected tab of win`;
        expect(script.split(binding)).toHaveLength(2);
        return script
          .replace(
            "set win to front window",
            "-- Task fixture: no front-window lookup",
          )
          .replace(binding, `set ${variable} to ${exactTerminal(root)}`);
      };
      const capture = parseNativeCapture(
        run(anchor(generateAppleScript(plan, dir), "paneRoot")),
        traditionalInventory(plan),
      );
      adoptCapture(capture);
      recover();
      expect(capture?.panes.map((p) => p.name)).toEqual([
        "editor",
        "sidebar",
        "right-1",
        "right-2",
        "shell",
        "editor-2",
      ]);

      const sibling = capture!.panes.find(
        (p) => p.name === "sidebar",
      )!.terminalId;
      const title = 'same cwd "title"\t\r\n\\🦊';
      for (const id of [root, sibling])
        run(
          `tell application "Ghostty" to set name override of ${exactTerminal(id)} to "${escapeAppleScript(title)}"`,
        );
      expect(focusTerminal(sibling)).toEqual({
        kind: "focused",
        terminalId: sibling,
      });
      expect(focusTerminal(root)).toEqual({
        kind: "focused",
        terminalId: root,
      });
      const observed = readNativeInventory([root, sibling]);
      expect(observed.kind).toBe("available");
      if (observed.kind !== "available") throw new Error(observed.reason);
      expect(observed.panes.find((p) => p.terminalId === sibling)?.title).toBe(
        title,
      );
      expect(observed.panes.find((p) => p.terminalId === root)).toMatchObject({
        title,
        focused: true,
      });
      expect(
        observed.panes.find((p) => p.terminalId === sibling)?.focused,
      ).toBe(false);
      const shellPid = observed.panes.find((p) => p.terminalId === root)?.pid;
      run(`tell application "Ghostty"
input text "sleep 20" to ${exactTerminal(root)}
send key "enter" to ${exactTerminal(root)}
end tell`);
      await eventually(() => {
        const result = readNativeInventory([root]);
        return (
          result.kind === "available" &&
          result.panes[0]?.pid !== null &&
          result.panes[0]?.pid !== shellPid
        );
      });
      run(
        `tell application "Ghostty" to send key "c" modifiers "control" to ${exactTerminal(root)}`,
      );
      run(`tell application "Ghostty" to close ${exactTerminal(sibling)}`);
      await eventually(() => {
        const result = readNativeInventory([sibling]);
        return result.kind === "available" && result.panes.length === 0;
      });
      expect(focusTerminal(sibling).kind).toBe("unavailable");
      expect(focusTerminal(root).kind).toBe("focused");
      const tree = buildTreePlan(parseTreeDSL("a-b | a_b / A_b"), {
        autoResize: false,
      });
      const treeCapture = parseNativeCapture(
        run(
          anchor(
            generateTreeAppleScript(tree, dir),
            treeInventory(tree)[0]!.variable,
          ),
        ),
        treeInventory(tree),
      );
      adoptCapture(treeCapture);
      recover();
      expect(treeCapture?.panes.map((p) => p.name)).toEqual([
        "a-b",
        "a_b",
        "A_b",
      ]);
      await checkMonitorVisibility(dir, root, recover);
    } finally {
      for (const file of ["visibility-child.mjs","visibility-state.json","visibility-child.stderr"]) {
        if (existsSync(join(dir,file))) writeFileSync(join(process.cwd(),`logs/ghostty-p3-${file}`),readFileSync(join(dir,file)));
      }
      recover();
      // Cleanup only UUIDs proven task-owned by unique cwd and absent from baseline.
      for (const id of owned) {
        try {
          run(`tell application "Ghostty" to close ${exactTerminal(id)}`);
        } catch {
          /* already closed */
        }
      }
      await eventually(() =>
        terminalDirectories().every((p) => !owned.has(p.terminalId)),
      );
      // Preserve baseline/ownership evidence if cleanup cannot establish a closed fixture.
      writeFileSync(
        join(dir, "cleanup.json"),
        JSON.stringify({
          owned: [...owned],
          remaining: terminalDirectories().filter((p) =>
            owned.has(p.terminalId),
          ),
        }),
      );
      rmSync(dir, { recursive: true, force: true });
    }
  }, process.env.SUMMON_NATIVE_VISIBILITY_MANUAL === "1" ? 240_000 : 120_000);
});
