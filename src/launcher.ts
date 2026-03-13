import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync, execFileSync } from "node:child_process";
import {
  planLayout,
  isPresetName,
  getPreset,
  PANES_MIN,
  PANES_DEFAULT,
  EDITOR_SIZE_MIN,
  EDITOR_SIZE_MAX,
  EDITOR_SIZE_DEFAULT,
} from "./layout.js";
import type { LayoutOptions } from "./layout.js";
import { listConfig, readKVFile } from "./config.js";
import { generateAppleScript } from "./script.js";

const SAFE_COMMAND_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/;

export interface CLIOverrides {
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  server?: string;
  "auto-resize"?: string;
  dryRun?: boolean;
}

const GHOSTTY_PATHS = [
  "/Applications/Ghostty.app",
  join(homedir(), "Applications", "Ghostty.app"),
];

function ensureGhostty(): void {
  if (!GHOSTTY_PATHS.some((p) => existsSync(p))) {
    console.error(
      "Ghostty.app not found. Please install Ghostty 1.3.0+ from https://ghostty.org",
    );
    process.exit(1);
  }
}

function executeScript(script: string): void {
  try {
    execSync("osascript", { input: script, encoding: "utf-8" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Failed to execute workspace script: ${detail}`);
    console.error("Is Ghostty running?");
    process.exit(1);
  }
}

/** Resolve a command name to its full path, or return null if not found. */
function resolveCommand(cmd: string): string | null {
  if (!SAFE_COMMAND_RE.test(cmd)) {
    console.error(`Invalid command name: "${cmd}". Command names may only contain letters, digits, hyphens, dots, underscores, and plus signs.`);
    process.exit(1);
  }
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

async function prompt(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

const KNOWN_INSTALL_COMMANDS: Record<string, () => [string, string[]] | null> = {
  claude: () => ["npm", ["install", "-g", "@anthropic-ai/claude-code"]],
  lazygit: () => {
    try {
      execSync("command -v brew", { stdio: "ignore" });
      return ["brew", ["install", "lazygit"]];
    } catch {
      return null;
    }
  },
};

async function ensureCommand(cmd: string, configKey: string): Promise<string> {
  const resolved = resolveCommand(cmd);
  if (resolved) return resolved;

  const getInstall = KNOWN_INSTALL_COMMANDS[cmd];
  const installCmd = getInstall ? getInstall() : null;

  if (!installCmd) {
    console.error(
      `\`${cmd}\` is required but not installed, and no known install method was found.`,
    );
    console.error(
      `Please install \`${cmd}\` manually or change your config with: summon set ${configKey} <command>`,
    );
    process.exit(1);
  }

  const [installBin, installArgs] = installCmd;
  const installDisplay = [installBin, ...installArgs].join(" ");

  console.log(`\`${cmd}\` is required but not installed on this machine.`);
  const answer = await prompt(`Install it now with \`${installDisplay}\`? [Y/n] `);

  if (answer && answer !== "y" && answer !== "yes") {
    console.log(`\`${cmd}\` is required for this workspace layout. Exiting.`);
    process.exit(1);
  }

  console.log(`Running: ${installDisplay}`);
  try {
    execFileSync(installBin, installArgs, { stdio: "inherit" });
  } catch {
    console.error(
      `Failed to install \`${cmd}\`. Please install it manually and try again.`,
    );
    process.exit(1);
  }

  const postInstallPath = resolveCommand(cmd);
  if (!postInstallPath) {
    console.error(`\`${cmd}\` still not found after install. Please check your PATH.`);
    process.exit(1);
  }

  console.log(`\`${cmd}\` installed successfully!\n`);
  return postInstallPath;
}

interface ResolvedConfig {
  opts: Partial<LayoutOptions>;
}

export function resolveConfig(targetDir: string, cliOverrides: CLIOverrides): ResolvedConfig {
  const project = readKVFile(join(targetDir, ".summon"));
  const machineConfig = listConfig();

  // Resolve layout preset: CLI > project > global
  const layoutKey = cliOverrides.layout ?? project.get("layout") ?? machineConfig.get("layout");
  let base: Partial<LayoutOptions> = {};
  if (layoutKey) {
    if (isPresetName(layoutKey)) {
      base = getPreset(layoutKey);
    } else {
      console.warn(
        `Unknown layout preset: "${layoutKey}". Valid presets: minimal, full, pair, cli, mtop. Using defaults.`,
      );
    }
  }

  // Layer: CLI > project > global > preset (for each config key)
  // Empty strings in config files mean "unset" — skip to next layer
  const pick = (cli: string | undefined, projKey: string): string | undefined => {
    if (cli !== undefined) return cli;
    return project.get(projKey) || machineConfig.get(projKey) || undefined;
  };

  const editor = pick(cliOverrides.editor, "editor");
  const sidebar = pick(cliOverrides.sidebar, "sidebar");
  const panes = pick(cliOverrides.panes, "panes");
  const editorSize = pick(cliOverrides["editor-size"], "editor-size");
  const server = pick(cliOverrides.server, "server");
  const autoResize = pick(cliOverrides["auto-resize"], "auto-resize");

  const result: Partial<LayoutOptions> = { ...base };
  if (editor !== undefined) result.editor = editor;
  if (sidebar !== undefined) result.sidebarCommand = sidebar;
  if (panes !== undefined) {
    const parsed = parseInt(panes, 10);
    if (Number.isNaN(parsed) || parsed < PANES_MIN) {
      console.warn(
        `Invalid panes value: "${panes}". Must be a positive integer. Using default (${PANES_DEFAULT}).`,
      );
      result.editorPanes = PANES_DEFAULT;
    } else {
      result.editorPanes = parsed;
    }
  }
  if (editorSize !== undefined) {
    const parsed = parseInt(editorSize, 10);
    if (Number.isNaN(parsed) || parsed < EDITOR_SIZE_MIN || parsed > EDITOR_SIZE_MAX) {
      console.warn(
        `Invalid editor-size value: "${editorSize}". Must be ${EDITOR_SIZE_MIN}-${EDITOR_SIZE_MAX}. Using default (${EDITOR_SIZE_DEFAULT}).`,
      );
      result.editorSize = EDITOR_SIZE_DEFAULT;
    } else {
      result.editorSize = parsed;
    }
  }
  if (server !== undefined) result.server = server;
  if (autoResize !== undefined) result.autoResize = autoResize === "true";

  return { opts: result };
}

export async function launch(targetDir: string, cliOverrides?: CLIOverrides): Promise<void> {
  if (!existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const { opts } = resolveConfig(targetDir, cliOverrides ?? {});
  const plan = planLayout(opts);
  const loginShell = process.env.SHELL ?? "/bin/bash";

  if (cliOverrides?.dryRun) {
    const script = generateAppleScript(plan, targetDir, loginShell);
    console.log(script);
    return;
  }

  ensureGhostty();

  // Cache resolved command paths so the same binary is only looked up once,
  // even when it appears in multiple roles (e.g., editor + secondaryEditor).
  const resolvedCache = new Map<string, string>();
  const ensureAndResolve = async (cmdString: string, configKey: string): Promise<string> => {
    const parts = cmdString.split(" ");
    const binary = parts[0]!;
    const cached = resolvedCache.get(binary);
    if (cached) {
      parts[0] = cached;
    } else {
      parts[0] = await ensureCommand(binary, configKey);
      resolvedCache.set(binary, parts[0]);
    }
    return parts.join(" ");
  };

  if (plan.editor) plan.editor = await ensureAndResolve(plan.editor, "editor");
  if (plan.sidebarCommand) plan.sidebarCommand = await ensureAndResolve(plan.sidebarCommand, "sidebar");
  if (plan.secondaryEditor) plan.secondaryEditor = await ensureAndResolve(plan.secondaryEditor, "editor");
  if (plan.serverCommand) plan.serverCommand = await ensureAndResolve(plan.serverCommand, "server");

  const script = generateAppleScript(plan, targetDir, loginShell);
  executeScript(script);
}
