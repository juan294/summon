import { trustProject } from "../trust.js";
import type { CommandContext } from "./types.js";

export async function handleTrustCommand({ args }: CommandContext): Promise<void> {
  const dir = args[0] ?? ".";
  trustProject(typeof dir === "string" ? dir : ".");
  console.log(`✓ Trusted: ${dir}`);
}
