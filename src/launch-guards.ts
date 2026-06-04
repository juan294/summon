/**
 * launch-guards.ts — Pre-launch safety checks and command guards.
 *
 * Extracted from launcher.ts (AR-S1 #316).
 * Covers:
 *   - Ghostty installation check
 *   - Accessibility permission check
 *   - Dangerous command metacharacter confirmation with skip-pane support (UX-S2 #340)
 */

import {
  isGhosttyInstalled,
  isAccessibilityError,
  checkAccessibility,
  promptUser,
  ACCESSIBILITY_SETTINGS_PATH,
  ACCESSIBILITY_ENABLE_HINT,
  ACCESSIBILITY_REQUIRED_MSG,
} from "./utils.js";
import { commandHasShellMeta } from "./command-spec.js";

// Re-export for callers that previously imported these from utils via launcher
export { isAccessibilityError };

export function printAccessibilityHint(): void {
  console.error(ACCESSIBILITY_REQUIRED_MSG);
  console.error(`Grant access in: ${ACCESSIBILITY_SETTINGS_PATH}`);
  console.error(ACCESSIBILITY_ENABLE_HINT);
  console.error();
  console.error("Tip: Run 'summon doctor' to check all permissions.");
}

export function ensureGhostty(): void {
  if (!isGhosttyInstalled()) {
    const msg = "Ghostty.app not found. Please install Ghostty 1.3.1+ from https://ghostty.org";
    console.error(msg);
    throw new Error(msg);
  }
}

export function ensureAccessibility(): void {
  if (!checkAccessibility()) {
    console.error("Accessibility permission is required to launch workspaces.");
    console.error();
    printAccessibilityHint();
    throw new Error("Accessibility permission is required to launch workspaces.");
  }
}

/**
 * Result of confirmDangerousCommands for a single entry.
 * "proceed" — user confirmed or no dangerous commands.
 * "skip"    — user opted to skip this pane (UX-S2 #340).
 * "abort"   — user declined entirely.
 */
export type CommandConfirmResult = "proceed" | "skip" | "abort";

/**
 * Per-pane result after filtering.
 * The key is the config key (e.g. "shell", "pane.editor"); value is the command string.
 */
export interface DangerousCommandDecision {
  /** Keys that were confirmed (or were not dangerous). */
  confirmed: Array<[string, string]>;
  /** Keys that were skipped by the user pressing 's'. */
  skipped: Set<string>;
}

async function promptLower(question: string): Promise<string> {
  const answer = await promptUser(question);
  return answer.toLowerCase();
}

/**
 * Check if any command values contain shell metacharacters.
 * Prompts the user for each dangerous command:
 *   y / yes → proceed with this command
 *   s / skip → omit this pane from launch (UX-S2 #340)
 *   n / anything else → abort entire launch
 *
 * On non-TTY, refuses if any dangerous commands are present.
 * Returns a DangerousCommandDecision describing confirmed and skipped keys.
 */
export async function confirmDangerousCommands(
  commands: Array<[string, string]>,
): Promise<DangerousCommandDecision> {
  const dangerous: Array<[string, string]> = [];
  for (const [key, value] of commands) {
    if (commandHasShellMeta(value)) {
      dangerous.push([key, value]);
    }
  }

  const skipped = new Set<string>();

  if (dangerous.length === 0) {
    return { confirmed: commands, skipped };
  }

  const lines = dangerous.map(([key, value]) => `  ${key} = ${value}`).join("\n");
  const message = `Warning: config contains commands with shell metacharacters:\n${lines}`;
  console.warn(message);

  if (!process.stdin.isTTY) {
    // Non-TTY automation context: refuse dangerous commands that require interactive confirmation.
    // Exit 2 signals "dangerous commands present, cannot confirm non-interactively" (BE-H3 #364).
    console.error("summon: error: dangerous shell commands require interactive confirmation but stdin is not a TTY.");
    console.error("summon: error: run summon interactively, or use safe commands without shell metacharacters.");
    process.exit(2);
  }

  for (const [key, value] of dangerous) {
    const answer = await promptLower(
      `  ${key} = ${value}\nContinue? [Y/n/s(kip pane)] `,
    );
    if (answer === "s" || answer === "skip") {
      skipped.add(key);
    } else if (answer === "n" || answer === "no") {
      console.error("Aborted.");
      process.exit(1);
    }
    // Empty or "y"/"yes" → proceed (Y is the default, aligns with wizard convention)
  }

  const confirmed = commands.filter(([key]) => !skipped.has(key));
  return { confirmed, skipped };
}
