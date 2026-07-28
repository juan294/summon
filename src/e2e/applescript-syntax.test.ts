import { describe, it, expect } from "vitest";
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
 * We compile a minimal Ghostty snippet; if that fails with -2741 the
 * dictionary is inaccessible.
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

/**
 * Three-state contract (E2E Pro D04).
 *
 * Previously this suite was a plain `describe.skipIf`, and it was wired as a
 * *required* status check. On every hosted runner the dictionary probe fails,
 * the suite skipped, and the job reported success with zero assertions — a
 * required gate that could never fail. That is the "green run in which every
 * relevant test skipped" anti-pattern, and it was live.
 *
 *   off           — neither env var set. Clean skip; local `pnpm test` is
 *                   unaffected on machines without Ghostty.
 *   opportunistic — SUMMON_E2E=1. Runs when the dictionary is reachable;
 *                   otherwise records an explicit skip reason. Advisory only,
 *                   which is why it is no longer a required check.
 *   required      — SUMMON_E2E_REQUIRED=1. An unreachable dictionary FAILS,
 *                   so an unrunnable required probe blocks instead of greening.
 *
 * The release workflow uses `required` on a machine that has the dictionary;
 * CI uses `opportunistic`.
 */
type Mode = "off" | "opportunistic" | "required";

export function resolveMode(env: NodeJS.ProcessEnv): Mode {
  if (env["SUMMON_E2E_REQUIRED"]) return "required";
  if (env["SUMMON_E2E"]) return "opportunistic";
  return "off";
}

/**
 * What to do given the mode and whether the dictionary is reachable.
 *
 * Split out so the fail-closed invariant is provable on a machine that *does*
 * have Ghostty — otherwise the one branch that matters most could only be
 * exercised by uninstalling it.
 */
export function decideE2E(mode: Mode, dictionaryAvailable: boolean): "run" | "skip" | "fail" {
  if (mode === "off") return "skip";
  if (dictionaryAvailable) return "run";
  return mode === "required" ? "fail" : "skip";
}

const mode = resolveMode(process.env);
const dictionaryAvailable = mode === "off" ? false : ghosttyDictionaryAccessible();

describe("AppleScript syntax E2E", () => {
  it("generated script compiles with osacompile", (ctx) => {
    const decision = decideE2E(mode, dictionaryAvailable);

    if (decision === "skip") {
      ctx.skip(
        mode === "off"
          ? "SUMMON_E2E not set — AppleScript E2E is opt-in"
          : "Ghostty AppleScript dictionary unreachable (#517) — advisory run, not required",
      );
      return;
    }

    if (decision === "fail") {
      // Fail closed. "Cannot run" must never equal "passed" for a probe the
      // release depends on.
      throw new Error(
        "BLOCKED — Ghostty's AppleScript dictionary is unreachable, and this probe is " +
          "required (SUMMON_E2E_REQUIRED=1).\n\n" +
          "WHY: osacompile could not resolve `new surface configuration`. Ghostty.app may be " +
          "absent, or LaunchServices may not be populated (headless runners, #517).\n\n" +
          "FIX:\n" +
          "  Run this on a Mac with Ghostty 1.3.1+ installed and launched at least once,\n" +
          "  or drop SUMMON_E2E_REQUIRED to run it opportunistically.",
      );
    }

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

describe("AppleScript E2E mode contract", () => {
  it("resolves the three modes from the environment", () => {
    expect(resolveMode({})).toBe("off");
    expect(resolveMode({ SUMMON_E2E: "1" })).toBe("opportunistic");
    expect(resolveMode({ SUMMON_E2E_REQUIRED: "1" })).toBe("required");
    // required wins when both are set, so the release workflow cannot be
    // downgraded by a stray SUMMON_E2E.
    expect(resolveMode({ SUMMON_E2E: "1", SUMMON_E2E_REQUIRED: "1" })).toBe("required");
  });

  // The whole point of Phase 3: an unrunnable REQUIRED probe must fail, not
  // skip. Proving that on a Mac that has Ghostty requires this split, since the
  // real suite would otherwise take the happy path every time here.
  it("fails closed when a required probe cannot run", () => {
    expect(decideE2E("required", false)).toBe("fail");
  });

  it("skips rather than fails when the run is only advisory", () => {
    expect(decideE2E("opportunistic", false)).toBe("skip");
    expect(decideE2E("off", false)).toBe("skip");
    expect(decideE2E("off", true)).toBe("skip");
  });

  it("runs whenever the dictionary is reachable and the suite is opted in", () => {
    expect(decideE2E("opportunistic", true)).toBe("run");
    expect(decideE2E("required", true)).toBe("run");
  });
});
