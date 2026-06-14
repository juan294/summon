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

// ---------------------------------------------------------------------------
// AppleScript / shell interpolation gate (SE-L1)
// ---------------------------------------------------------------------------
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
//
// SE-L1 (broadened): also flag raw interpolation in do shell script,
// keystroke, and perform action AppleScript contexts.  The patterns for
// keystroke and perform action are combined (context + interpolation in one
// regex) to avoid false-positive matches where ${…} appears only in the pane
// variable reference *after* a safe action string (e.g. `perform action
// "toggle_fullscreen" on ${rootPaneVar}`).
const DANGER_CONTEXT =
  /(sh\s+-c|bash\s+-c|osascript|eval\s|input text|sendCommand\s*\(|setInitialInput\s*\(|do shell script)/;

// Precise combined patterns (dangerous keyword + interpolation in same position).
// These are checked in addition to DANGER_CONTEXT + ${…} so that we catch
// injection in specific AppleScript argument positions without flagging
// structural interpolation (pane variable references, constant keys, etc.).
//
// Pattern rationale:
//   - keystroke "[^"]*\${…}        → flags keystroke when ${} is inside the
//                                     quoted key argument
//   - perform action "[^":]*:[^"]*\${…}  → flags parameterized perform-action
//                                     calls (action:parameter format) when
//                                     ${} is inside the parameter portion of
//                                     the quoted action string
const PRECISE_DANGER_PATTERNS: RegExp[] = [
  /keystroke\s+"[^"]*\$\{[^}]+\}/,
  /perform action\s+"[^":]*:[^"]*\$\{[^}]+\}/,
];

// Patterns that confirm the interpolated value goes through a helper
const SAFE_CALL = /(shellQuote|shellDoubleQuote|escapeAppleScript|escapeTabTitle)\s*\(/;
// Inline suppression marker — use sparingly; requires documented reason.
// Format: // lint-allow-escape: <reason>
const LINT_ALLOW = /\/\/\s*lint-allow-escape:/;

// ---------------------------------------------------------------------------
// exec / execSync denylist (SE-S1)
// ---------------------------------------------------------------------------
//
// exec( and execSync( in shell mode with a template-literal interpolation are
// dangerous injection sinks.  Only the on-start hook in launcher.ts is a
// documented sanctioned use (it takes a fully user-authored shell command
// intentionally), but that call uses a pre-resolved variable rather than an
// inline ${} interpolation, so it does not trigger this rule.
//
// Rule: any line matching exec( / execSync( AND containing ${…} is flagged
// UNLESS a // lint-allow-escape: comment appears on the same line or the
// immediately preceding line.
//
// Exclusions:
//   - RegExp.prototype.exec() calls: identified by a preceding dot (.exec()
//     or reVar.exec()) — excluded via negative lookbehind.
//   - The import/require line (just declaring the symbol).
const EXEC_DANGER = /(?<!\.)(?:\bexecSync|\bexec)\s*\(/;

describe("shell-escape invariant", () => {
  it.each(FILES)(
    "%s — every shell/applescript interpolation routes through a helper",
    (file) => {
      const src = readFileSync(file, "utf-8");
      const lines = src.split("\n");
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";

        // Check broad DANGER_CONTEXT (existing patterns + do shell script)
        if (DANGER_CONTEXT.test(line) && /\$\{[^}]+\}/.test(line)) {
          if (!SAFE_CALL.test(line) && !LINT_ALLOW.test(line) && !LINT_ALLOW.test(prevLine)) {
            violations.push(`${relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`);
          }
        }

        // Check precise combined patterns (keystroke / perform action parameter)
        for (const pattern of PRECISE_DANGER_PATTERNS) {
          if (pattern.test(line)) {
            if (!SAFE_CALL.test(line) && !LINT_ALLOW.test(line) && !LINT_ALLOW.test(prevLine)) {
              violations.push(`${relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }

      // Deduplicate in case a line matches both broad and precise patterns
      const unique = [...new Set(violations)];
      expect(unique, unique.join("\n")).toEqual([]);
    },
  );

  it.each(FILES)(
    "%s — exec/execSync with interpolated argument must carry lint-allow-escape",
    (file) => {
      const src = readFileSync(file, "utf-8");
      const lines = src.split("\n");
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";

        if (!EXEC_DANGER.test(line)) continue;
        if (!/\$\{[^}]+\}/.test(line)) continue;
        if (LINT_ALLOW.test(line) || LINT_ALLOW.test(prevLine)) continue;
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
        const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";

        if (DANGER_CONTEXT.test(line) && /\$\{[^}]+\}/.test(line)) {
          if (!SAFE_CALL.test(line) && !LINT_ALLOW.test(line) && !LINT_ALLOW.test(prevLine)) {
            violations.push(`line ${i + 1}: ${line.trim()}`);
          }
        }

        for (const pattern of PRECISE_DANGER_PATTERNS) {
          if (pattern.test(line)) {
            if (!SAFE_CALL.test(line) && !LINT_ALLOW.test(line) && !LINT_ALLOW.test(prevLine)) {
              violations.push(`line ${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
      return [...new Set(violations)];
    }

    /**
     * Run the exec denylist scanner against an inline source string.
     */
    function scanExec(src: string): string[] {
      const lines = src.split("\n");
      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";
        if (!EXEC_DANGER.test(line)) continue;
        if (!/\$\{[^}]+\}/.test(line)) continue;
        if (LINT_ALLOW.test(line) || LINT_ALLOW.test(prevLine)) continue;
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

    // -------------------------------------------------------------------------
    // SE-L1: do shell script context (new in this version)
    // -------------------------------------------------------------------------

    it("SE-L1: do shell script with raw user interpolation is flagged", () => {
      const dangerousSnippet = `
add(1, \`do shell script "\${userCmd}"\`);
`;
      const violations = scan(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("userCmd");
    });

    it("SE-L1: do shell script with shellDoubleQuote is not flagged", () => {
      const safeSnippet = `
add(1, \`do shell script "\${shellDoubleQuote(userCmd)}"\`);
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: do shell script with lint-allow-escape on previous line is not flagged", () => {
      const allowedSnippet = `
// lint-allow-escape: userCmd is pre-validated and safe
add(1, \`do shell script "\${userCmd}"\`);
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // SE-L1: keystroke context (new in this version)
    // -------------------------------------------------------------------------

    it("SE-L1: keystroke with raw user interpolation inside quoted arg is flagged", () => {
      const dangerousSnippet = `
add(4, \`keystroke "\${userKey}" using command down\`);
`;
      const violations = scan(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("userKey");
    });

    it("SE-L1: keystroke with escapeAppleScript is not flagged", () => {
      const safeSnippet = `
add(4, \`keystroke "\${escapeAppleScript(userKey)}" using command down\`);
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: keystroke with lint-allow-escape on same line is not flagged", () => {
      const allowedSnippet = `
add(4, \`keystroke "\${key}" using command down\`); // lint-allow-escape: key is "n"|"t" TypeScript literal union
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: keystroke with lint-allow-escape on previous line is not flagged", () => {
      const allowedSnippet = `
// lint-allow-escape: key is "n"|"t" TypeScript literal union — compile-time constant
add(4, \`keystroke "\${key}" using command down\`);
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: keystroke ${paneVar} outside quotes is not flagged by precise pattern", () => {
      // The pane variable reference appears after the closing quote of the
      // keystroke argument — the precise pattern only matches ${} inside the
      // quoted key argument, so structural pane references are ignored.
      const safeSnippet = `
add(2, \`keystroke "t" using {command down, shift down}\`);
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // SE-L1: perform action context (new in this version)
    // -------------------------------------------------------------------------

    it("SE-L1: perform action parameterized call with raw user interpolation is flagged", () => {
      const dangerousSnippet = `
add(1, \`perform action "set_tab_title:\${rawTitle}" on \${pane}\`);
`;
      const violations = scan(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("rawTitle");
    });

    it("SE-L1: perform action with escapeAppleScript is not flagged", () => {
      const safeSnippet = `
add(1, \`perform action "set_tab_title:\${escapeAppleScript(title)}" on \${pane}\`);
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: perform action with escapeTabTitle is not flagged", () => {
      const safeSnippet = `
add(1, \`perform action "set_tab_title:\${escapeTabTitle(title)}" on \${pane}\`);
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: non-parameterized perform action with pane variable is not flagged", () => {
      // Common pattern: `perform action "toggle_fullscreen" on ${rootPaneVar}`
      // The ${} is a pane-variable structural reference, not user input.
      // The precise pattern requires a colon inside the quoted action string,
      // so this variant is intentionally excluded.
      const safeSnippet = `
add(1, \`perform action "toggle_fullscreen" on \${rootPaneVar}\`);
add(1, \`perform action "toggle_maximize" on \${rootPaneVar}\`);
add(1, \`perform action resizeAction on \${paneVar}\`);
`;
      const violations = scan(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-L1: perform action lint-allow-escape on previous line is not flagged", () => {
      const allowedSnippet = `
// lint-allow-escape: title is pre-escaped at assignment
add(1, \`perform action "set_tab_title:\${title}" on \${pane}\`);
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // SE-S1: exec / execSync denylist (new in this version)
    // -------------------------------------------------------------------------

    it("SE-S1: execSync with template interpolation is flagged", () => {
      const dangerousSnippet = `
execSync(\`git -C \${userRepoPath} status\`, { encoding: "utf-8" });
`;
      const violations = scanExec(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("userRepoPath");
    });

    it("SE-S1: exec( with template interpolation is flagged", () => {
      const dangerousSnippet = `
exec(\`open "\${filePath}"\`, callback);
`;
      const violations = scanExec(dangerousSnippet);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain("filePath");
    });

    it("SE-S1: execSync without interpolation is not flagged", () => {
      const safeSnippet = `
execSync(onStart, { cwd: targetDir, encoding: "utf-8", stdio: "inherit" });
`;
      const violations = scanExec(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-S1: RegExp .exec() with interpolation is not flagged", () => {
      // RegExp.prototype.exec() is not a shell sink — excluded by negative
      // lookbehind for a preceding dot.
      const safeSnippet = `
while ((match = PORT_FLAG_RE.exec(script)) !== null) {
  results.push(\`found \${match[1]}\`);
}
`;
      const violations = scanExec(safeSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-S1: execSync with lint-allow-escape on same line is not flagged", () => {
      const allowedSnippet = `
execSync(\`git -C \${repoPath} status\`, opts); // lint-allow-escape: repoPath pre-escaped via shellQuote
`;
      const violations = scanExec(allowedSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-S1: execSync with lint-allow-escape on previous line is not flagged", () => {
      const allowedSnippet = `
// lint-allow-escape: onStart is user-authored shell command (intentional shell sink)
execSync(\`\${onStart}\`, { cwd: targetDir });
`;
      const violations = scanExec(allowedSnippet);
      expect(violations).toEqual([]);
    });

    it("SE-S1: execFileSync is not flagged (uses argv array, not shell)", () => {
      // execFileSync bypasses the shell — it is NOT an injection sink.
      // Only execSync (shell mode) and exec() are flagged.
      const safeSnippet = `
execFileSync("osascript", ["-e", \`tell application "\${appName}" to activate\`]);
`;
      const violations = scanExec(safeSnippet);
      expect(violations).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // Previous-line lint-allow-escape support (regression guard)
    // -------------------------------------------------------------------------

    it("lint-allow-escape on previous line suppresses broad DANGER_CONTEXT violations", () => {
      const allowedSnippet = `
// lint-allow-escape: cmd pre-validated by confirmDangerousCommands
const script = \`sh -c "\${cmd}"\`;
`;
      const violations = scan(allowedSnippet);
      expect(violations).toEqual([]);
    });

    it("lint-allow-escape two lines above does NOT suppress (only same or immediately previous)", () => {
      const notAllowedSnippet = `
// lint-allow-escape: this comment is two lines above, not immediately preceding
const x = 1;
const script = \`sh -c "\${cmd}"\`;
`;
      const violations = scan(notAllowedSnippet);
      expect(violations.length).toBeGreaterThan(0);
    });
  });
});
