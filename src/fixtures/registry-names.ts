import { readFileSync } from "node:fs";

/**
 * The dispatch registry's subcommand names, in declaration order, read from src/index.ts
 * (importing the entry point would run the CLI).
 */
export function registryNames(): string[] {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/^\s+(\w+):\s+\(\) => import\(/gm)].map((m) => m[1]!);
  if (names.length === 0) throw new Error("registryNames: no dispatch registry entries found in src/index.ts");
  return names;
}
