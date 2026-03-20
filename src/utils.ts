import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

/** Regex for safe command names — only letters, digits, hyphens, dots, underscores, plus signs. */
export const SAFE_COMMAND_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/;

/** @internal — exported for testing only */
export const GHOSTTY_PATHS = [
  "/Applications/Ghostty.app",
  join(homedir(), "Applications", "Ghostty.app"),
];

/**
 * Check whether Ghostty.app is installed at any known location.
 */
export function isGhosttyInstalled(): boolean {
  return GHOSTTY_PATHS.some((p) => existsSync(p));
}

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
      // Ctrl+C or EOF — exit with standard SIGINT code (128 + 2)
      console.log();
      process.exit(130);
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

/** User-facing path to the Accessibility settings pane. */
export const ACCESSIBILITY_SETTINGS_PATH = "System Settings > Privacy & Security > Accessibility";

/** Hint telling users which app to enable for accessibility. */
export const ACCESSIBILITY_ENABLE_HINT = "Enable your terminal app (e.g. Ghostty, Terminal, iTerm2) in the list.";

/** Explanation of why accessibility is needed. */
export const ACCESSIBILITY_REQUIRED_MSG = "Your terminal app needs Accessibility permission to use System Events.";

/**
 * Check whether an osascript error is an Accessibility permission denial.
 * macOS error -1719 (errAEAccessNotAllowed) surfaces as "assistive access" in the message.
 */
export function isAccessibilityError(message: string): boolean {
  return message.includes("assistive access") || message.includes("-1719");
}

/**
 * Check whether the current terminal has macOS Accessibility permission.
 * Summon uses System Events (for auto-resize and new-window) which requires
 * the calling terminal app to be granted Accessibility access.
 * Returns true if System Events responds, false otherwise.
 */
export function checkAccessibility(): boolean {
  try {
    execFileSync(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first process'],
      { encoding: "utf-8", timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Open System Settings directly to the Accessibility pane.
 * Silently fails if the `open` command errors — manual instructions
 * are always shown alongside this call.
 */
export function openAccessibilitySettings(): void {
  try {
    execFileSync("open", [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    ]);
  } catch {
    // Silently fail — the manual instructions are always shown alongside
  }
}
