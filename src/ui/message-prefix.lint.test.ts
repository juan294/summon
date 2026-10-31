// UX-M2: one voice for warnings, notes and errors. User-facing prefixes come from src/ui/output.ts
// (note() -> "summon: note:", warn() -> "summon: warning:", fail() -> "summon: error:"); a string
// literal that opens with its own "Warning:", "Note:" or "Error:" brings back the old styles.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = new URL("..", import.meta.url).pathname;

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walkTs(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
  );
}

/** A string literal that starts (after an optional `${...}` glyph) with a hand-written prefix. */
const HAND_WRITTEN_PREFIX = /["'`](?:\$\{[^}]*\}\s*)?(?:Warning|Note|Error):/;

function offenders(): string[] {
  const found: string[] = [];
  for (const file of walkTs(SRC_DIR)) {
    const rel = relative(SRC_DIR, file);
    if (rel.endsWith(".test.ts") || rel === "ui/output.ts" || rel.startsWith("e2e/") || rel.startsWith("fixtures/")) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (HAND_WRITTEN_PREFIX.test(code)) found.push(`${rel}:${i + 1}: ${code}`);
    });
  }
  return found;
}

describe("user-facing message prefixes (UX-M2)", () => {
  it("the pattern catches each old style and leaves the helpers' prefixes alone", () => {
    for (const bad of ['console.warn("Warning: x")', "`Note: on-stop`", "`${sym.warn} Warning: path`", 'console.error(`Error: Unknown`)']) {
      expect(HAND_WRITTEN_PREFIX.test(bad), bad).toBe(true);
    }
    for (const ok of ['warn("x")', "`summon: warning: x`", '"  Note: indented help text"', "`-- Note: dry-run header`"]) {
      expect(HAND_WRITTEN_PREFIX.test(ok), ok).toBe(false);
    }
  });

  it("no source file outside ui/output.ts writes its own Warning:, Note: or Error: prefix", () => {
    expect(offenders()).toEqual([]);
  });
});
