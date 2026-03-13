import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

/** Regex for safe command names — only letters, digits, hyphens, dots, underscores, plus signs. */
export const SAFE_COMMAND_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/;

/** Known Ghostty.app install locations on macOS. */
export const GHOSTTY_PATHS = [
  "/Applications/Ghostty.app",
  join(homedir(), "Applications", "Ghostty.app"),
];

/**
 * Prompt the user with a question via readline and return the trimmed answer.
 * Dynamically imports node:readline so callers that never prompt pay no cost.
 */
export async function promptUser(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Resolve a command name to its full path, or return null if not found.
 * Returns null without calling the shell if the command name is invalid.
 */
export function resolveCommand(cmd: string): string | null {
  if (!SAFE_COMMAND_RE.test(cmd)) return null;
  try {
    return execFileSync("/bin/sh", ["-c", `command -v "$1"`, "--", cmd], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}
