import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import { escapeAppleScript } from "../shell-escape.js";

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
 repeat with t in tabs of w
 repeat with p in terminals of t
  set entry to current application's NSMutableDictionary's dictionary()
  entry's setObject:(id of p as text) forKey:"terminalId"
  entry's setObject:(working directory of p as text) forKey:"directory"
  entry's setObject:(id of w as text) forKey:"windowId"
  entry's setObject:(pid of p as integer) forKey:"pid"
  rows's addObject:entry
 end repeat
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
async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
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
    } finally {
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
  }, 60_000);
});
