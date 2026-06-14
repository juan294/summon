import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { generateAppleScript } from "../script.js";
import { planLayout } from "../layout.js";

// GHOSTTY_AVAILABLE=1 is set by CI when `brew install --cask ghostty` succeeded,
// bypassing the filesystem check. This allows the real osacompile validation to
// run in CI (QA-S1 / #517) without hard-requiring the cask install.
const ghosttyInstalled =
  process.env["GHOSTTY_AVAILABLE"] === "1" || existsSync("/Applications/Ghostty.app");
describe.skipIf(!process.env["SUMMON_E2E"] || !ghosttyInstalled)("AppleScript syntax E2E", () => {
  it("generated script compiles with osacompile", () => {
    const plan = planLayout({ editorPanes: 1, shell: "false" });
    const script = generateAppleScript(plan, "/tmp");
    // osacompile checks syntax without running
    execFileSync("osacompile", ["-e", script], { stdio: "pipe" });
  });
});
