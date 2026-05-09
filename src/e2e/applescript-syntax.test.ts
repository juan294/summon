import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";
import { generateAppleScript } from "../script.js";
import { planLayout } from "../layout.js";

describe.skipIf(!process.env["SUMMON_E2E"])("AppleScript syntax E2E", () => {
  it("generated script compiles with osacompile", () => {
    const plan = planLayout({ editorPanes: 1, shell: "false" });
    const script = generateAppleScript(plan, "/tmp");
    // osacompile checks syntax without running
    execFileSync("osacompile", ["-e", script], { stdio: "pipe" });
  });
});
