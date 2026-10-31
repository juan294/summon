import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAppleScript, generateTreeAppleScript } from "./script.js";
import { planLayout, getPreset } from "../../layout.js";
import { buildTreePlan } from "../../tree.js";
import type { LayoutNode } from "../../tree.js";

/**
 * BE-M2 / SE-L1 success-path guard: every Ghostty script mode, as generated at develop 890db69
 * (src/fixtures/dry-run-ghostty-modes-890db69.txt), must come out unchanged except for two
 * deliberate edits:
 *   - the cleanup trap line (SE-L1 quoting), compared as <TRAP> here and pinned in launch-identity.test.ts;
 *   - in --new-window and --new-tab modes only, the BE-M2 rollback mark: the lines that record the
 *     created window or tab id and the outer try that reports it on failure. Default mode (reused
 *     window) gets no rollback lines at all.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = join(PROJECT_ROOT, "src", "fixtures", "dry-run-ghostty-modes-890db69.txt");
const LAUNCH_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const TARGET = "/tmp/my project";

function tree(newWindow: boolean, newTab: boolean) {
  const layout: LayoutNode = {
    type: "split",
    direction: "right",
    first: { type: "pane", name: "editor", command: "nvim" },
    second: {
      type: "split",
      direction: "down",
      first: { type: "pane", name: "shell", command: "" },
      second: { type: "pane", name: "logs", command: "tail -f log", cwd: "logs" },
    },
  };
  return buildTreePlan(layout, { newWindow, newTab, autoResize: true, editorSize: 70 });
}

const CASES: Array<{ name: string; mode: "default" | "newWindow" | "newTab"; script: () => string }> = [
  { name: "traditional default", mode: "default", script: () => generateAppleScript(planLayout(), TARGET, null, undefined, "myapp", "echo bye", LAUNCH_ID) },
  { name: "traditional default full untracked", mode: "default", script: () => generateAppleScript(planLayout(getPreset("full")), TARGET) },
  { name: "traditional default clean-restored", mode: "default", script: () => generateAppleScript(planLayout({ cleanRestoredPanes: true }), TARGET, "/tmp/star.toml", { FOO: "bar" }, "myapp", undefined, LAUNCH_ID) },
  { name: "traditional new-window", mode: "newWindow", script: () => generateAppleScript(planLayout({ newWindow: true, fullscreen: true }), TARGET, null, undefined, "myapp", "echo bye", LAUNCH_ID) },
  { name: "traditional new-tab", mode: "newTab", script: () => generateAppleScript(planLayout({ ...getPreset("full"), newTab: true }), TARGET, null, undefined, "myapp", undefined, LAUNCH_ID) },
  { name: "tree default", mode: "default", script: () => generateTreeAppleScript(tree(false, false), TARGET, null, undefined, "myapp", "echo bye", LAUNCH_ID) },
  { name: "tree new-window", mode: "newWindow", script: () => generateTreeAppleScript(tree(true, false), TARGET, null, undefined, "myapp", undefined, LAUNCH_ID) },
  { name: "tree new-tab", mode: "newTab", script: () => generateTreeAppleScript(tree(false, true), TARGET) },
];

/** The lines BE-M2 adds in --new-window / --new-tab mode, exactly. */
const ROLLBACK_MARK_LINES: Record<"newWindow" | "newTab", string[]> = {
  newWindow: [
    '    set summonRollback to ""',
    "    try",
    '        if summonWindowsBefore is not -1 then set summonRollback to "window:" & (id of win as text)',
    "    end try",
    "    try",
  ],
  newTab: [
    '    set summonRollback to ""',
    "    try",
    '        if summonTabsBefore is not -1 then set summonRollback to "tab:" & (id of selected tab of summonWin as text)',
    "    end try",
    "    try",
  ],
};
const ROLLBACK_HANDLER_LINES = [
  "    on error summonErr number summonErrNum",
  '        error summonErr & " [summon-rollback " & summonRollback & "]" number summonErrNum',
  "    end try",
];

function pinned(): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of readFileSync(FIXTURE, "utf-8").split(/^=== /m).filter(Boolean)) {
    const newline = block.indexOf("\n");
    map.set(block.slice(0, newline), block.slice(newline + 1).replace(/\n$/, ""));
  }
  return map;
}

function normalizeTrap(lines: string[]): string[] {
  return lines.map((line) => (line.includes("__summon_cleanup()") ? "<TRAP>" : line));
}

/** Remove one exact contiguous run of lines; fails the test when it is absent. */
function removeRun(lines: string[], run: string[]): string[] {
  for (let i = 0; i + run.length <= lines.length; i++) {
    if (run.every((line, j) => lines[i + j] === line)) return [...lines.slice(0, i), ...lines.slice(i + run.length)];
  }
  throw new Error(`rollback lines not found:\n${run.join("\n")}`);
}

describe("Ghostty success-path script parity with develop 890db69 (BE-M2, SE-L1)", () => {
  const fixture = pinned();

  it("the fixture holds every case", () => {
    expect([...fixture.keys()]).toEqual(CASES.map((c) => c.name));
  });

  it.each(CASES)("$name: unchanged apart from the trap line and the rollback mark", ({ name, mode, script }) => {
    let lines = script().split("\n");
    if (mode === "default") {
      expect(lines.join("\n")).not.toContain("summonRollback");
    } else {
      lines = removeRun(lines, ROLLBACK_MARK_LINES[mode]);
      // The handler closes the outer try right before the final `end tell`.
      expect(lines.slice(-4, -1)).toEqual(ROLLBACK_HANDLER_LINES);
      lines = [...lines.slice(0, -4), ...lines.slice(-1)];
    }
    expect(normalizeTrap(lines)).toEqual(normalizeTrap(fixture.get(name)!.split("\n")));
  });
});
