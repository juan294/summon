import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { planLayout, isPresetName, getPreset } from "./layout.js";
import type { LayoutOptions } from "./layout.js";
import { getConfig, readKVFile } from "./config.js";
import { generateAppleScript } from "./script.js";

export interface CLIOverrides {
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  server?: string;
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

function isCommandInstalled(cmd: string): boolean {
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

const KNOWN_INSTALL_COMMANDS: Record<string, () => string | null> = {
  claude: () => "npm install -g @anthropic-ai/claude-code",
  lazygit: () => {
    try {
      execSync("command -v brew", { stdio: "ignore" });
      return "brew install lazygit";
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

  console.log(`\`${cmd}\` is required but not installed on this machine.`);
  const answer = await prompt(`Install it now with \`${installCmd}\`? [Y/n] `);

  if (answer && answer !== "y" && answer !== "yes") {
    console.log(`\`${cmd}\` is required for this workspace layout. Exiting.`);
    process.exit(1);
  }

  console.log(`Running: ${installCmd}`);
  try {
    execSync(installCmd, { stdio: "inherit" });
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

function parseIntOption(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
  defaultVal?: number,
): number | undefined {
  if (raw === undefined) return defaultVal;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    const range = max === Infinity ? `a positive integer` : `${min}-${max}`;
    const def = defaultVal ?? (name === "panes" ? 3 : 75);
    console.warn(`Invalid ${name} value: "${raw}". Must be ${range}. Using default (${def}).`);
    return def;
  }
  return parsed;
}

export interface ResolvedConfig {
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
  result.editorPanes = parseIntOption(panes, "panes", 1, Infinity, result.editorPanes);
  result.editorSize = parseIntOption(editorSize, "editor-size", 1, 99, result.editorSize);
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

  const script = generateAppleScript(plan, targetDir);
  executeScript(script);
}
