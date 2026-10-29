/**
 * Guard: no release probe may skip itself.
 *
 * `describe.skipIf` in src/e2e/applescript-syntax.test.ts is precisely what
 * turned a required status check into a permanent no-op -- Ghostty installs,
 * the dictionary probe fails, the suite skips, and the job reports success with
 * zero assertions executed. A required probe whose prerequisite is missing MUST
 * fail so the analyzer records REQUIRED_MISS; it must never quietly pass.
 *
 * This test fails the moment anyone reintroduces that pattern here.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_DIR = dirname(fileURLToPath(import.meta.url));

// `.skip`, `.skipIf`, `.runIf`, `.todo`, `.concurrent.skip`, and bare
// `it.only`-style focus (which silently drops the rest of the suite).
const FORBIDDEN =
  /\b(?:describe|it|test)\s*\.\s*(?:skip|skipIf|runIf|todo|only)\b|\bctx\s*\.\s*skip\s*\(/;

function releaseSourceFiles(): string[] {
  return readdirSync(RELEASE_DIR)
    .filter((name) => name.endsWith(".ts"))
    // This guard necessarily names the forbidden patterns.
    .filter((name) => name !== "no-skip.test.ts");
}

describe("release probes cannot skip", () => {
  it("finds at least one probe file to police", () => {
    expect(releaseSourceFiles().length).toBeGreaterThan(0);
  });

  it.each(releaseSourceFiles())("%s contains no skip/only construct", (name) => {
    const source = readFileSync(join(RELEASE_DIR, name), "utf-8");
    const offending = source
      .split("\n")
      .map((line, i) => ({ line: line.trim(), number: i + 1 }))
      .filter(({ line }) => FORBIDDEN.test(line) && !line.startsWith("*") && !line.startsWith("//"));

    expect(
      offending,
      `${name} uses a skip/only construct: ${offending
        .map((o) => `line ${o.number}: ${o.line}`)
        .join("; ")}`,
    ).toEqual([]);
  });

  it("the forbidden pattern actually matches what it claims to", () => {
    // Guard the guard -- a regex that matches nothing would pass vacuously.
    expect(FORBIDDEN.test("describe.skipIf(!canRun)('x', () => {})")).toBe(true);
    expect(FORBIDDEN.test("it.skip('x')")).toBe(true);
    expect(FORBIDDEN.test("test.todo('x')")).toBe(true);
    expect(FORBIDDEN.test("describe.only('x')")).toBe(true);
    expect(FORBIDDEN.test("describe('x', () => {})")).toBe(false);
    expect(FORBIDDEN.test("it('skips nothing', () => {})")).toBe(false);
  });
});
