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

// Patterns that indicate the line feeds into a shell/AppleScript context
const DANGER_CONTEXT = /(sh\s+-c|bash\s+-c|osascript|eval\s|input text)/;
// Patterns that confirm the interpolated value goes through a helper
const SAFE_CALL = /(shellQuote|shellDoubleQuote|escapeAppleScript)\s*\(/;

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
        violations.push(`${relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`);
      }

      expect(violations, violations.join("\n")).toEqual([]);
    },
  );
});
