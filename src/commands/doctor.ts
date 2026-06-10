import { join } from "node:path";
import { homedir } from "node:os";
import { listConfig, listProjects } from "../config.js";
import {
  checkAccessibility,
  resolveCommand,
  GHOSTTY_PATHS,
  ACCESSIBILITY_REQUIRED_MSG,
  ACCESSIBILITY_SETTINGS_PATH,
  ACCESSIBILITY_ENABLE_HINT,
} from "../utils.js";
import { commandExecutable } from "../command-spec.js";
import { green, red, yellow, bold, dim } from "../ui/ansi.js";
import { sym } from "../ui/symbols.js";
import { CONFIG_DIR, TRUST_FILE } from "../paths.js";
import type { CommandContext } from "./types.js";

const PASS = green(`${sym.ok} PASS`);
const FAIL = red(`${sym.fail} FAIL`);

export async function handleDoctorCommand({ values }: CommandContext): Promise<void> {
  const {
    existsSync,
    readFileSync,
    copyFileSync,
    appendFileSync,
    mkdirSync,
  } = await import("node:fs");

  const fixFlag = values.fix;
  const verboseFlag = values.verbose;

  // Track pass/fail counts for summary (UX-M4, UX-M5, UX-M9)
  let totalIssues = 0;
  let autoFixable = 0;
  let totalChecks = 0;
  let passedChecks = 0;

  // FE-M5: diagnostic output goes to stderr so pipelines (e.g. summon export > .summon)
  // are not contaminated. Machine-consumable data (exit codes) stay on stdout.
  console.error("Checking Ghostty configuration...\n");

  const ghosttyConfigPath = join(homedir(), ".config", "ghostty", "config");

  if (!existsSync(ghosttyConfigPath)) {
    console.error("  - No Ghostty config file found at ~/.config/ghostty/config");
    console.error("    Create one to customize your terminal experience.");
    console.error();
  }

  let configContent = existsSync(ghosttyConfigPath)
    ? readFileSync(ghosttyConfigPath, "utf-8")
    : "";

  const checks = [
    {
      name: "Command Notifications",
      key: "notify-on-command-finish",
      recommended: "unfocused",
      reason: "Get notified when long-running commands finish",
      regex: /^\s*notify-on-command-finish\s*=/m,
    },
    {
      name: "Shell Integration",
      key: "shell-integration",
      recommended: "detect",
      reason: "Enable prompt navigation, click-to-move cursor, and smart close",
      regex: /^\s*shell-integration\s*=/m,
    },
  ];

  // Apply --fix before running checks so the check loop sees updated content
  let appliedFixes = false;
  if (fixFlag) {
    const toApply = checks.filter(c => !c.regex.test(configContent));
    if (toApply.length > 0) {
      const ghosttyDir = join(homedir(), ".config", "ghostty");
      mkdirSync(ghosttyDir, { recursive: true });
      if (existsSync(ghosttyConfigPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = `${ghosttyConfigPath}.bak.${timestamp}`;
        copyFileSync(ghosttyConfigPath, backup);
        console.error(`  Backed up ${ghosttyConfigPath} → ${backup}`);
      }
      const additions = toApply.map(s => `${s.key} = ${s.recommended}`).join("\n");
      appendFileSync(ghosttyConfigPath, "\n# Added by summon doctor --fix\n" + additions + "\n");
      console.error(`  Added ${toApply.length} setting(s) to ${ghosttyConfigPath}`);
      console.error();
      configContent = readFileSync(ghosttyConfigPath, "utf-8");
      appliedFixes = true;
    }
  }

  let allGood = true;
  const missingSettings: Array<{ key: string; recommended: string }> = [];

  for (const check of checks) {
    const isSet = check.regex.test(configContent);
    totalChecks++;
    if (isSet) {
      passedChecks++;
      console.error(`  ${PASS}  ${check.name} (${check.key}) is configured`);
    } else {
      allGood = false;
      totalIssues++;
      autoFixable++;
      missingSettings.push({ key: check.key, recommended: check.recommended });
      console.error(`  ${FAIL}  ${check.name}`);
      if (!fixFlag) {
        console.error("    Add to ~/.config/ghostty/config:");
        console.error(`    ${check.key} = ${check.recommended}`);
        console.error(`    ${check.reason}`);
      }
      console.error();
    }
  }

  console.error();
  console.error("Checking permissions...\n");

  const accessOk = checkAccessibility();
  totalChecks++;
  if (accessOk) {
    passedChecks++;
    console.error(`  ${PASS}  Accessibility permission is granted`);
  } else {
    allGood = false;
    totalIssues++;
    console.error(`  ${FAIL}  Accessibility permission is required`);
    console.error(`    ${ACCESSIBILITY_REQUIRED_MSG}`);
    console.error(`    ${ACCESSIBILITY_SETTINGS_PATH}`);
    console.error(`    ${ACCESSIBILITY_ENABLE_HINT}`);
    console.error();
  }

  const userConfig = listConfig();
  const commandChecks: Array<{ key: string; cmd: string }> = [];
  const editorCmd = userConfig.get("editor");
  const sidebarCmd = userConfig.get("sidebar");
  if (editorCmd) commandChecks.push({ key: "editor", cmd: editorCmd });
  if (sidebarCmd) commandChecks.push({ key: "sidebar", cmd: sidebarCmd });

  if (commandChecks.length > 0) {
    console.error();
    console.error("Checking configured commands...\n");

    for (const { key, cmd } of commandChecks) {
      const binary = commandExecutable(cmd);
      const found = binary ? resolveCommand(binary) : null;
      totalChecks++;
      if (found) {
        passedChecks++;
        console.error(`  ${PASS}  ${key} command "${binary}" found at ${found}`);
      } else {
        allGood = false;
        totalIssues++;
        console.error(`  ${FAIL}  ${key} command "${binary ?? cmd}" not found in PATH`);
        console.error(`    Install "${binary ?? cmd}" or change with: summon set ${key} <command>`);
        console.error();
      }
    }
  }

  console.error();
  console.error("Checking port conflicts...\n");
  const { detectAllPorts } = await import("../ports.js");
  const { conflicts } = await detectAllPorts();
  totalChecks++;
  if (conflicts.size === 0) {
    passedChecks++;
    console.error(`  ${PASS}  No port conflicts (${listProjects().size} projects checked)`);
  } else {
    allGood = false;
    for (const [port, projects] of conflicts) {
      totalIssues++;
      console.error(`  ${FAIL}  Port conflict: port ${port} used by ${projects.join(", ")}`);
    }
  }

  console.error();

  // Pass/fail summary (UX-M4, UX-M9)
  if (totalIssues === 0) {
    console.error(green(`${sym.ok} ${passedChecks}/${totalChecks} checks passed.`));
  } else {
    const failedChecks = totalChecks - passedChecks;
    const fixablePart = autoFixable > 0 ? ` (${autoFixable} auto-fixable with --fix)` : "";
    console.error(yellow(bold(`${passedChecks}/${totalChecks} checks passed — ${failedChecks} failed${fixablePart}.`)));
    console.error(`  Run 'summon doctor --fix' to apply fixes, or 'summon setup' to reconfigure.`);
  }

  // Verbose diagnostic section (#504 DO-S1)
  // Gives users full diagnostic context without needing SUMMON_DEBUG=1.
  if (verboseFlag) {
    console.error();
    console.error(bold("Diagnostic info:"));
    console.error();

    // Summon version
    console.error(`  Summon version:  ${__VERSION__}`);

    // Node.js version
    console.error(`  Node.js version: ${process.version}`);

    // Config directory
    console.error(`  Config dir:      ${CONFIG_DIR}`);

    // Ghostty paths and accessibility
    const ghosttyFound = GHOSTTY_PATHS.find((p) => existsSync(p));
    if (ghosttyFound) {
      console.error(`  Ghostty path:    ${ghosttyFound} ${dim("(found)")}`);
    } else {
      console.error(`  Ghostty path:    ${GHOSTTY_PATHS.join(", ")} ${dim("(not found)")}`);
    }

    // Trust DB
    let trustedCount = 0;
    if (existsSync(TRUST_FILE)) {
      try {
        const raw = readFileSync(TRUST_FILE, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          trustedCount = Object.keys(parsed as Record<string, string>).length;
        }
      } catch {
        // ignore parse errors — count stays 0
      }
    }
    console.error(`  Trust DB:        ${TRUST_FILE}`);
    console.error(`  Trusted projects: ${trustedCount} project${trustedCount === 1 ? "" : "s"}`);
    console.error();
  }

  const issuesRemain = appliedFixes ? !accessOk : !allGood;
  if (issuesRemain) {
    console.error("Exit code 2: issues were found. See above for details.");
    process.exit(2);
  }
}
