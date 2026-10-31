import { describe, expect, it } from "vitest";
import { planLayout } from "./layout.js";
import { buildTreePlan, parseTreeDSL } from "./tree.js";
import {
  traditionalInventory,
  treeInventory,
  parseNativeCapture,
  parseNativeMetadata,
  escapeControlChars,
  isDisplaySafe,
} from "./pane-inventory.js";

const ids = Array.from(
  { length: 6 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);
describe("native pane inventory", () => {
  it("P2-inventory-order includes physical empty sidebar and creation order", () => {
    const inventory = traditionalInventory(
      planLayout({ editorPanes: 4, shell: "true", sidebarCommand: "" }),
    );
    expect(inventory).toEqual([
      { name: "editor", variable: "paneRoot" },
      { name: "sidebar", variable: "paneSidebar" },
      { name: "right-1", variable: "paneRightCol" },
      { name: "right-2", variable: "paneRight2" },
      { name: "shell", variable: "paneRight3" },
      { name: "editor-2", variable: "paneLeft2" },
    ]);
    expect(
      parseNativeCapture(`SUMMON_NATIVE_V1\n${ids.join("\n")}\n`, inventory)
        ?.panes,
    ).toEqual(inventory.map((p, i) => ({ name: p.name, terminalId: ids[i] })));
  });
  it("maps shell-only right column without losing sidebar", () => {
    expect(
      traditionalInventory(planLayout({ editorPanes: 1, shell: "true" })),
    ).toEqual([
      { name: "editor", variable: "paneRoot" },
      { name: "sidebar", variable: "paneSidebar" },
      { name: "shell", variable: "paneRightCol" },
    ]);
  });
  it("allocates collision-free tree variables even for case and punctuation", () => {
    const inventory = treeInventory(
      buildTreePlan(parseTreeDSL("a-b | a_b / A_b")),
    );
    expect(inventory).toEqual([
      { name: "a-b", variable: "pane0" },
      { name: "a_b", variable: "pane1" },
      { name: "A_b", variable: "pane2" },
    ]);
  });
  it("rejects ambiguous logical names before generating exact targeting", () => {
    expect(() =>
      treeInventory(buildTreePlan(parseTreeDSL("editor | editor"))),
    ).toThrow(/unique/);
  });
  it.each([
    "",
    "SUMMON_NATIVE_UNAVAILABLE",
    "SUMMON_NATIVE_V1\nno",
    `SUMMON_NATIVE_V1\n${ids[0]}\n${ids[0]}`,
    `SUMMON_NATIVE_V1\n${ids[0]}\n${ids[1]}`,
    "x".repeat(65537),
  ])("P2-capture-recovery rejects invalid capture %s", (output) => {
    expect(
      parseNativeCapture(output, [{ name: "editor", variable: "paneRoot" }]),
    ).toBeUndefined();
  });
  it("validates only optional native metadata and root membership", () => {
    const native = {
      rootTerminalId: ids[0],
      panes: [{ name: "editor", terminalId: ids[0] }],
    };
    expect(parseNativeMetadata(native)).toEqual(native);
    for (const invalid of [
      null,
      {},
      { ...native, rootTerminalId: ids[1] },
      { ...native, panes: [] },
      { ...native, panes: [...native.panes, ...native.panes] },
      { ...native, panes: [{ name: "", terminalId: ids[0] }] },
    ])
      expect(parseNativeMetadata(invalid)).toBeUndefined();
  });
});

describe("escapeControlChars", () => {
  it("escapes controls and bidi overrides; keeps plain and wide text", () => {
    expect(escapeControlChars("a\x1b[31m\tb\u202e\u2066")).toBe("a\\u001b[31m\\u0009b\\u202e\\u2066");
    expect(escapeControlChars("editor · 日本 ✳")).toBe("editor · 日本 ✳");
  });

  it("leaves a ZWJ emoji sequence unchanged, so it displays as one grapheme (FE-L1)", () => {
    const family = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
    expect(escapeControlChars(`build ${family}`)).toBe(`build ${family}`);
    expect(isDisplaySafe(family)).toBe(true);
  });
});
