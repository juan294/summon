import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    // Write to a temp file so osacompile can resolve the Ghostty scripting
    // dictionary from the tell-application block. The -e flag bypasses
    // dictionary lookup and fails on Ghostty-specific terms (#517).
    const tmpFile = join(tmpdir(), `summon-e2e-${process.pid}.applescript`);
    writeFileSync(tmpFile, script, "utf8");
    try {
      execFileSync("osacompile", ["-o", "/dev/null", tmpFile], { stdio: "pipe" });
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
