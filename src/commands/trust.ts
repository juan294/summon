import { handleTrustCommand as runTrustCommand } from "../trust.js";
import type { CommandContext } from "./types.js";

export async function handleTrustCommand({ args }: CommandContext): Promise<void> {
  const dir = args[0] ?? ".";
  runTrustCommand(typeof dir === "string" ? dir : ".");
}
