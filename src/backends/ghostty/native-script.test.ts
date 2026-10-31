import { describe, expect, it } from "vitest";
import { generateAppleScript, generateTreeAppleScript } from "./script.js";
import { planLayout } from "../../layout.js";
import { parseTreeDSL, buildTreePlan } from "../../tree.js";
import { traditionalInventory, treeInventory } from "./pane-inventory.js";
describe("native launch capture", () => {
  it("captures traditional UUIDs in shared inventory order inside nonfatal collection", () => {
    const plan = planLayout({
      editorPanes: 4,
      shell: "true",
      sidebarCommand: "",
    });
    const script = generateAppleScript(plan, "/tmp");
    let at = script.indexOf('set summonCapture to "SUMMON_NATIVE_V1"');
    expect(at).toBeGreaterThan(0);
    for (const p of traditionalInventory(plan)) {
      const next = script.indexOf(`id of ${p.variable} as text`, at);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    expect(script).toContain('return "SUMMON_NATIVE_UNAVAILABLE"');
    expect(script.lastIndexOf("try")).toBeLessThan(
      script.lastIndexOf("end tell"),
    );
  });
  it("uses distinct indexed variables everywhere for tree collisions", () => {
    const plan = buildTreePlan(parseTreeDSL("a-b | a_b / A_b"));
    const script = generateTreeAppleScript(plan, "/tmp");
    for (const p of treeInventory(plan))
      expect(script).toContain(`id of ${p.variable} as text`);
    expect(script).toContain("set pane0 to terminal 1");
    expect(script).toContain("set pane1 to split pane0");
    expect(script).toContain("set pane2 to split pane1");
    expect(script).toContain("set_surface_title:a-b");
  });
});
