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

/** Application name used in AppleScript `tell` blocks. */
export const GHOSTTY_APP_NAME = "Ghostty";

/** Environment variable set inside summon workspaces to detect nesting. */
export const SUMMON_WORKSPACE_ENV = "SUMMON_WORKSPACE";

/**
 * Prompt the user with a question via readline and return the trimmed answer.
 * Dynamically imports node:readline so callers that never prompt pay no cost.
 */
export async function promptUser(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const onClose = () => {
      // Ctrl+C or EOF — exit cleanly without error dump
      console.log();
      process.exit(0);
    };
    rl.on("close", onClose);
    rl.question(question, (answer) => {
      rl.off("close", onClose);
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Print an error message followed by a usage hint, then exit with code 1.
 * Consolidates the repeated `console.error(msg); console.error("Run 'summon --help'..."); process.exit(1)` pattern.
 * When called without a message, only the usage hint is printed before exiting.
 */
export function exitWithUsageHint(message?: string): never {
  if (message) {
    console.error(message);
  }
  console.error("Run 'summon --help' for usage information.");
  process.exit(1);
}

/**
 * Safely extract a message from an unknown catch value.
 * Returns `.message` for Error instances, `String(err)` for everything else.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
