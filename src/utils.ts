import { existsSync, mkdirSync } from "node:fs";
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
 * Thrown by `promptUser` when the user cancels via Ctrl+C or EOF.
 * Callers that want exit-on-cancel can catch this at the top level;
 * wizard callers can catch it to clean up resources before exiting.
 */
export class PromptCancelled extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "PromptCancelled";
  }
}

/**
 * Prompt the user with a question via readline and return the trimmed answer.
 * Dynamically imports node:readline so callers that never prompt pay no cost.
 * Throws `PromptCancelled` on Ctrl+C or EOF instead of calling process.exit,
 * allowing callers to perform cleanup before exiting.
 */
export async function promptUser(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    const onClose = () => {
      // Ctrl+C or EOF — throw so callers can clean up
      console.log();
      reject(new PromptCancelled("Cancelled"));
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
 * Uses /usr/bin/which directly to avoid shell invocation.
 */
export function resolveCommand(cmd: string): string | null {
  if (!SAFE_COMMAND_RE.test(cmd)) return null;
  try {
    return execFileSync("/usr/bin/which", [cmd], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** User-facing path to the Accessibility settings pane. */
export const ACCESSIBILITY_SETTINGS_PATH = "System Settings > Privacy & Security > Accessibility";

/** Hint telling users to find and enable Ghostty in the Accessibility list. */
export const ACCESSIBILITY_ENABLE_HINT = "Find Ghostty in the list and enable it.";

/** Explanation of why Ghostty needs Accessibility permission. */
export const ACCESSIBILITY_REQUIRED_MSG = "Ghostty needs Accessibility permission to control panes via System Events.";

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
      { encoding: "utf-8", timeout: 2000 },
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

/**
 * Returns process.env with git context variables removed.
 * Prevents an inherited GIT_DIR/GIT_WORK_TREE (e.g. from a pre-commit hook)
 * from overriding the -C flag and making every directory appear as the current repo.
 */
export function gitSafeEnv(): NodeJS.ProcessEnv {
  const { GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, ...clean } = process.env;
  return clean;
}

/**
 * Returns true when SUMMON_DEBUG=1 is set in the environment.
 */
export const isDebug = (): boolean => process.env["SUMMON_DEBUG"] === "1";

/**
 * Write a debug message to stderr, but only when SUMMON_DEBUG=1.
 * Each message includes an ISO timestamp for post-launch triage.
 */
export function debugLog(...args: unknown[]): void {
  if (isDebug()) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[summon:debug ${timestamp}] ${args.join(" ")}\n`);
  }
}

/**
 * Lazily check whether the current environment supports ANSI color output.
 * Evaluated at call time so that FORCE_COLOR / NO_COLOR changes after module
 * load are respected (e.g. piped output, testing).
 *
 * Priority:
 *   - NO_COLOR (any value) → false  (https://no-color.org/)
 *   - FORCE_COLOR=1        → true
 *   - FORCE_COLOR=0        → false
 *   - Otherwise: process.stdout.isTTY
 */
export function supportsColor(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] === "1") return true;
  if (process.env["FORCE_COLOR"] === "0") return false;
  return !!process.stdout.isTTY;
}

/**
 * Returns the path to the summon debug log directory (~/.config/summon/logs/).
 * Creates the directory if it does not already exist.
 */
export function getLogDir(): string {
  const dir = join(homedir(), ".config", "summon", "logs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Single-keypress yes/no confirmation.
 *
 * Accepts:
 *   y / Y        → true
 *   n / N        → false
 *   Enter (\r or \n) → false (default no)
 *   Escape (\x1b)    → throws PromptCancelled
 *   Ctrl+C (\x03)    → throws PromptCancelled
 *
 * Other keys are ignored — waits for the next keypress.
 */
export async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `);

  return new Promise<boolean>((resolve, reject) => {
    const stdin = process.stdin;

    // If raw mode is available (TTY), use single-keypress mode.
    // In non-TTY / test environments where setRawMode is not present, fall
    // back to a readline-style approach via the once("data") path.
    const hasRawMode = typeof (stdin as NodeJS.ReadStream).setRawMode === "function";

    if (hasRawMode) {
      (stdin as NodeJS.ReadStream).setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onKey = (key: string) => {
      if (hasRawMode) {
        (stdin as NodeJS.ReadStream).setRawMode(false);
      }
      stdin.pause();
      process.stdout.write("\n");

      if (key === "\x03" || key === "\x1b") {
        reject(new PromptCancelled());
        return;
      }
      if (key === "\r" || key === "\n") {
        resolve(false);
        return;
      }
      if (key === "y" || key === "Y") {
        resolve(true);
        return;
      }
      if (key === "n" || key === "N") {
        resolve(false);
        return;
      }

      // Unrecognised key — keep listening
      if (hasRawMode) {
        (stdin as NodeJS.ReadStream).setRawMode(true);
      }
      stdin.resume();
      stdin.once("data", onKey);
    };

    stdin.once("data", onKey);
  });
}
