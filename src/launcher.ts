import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { execSync, execFileSync } from "node:child_process";
import { planLayout, isPresetName, getPreset } from "./layout.js";
import type { LayoutOptions } from "./layout.js";
import { getConfig, readKVFile } from "./config.js";
import { generateAppleScript } from "./script.js";

const SAFE_COMMAND_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/;

export interface CLIOverrides {
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  server?: string;
  dryRun?: boolean;
}

function ensureGhostty(): void {
  if (!existsSync("/Applications/Ghostty.app")) {
    console.error(
      "Ghostty.app not found. Please install Ghostty 1.3.0+ from https://ghostty.org",
    );
    process.exit(1);
  }
}

function executeScript(script: string): void {
  execSync("osascript", { input: script, encoding: "utf-8" });
}

export function resolveFullPath(cmdString: string): string {
  const parts = cmdString.split(" ");
  const bin = parts[0]!;
  if (!SAFE_COMMAND_RE.test(bin)) return cmdString;
  try {
    const fullPath = execSync(`command -v ${bin}`, { encoding: "utf-8" }).trim();
    parts[0] = fullPath;
    return parts.join(" ");
  } catch {
    return cmdString;
  }
}

function isCommandInstalled(cmd: string): boolean {
  if (!SAFE_COMMAND_RE.test(cmd)) {
    console.error(`Invalid command name: "${cmd}". Command names may only contain letters, digits, hyphens, dots, underscores, and plus signs.`);
    process.exit(1);
  }
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function prompt(question: string): Promise<string> {
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

async function ensureCommand(cmd: string): Promise<void> {
  if (isCommandInstalled(cmd)) return;

  const getInstall = KNOWN_INSTALL_COMMANDS[cmd];
  const installCmd = getInstall ? getInstall() : null;

  if (!installCmd) {
    console.error(
      `\`${cmd}\` is required but not installed, and no known install method was found.`,
    );
    console.error(
      `Please install \`${cmd}\` manually or change your config with: summon set editor <command>`,
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

  if (!isCommandInstalled(cmd)) {
    console.error(`\`${cmd}\` still not found after install. Please check your PATH.`);
    process.exit(1);
  }

  console.log(`\`${cmd}\` installed successfully!\n`);
}

interface ResolvedConfig {
  opts: Partial<LayoutOptions>;
}

export function resolveConfig(targetDir: string, cliOverrides: CLIOverrides): ResolvedConfig {
  const project = readKVFile(join(targetDir, ".summon"));

  // Resolve layout preset: CLI > project > global
  const layoutKey = cliOverrides.layout ?? project.get("layout") ?? getConfig("layout");
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
  const pick = (cli: string | undefined, projKey: string): string | undefined =>
    cli ?? project.get(projKey) ?? getConfig(projKey);

  const editor = pick(cliOverrides.editor, "editor");
  const sidebar = pick(cliOverrides.sidebar, "sidebar");
  const panes = pick(cliOverrides.panes, "panes");
  const editorSize = pick(cliOverrides["editor-size"], "editor-size");
  const server = pick(cliOverrides.server, "server");

  const result: Partial<LayoutOptions> = { ...base };
  if (editor !== undefined) result.editor = editor;
  if (sidebar !== undefined) result.sidebarCommand = sidebar;
  if (panes !== undefined) {
    const parsed = parseInt(panes, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      console.warn(
        `Invalid panes value: "${panes}". Must be a positive integer. Using default (2).`,
      );
      result.editorPanes = 2;
    } else {
      result.editorPanes = parsed;
    }
  }
  if (editorSize !== undefined) {
    const parsed = parseInt(editorSize, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 99) {
      console.warn(
        `Invalid editor-size value: "${editorSize}". Must be 1-99. Using default (75).`,
      );
      result.editorSize = 75;
    } else {
      result.editorSize = parsed;
    }
  }
  if (server !== undefined) result.server = server;

  return { opts: result };
}

export async function launch(targetDir: string, cliOverrides?: CLIOverrides): Promise<void> {
  if (!existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  ensureGhostty();

  const { opts } = resolveConfig(targetDir, cliOverrides ?? {});
  const plan = planLayout(opts);

  if (plan.editor) await ensureCommand(plan.editor);
  if (plan.sidebarCommand) await ensureCommand(plan.sidebarCommand);
  if (plan.secondaryEditor) {
    const secondaryBin = plan.secondaryEditor.split(" ")[0]!;
    await ensureCommand(secondaryBin);
  }
  if (plan.serverCommand) {
    const serverBin = plan.serverCommand.split(" ")[0]!;
    await ensureCommand(serverBin);
  }

  // Resolve to full paths — Ghostty's config-launched panes use non-login shells without PATH
  if (plan.editor) plan.editor = resolveFullPath(plan.editor);
  if (plan.sidebarCommand) plan.sidebarCommand = resolveFullPath(plan.sidebarCommand);
  if (plan.secondaryEditor) plan.secondaryEditor = resolveFullPath(plan.secondaryEditor);
  if (plan.serverCommand) plan.serverCommand = resolveFullPath(plan.serverCommand);

  const script = generateAppleScript(plan, targetDir);

  if (cliOverrides?.dryRun) {
    console.log(script);
    return;
  }

  executeScript(script);
}
