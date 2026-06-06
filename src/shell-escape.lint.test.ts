// DO NOT REMOVE — load-bearing CI gate.
// This file statically scans all source files for unsafe interpolation patterns.
// Removing it removes the primary AppleScript/shell injection defense.
// See CLAUDE.md Security Invariants section for context.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const SRC_DIR = new URL(".", import.meta.url).pathname;

function walkTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      results.push(...walkTs(join(dir, entry.name)));
    } else if (entry.name.endsWith(".ts")) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

const FILES = walkTs(SRC_DIR).filter(
  (f) =>
    !f.endsWith(".test.ts") &&
    !f.endsWith("/shell-escape.ts"),
);

// Patterns that indicate the line feeds into a shell/AppleScript context.
//
// IMPORTANT — helper-function blind spot (SE-M1):
// The original pattern only matched lines containing literal AppleScript/shell
// keywords (osascript, input text, sh -c, …). This missed helper functions
// such as emitCleanupTrap / emitStatusWrite that assemble shell/AppleScript
// strings via sendCommand() over multiple lines: the template literal
// containing the user value is on a different line from the "input text"
// keyword emitted inside sendCommand's body.
//
// Fix: also flag any line that calls sendCommand( or setInitialInput( because
// those helpers always emit AppleScript "input text" (i.e. they ARE the
// dangerous context). A template literal with ${…} passed to either of those
// helpers must still route the interpolated value through a safe escape call.
const DANGER_CONTEXT =
  /(sh\s+-c|bash\s+-c|osascript|eval\s|input text|sendCommand\s*\(|setInitialInput\s*\()/;
// Patterns that confirm the interpolated value goes through a helper
const SAFE_CALL = /(shellQuote|shellDoubleQuote|escapeAppleScript)\s*\(/;
// Inline suppression marker — use sparingly; requires documented reason.
// Format: // lint-allow-escape: <reason>
const LINT_ALLOW = /\/\/\s*lint-allow-escape:/;

describe("shell-escape invariant", () => {
  it.each(FILES)(
    "%s — every shell/applescript interpolation routes through a helper",
    (file) => {
      const src = readFileSync(file, "utf-8");
      const lines = src.split("\n");
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!DANGER_CONTEXT.test(line)) continue;
        if (!/\$\{[^}]+\}/.test(line)) continue;
        if (SAFE_CALL.test(line)) continue;
        if (LINT_ALLOW.test(line)) continue;
        violations.push(`${relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`);
      }

      expect(violations, violations.join("\n")).toEqual([]);
    },
  );

  // ---------------------------------------------------------------------------
  // Unit tests for the scanner logic itself — these verify the gate catches
  // helper-function blind spots (SE-M1) without relying on real source files.
  // ---------------------------------------------------------------------------

  describe("scanner unit tests", () => {
    /**
     * Run the same per-line scanner used in the it.each above against an
     * inline source string and return any violations found.
     */
    function scan(src: string): string[] {
      const lines = src.split("\n");
      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!DANGER_CONTEXT.test(line)) continue;
        if (!/\$\{[^}]+\}/.test(line)) continue;
        if (SAFE_CALL.test(line)) continue;
        if (LINT_ALLOW.test(line)) continue;
        violations.push(`line ${i + 1}: ${line.trim()}`);
      }
      return violations;
    }

    // -------------------------------------------------------------------------
    // SE-M1 blind-spot demonstration: the OLD pattern (keywords-only) misses
    // template literals passed to helper functions that internally emit
    // "input text". We keep this as a regression guard showing WHY the fix
    // was needed.
    // -------------------------------------------------------------------------

    it("OLD pattern misses dangerous sendCommand call with raw user value", () => {
      // Simulate the blind spot: a helper function calls sendCommand() with a
      // raw (unescaped) user value. The line has no osascript / input text /
      // sh -c keyword, so the OLD keyword-only DANGER_CONTEXT skips it.
      const OLD_DANGER_CONTEXT =
        /(sh\s+-c|bash\s+-c|osascript|eval\s|input text)/;

      const dangerousSnippet = `
function emitFakeHelper(sendCommand, pane, userValue) {
  sendCommand(pane, \`do shell script "\${userValue}"\`);
}
`;
      const lines = dangerousSnippet.split("\n");
      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!OLD_DANGER_CONTEXT.test(line)) continue;
        if (!/\$\{[^}]+\}/.test(line)) continue;
        if (SAFE_CALL.test(line)) continue;
        violations.push(line.trim());
      }
      // The OLD pattern produces NO violations — it misses the injection.
      expect(violations).toEqual([]);
    });

    it("NEW pattern catches dangerous sendCommand call with raw user value", () => {
      // The same snippet — now the expanded DANGER_CONTEXT (which includes
      // sendCommand\s*\() flags the unsafe interpolation.
      const dangerousSnippet = `
function emitFakeHelper(sendCommand, pane, userValue) {
  sendCommand(pane, \`do shell script "\${userValue}"\`);
}
`;
      const violations = scan(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("userValue");
    });

    it("NEW pattern catches dangerous setInitialInput call with raw user value", () => {
      const dangerousSnippet = `
function emitBadHelper(setInitialInput, userCmd) {
  setInitialInput(\`cd \${userCmd}\`);
}
`;
      const violations = scan(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("userCmd");
    });

    it("safe sendCommand call with shellQuote is not flagged", () => {
      const safeSnippet = `
function emitGoodHelper(sendCommand, pane, userValue) {
  sendCommand(pane, \`cd \${shellQuote(userValue)}\`);
}
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("safe sendCommand call with escapeAppleScript is not flagged", () => {
      const safeSnippet = `
function emitGoodHelper(sendCommand, pane, userValue) {
  sendCommand(pane, \`input text "\${escapeAppleScript(userValue)}" to pane\`);
}
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("safe sendCommand call with shellDoubleQuote is not flagged", () => {
      const safeSnippet = `
function emitGoodHelper(sendCommand, pane, userPath) {
  sendCommand(pane, \`export LOG="\${shellDoubleQuote(userPath)}"\`);
}
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("sendCommand call with constant (non-interpolated) string is not flagged", () => {
      const safeSnippet = `
function emitCleanHelper(sendCommand, pane) {
  sendCommand(pane, "clear");
  sendCommand(pane, \`mkdir -p /some/static/path\`);
}
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("still catches direct osascript interpolation without safe helper", () => {
      const dangerousSnippet = `
const script = \`osascript -e "set x to \${rawUserValue}"\`;
`;
      const violations = scan(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("lint-allow-escape marker suppresses a flagged line with documented reason", () => {
      // When a developer has verified that interpolated variables are
      // pre-escaped before reaching this call, they may suppress the gate
      // with an inline // lint-allow-escape: <reason> comment on the same
      // line as the sendCommand call. The reason is visible in code review.
      const allowedSnippet = `
function emitPidBootstrap(sendCommand, pane, preEscapedPidPath, preEscapedMarkerPath) {
  sendCommand(pane, \`printf '%s\\n' "$$" > \${preEscapedPidPath} && : > \${preEscapedMarkerPath}\`); // lint-allow-escape: pidPath/markerPath pre-escaped via shellDoubleQuote at assignment
}
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });

    it("lint-allow-escape marker without reason still suppresses (marker presence is sufficient)", () => {
      // The marker pattern requires the prefix text but not a specific reason format.
      // The reason is for human reviewers, not machine enforcement.
      const allowedSnippet = `
  sendCommand(pane, \`cmd \${preEscapedVar}\`); // lint-allow-escape: pre-escaped
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });
  });
});
