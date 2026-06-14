import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAppleScript } from "../script.js";
import { planLayout } from "../layout.js";

/**
 * Probe whether osacompile can resolve Ghostty's scripting dictionary.
 * Having Ghostty.app installed is necessary but not sufficient — the
 * LaunchServices database must also be populated (it isn't after a bare
 * `brew install --cask` on a headless CI runner, #517).
 *
 * We compile a minimal Ghostty snippet; if that fails with -2741 we know
 * the dictionary is inaccessible and skip the full suite gracefully.
 */
function ghosttyDictionaryAccessible(): boolean {
  if (!existsSync("/Applications/Ghostty.app")) return false;
  const probe = join(tmpdir(), `summon-e2e-probe-${process.pid}.applescript`);
  // Use a Ghostty-specific term (`new surface configuration`) as the probe —
  // basic `activate` works even without the full dictionary (#517).
  writeFileSync(
    probe,
    'tell application "Ghostty"\n  set cfg to new surface configuration\nend tell\n',
    "utf8",
  );
  try {
    execFileSync("osacompile", ["-o", "/dev/null", probe], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  } finally {
    try { unlinkSync(probe); } catch { /* ignore */ }
  }
}

const canRunE2E = !!process.env["SUMMON_E2E"] && ghosttyDictionaryAccessible();
describe.skipIf(!canRunE2E)("AppleScript syntax E2E", () => {
  it("generated script compiles with osacompile", () => {
    const plan = planLayout({ editorPanes: 1, shell: "false" });
    const script = generateAppleScript(plan, "/tmp");
    // Write to a temp file so osacompile resolves the Ghostty scripting
    // dictionary from the tell-application block (#517).
    const tmpFile = join(tmpdir(), `summon-e2e-${process.pid}.applescript`);
    writeFileSync(tmpFile, script, "utf8");
    try {
      execFileSync("osacompile", ["-o", "/dev/null", tmpFile], { stdio: "pipe" });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});
