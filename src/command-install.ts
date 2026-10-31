/**
 * Command resolution and install for a launch (AR-M2, extracted from launcher.ts): checkCommand resolves without side
 * effects for the dry-run notes; ensureCommand stops the launch or offers the known install method.
 */
import { execFileSync } from "node:child_process";
import { markAttention } from "./backends/rex/launcher-tab.js";
import { resolveCommand as resolveCommandPath, describeCommandFailure, promptUser, PromptCancelled, QUICK_PROCESS_LIMITS } from "./utils.js";
import type { CommandFailureKind } from "./utils.js";
import { fail, err } from "./ui/output.js";

const KNOWN_INSTALL_COMMANDS: Record<string, () => [string, string[]] | null> = {
  claude: () => ["npm", ["install", "-g", "@anthropic-ai/claude-code"]],
  lazygit: () => {
    try {
      execFileSync("/bin/sh", ["-c", "command -v brew"], { stdio: "ignore", ...QUICK_PROCESS_LIMITS });
      return ["brew", ["install", "lazygit"]];
    } catch {
      return null;
    }
  },
};

/** The install command for a known tool, or null (own keys only, so `toString` is not a tool). */
function knownInstallCommand(cmd: string): [string, string[]] | null {
  return Object.hasOwn(KNOWN_INSTALL_COMMANDS, cmd) ? KNOWN_INSTALL_COMMANDS[cmd]!() : null;
}

/** Why a command did not resolve, worded once for the launch error and the dry-run note. */
export const COMMAND_FAILURE_REASONS: Record<CommandFailureKind, string> = {
  "missing-path": "was not found or is not executable",
  "bad-form": "is not a command name or an absolute path",
  "missing-name": "is not on your PATH",
};

export type CommandCheck =
  | { resolved: string }
  | { failure: CommandFailureKind; install: [string, string[]] | null };

/** Resolve a command, or say why not and how a launch could install it. Never prompts or installs. */
export function checkCommand(cmd: string): CommandCheck {
  const resolved = resolveCommandPath(cmd);
  if (resolved) return { resolved };
  const failure = describeCommandFailure(cmd);
  return { failure, install: failure === "missing-name" ? knownInstallCommand(cmd) : null };
}

/**
 * Where to change a failing command: `summon set <key>` for a config key, the layout file for a
 * tree pane (`pane.<leaf>`), which `summon set` does not accept.
 */
export function commandFixHint(configKey: string, layoutName?: string): string {
  if (configKey.startsWith("pane.")) {
    return layoutName
      ? `change \`${configKey}=\` in layout ${layoutName}: summon layout edit ${layoutName}`
      : `change \`${configKey}=\` in your layout file`;
  }
  return `change your config with: summon set ${configKey} <command>`;
}

/** Print the failure and its fix, then stop the launch. */
function stopLaunch(headline: string, detail: string, errorMessage = headline): never {
  fail(headline);
  err(detail);
  throw new Error(errorMessage);
}

export async function ensureCommand(cmd: string, hint: string): Promise<string> {
  const check = checkCommand(cmd);
  if ("resolved" in check) return check.resolved;

  const reason = `\`${cmd}\` ${COMMAND_FAILURE_REASONS[check.failure]}`;
  if (check.failure === "missing-path") {
    stopLaunch(`${reason}.`, `Please fix the path or ${hint}`);
  }
  if (check.failure === "bad-form") {
    stopLaunch(
      `${reason}. Use a command on your PATH (for example \`gh-glance\`) or a full path that starts with \`/\`.`,
      `Please ${hint}`,
      `${reason}.`,
    );
  }

  const installCmd = check.install;

  if (!installCmd) {
    stopLaunch(
      `\`${cmd}\` is required but not installed, and no known install method was found.`,
      `Please install \`${cmd}\` manually or ${hint}`,
      `\`${cmd}\` is required but not installed.`,
    );
  }

  const [installBin, installArgs] = installCmd;
  const installDisplay = [installBin, ...installArgs].join(" ");

  console.log(`\`${cmd}\` is not installed on this machine.`);
  const answer = (await promptUser(`Install it now with \`${installDisplay}\`? [y/N] `)).toLowerCase();

  if (answer !== "y" && answer !== "yes") {
    console.log(`Exiting — \`${cmd}\` is needed for this workspace layout. To use another command, ${hint}`);
    // UX-L3: declining is a user cancel (exit 130); the line above already says why, so no error follows it.
    throw new PromptCancelled(`\`${cmd}\` is needed for this workspace layout.`);
  }

  console.log(`Running: ${installDisplay}`);
  // QA-M3: the installer writes to the terminal directly, so the D1 launcher tab stays for its output.
  markAttention();
  try {
    execFileSync(installBin, installArgs, { stdio: "inherit" });
  } catch {
    fail(`Failed to install \`${cmd}\`. Please install it manually and try again.`);
    throw new Error(`Failed to install \`${cmd}\`.`);
  }

  const postInstallPath = resolveCommandPath(cmd);
  if (!postInstallPath) {
    fail(`\`${cmd}\` still not found after install. Please check your PATH.`);
    throw new Error(`\`${cmd}\` still not found after install.`);
  }

  console.log(`\`${cmd}\` installed successfully!\n`);
  return postInstallPath;
}
