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

  console.log("Checking Ghostty configuration...\n");

  const ghosttyConfigPath = join(homedir(), ".config", "ghostty", "config");

  if (!existsSync(ghosttyConfigPath)) {
    console.log("  - No Ghostty config file found at ~/.config/ghostty/config");
    console.log("    Create one to customize your terminal experience.");
    console.log();
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
        console.log(`  Backed up ${ghosttyConfigPath} → ${backup}`);
      }
      const additions = toApply.map(s => `${s.key} = ${s.recommended}`).join("\n");
      appendFileSync(ghosttyConfigPath, "\n# Added by summon doctor --fix\n" + additions + "\n");
      console.log(`  Added ${toApply.length} setting(s) to ${ghosttyConfigPath}`);
      console.log();
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
      console.log(`  ${PASS}  ${check.name} (${check.key}) is configured`);
    } else {
      allGood = false;
      totalIssues++;
      autoFixable++;
      missingSettings.push({ key: check.key, recommended: check.recommended });
      console.log(`  ${FAIL}  ${check.name}`);
      if (!fixFlag) {
        console.log("    Add to ~/.config/ghostty/config:");
        console.log(`    ${check.key} = ${check.recommended}`);
        console.log(`    ${check.reason}`);
      }
      console.log();
    }
  }

  console.log();
  console.log("Checking permissions...\n");

  const accessOk = checkAccessibility();
  totalChecks++;
  if (accessOk) {
    passedChecks++;
    console.log(`  ${PASS}  Accessibility permission is granted`);
  } else {
    allGood = false;
    totalIssues++;
    console.log(`  ${FAIL}  Accessibility permission is required`);
    console.log(`    ${ACCESSIBILITY_REQUIRED_MSG}`);
    console.log(`    ${ACCESSIBILITY_SETTINGS_PATH}`);
    console.log(`    ${ACCESSIBILITY_ENABLE_HINT}`);
    console.log();
  }

  const userConfig = listConfig();
  const commandChecks: Array<{ key: string; cmd: string }> = [];
  const editorCmd = userConfig.get("editor");
  const sidebarCmd = userConfig.get("sidebar");
  if (editorCmd) commandChecks.push({ key: "editor", cmd: editorCmd });
  if (sidebarCmd) commandChecks.push({ key: "sidebar", cmd: sidebarCmd });

  if (commandChecks.length > 0) {
    console.log();
    console.log("Checking configured commands...\n");

    for (const { key, cmd } of commandChecks) {
      const binary = commandExecutable(cmd);
      const found = binary ? resolveCommand(binary) : null;
      totalChecks++;
      if (found) {
        passedChecks++;
        console.log(`  ${PASS}  ${key} command "${binary}" found at ${found}`);
      } else {
        allGood = false;
        totalIssues++;
        console.log(`  ${FAIL}  ${key} command "${binary ?? cmd}" not found in PATH`);
        console.log(`    Install "${binary ?? cmd}" or change with: summon set ${key} <command>`);
        console.log();
      }
    }
  }

  console.log();
  console.log("Checking port conflicts...\n");
  const { detectAllPorts } = await import("../ports.js");
  const { conflicts } = await detectAllPorts();
  totalChecks++;
  if (conflicts.size === 0) {
    passedChecks++;
    console.log(`  ${PASS}  No port conflicts (${listProjects().size} projects checked)`);
  } else {
    allGood = false;
    for (const [port, projects] of conflicts) {
      totalIssues++;
      console.log(`  ${FAIL}  Port conflict: port ${port} used by ${projects.join(", ")}`);
    }
  }

  console.log();

  // Pass/fail summary (UX-M4, UX-M9)
  if (totalIssues === 0) {
    console.log(green(`${sym.ok} ${passedChecks}/${totalChecks} checks passed.`));
  } else {
    const failedChecks = totalChecks - passedChecks;
    const fixablePart = autoFixable > 0 ? ` (${autoFixable} auto-fixable with --fix)` : "";
    console.log(yellow(bold(`${passedChecks}/${totalChecks} checks passed — ${failedChecks} failed${fixablePart}.`)));
    console.log(`  Run 'summon doctor --fix' to apply fixes, or 'summon setup' to reconfigure.`);
  }

  // Verbose diagnostic section (#504 DO-S1)
  // Gives users full diagnostic context without needing SUMMON_DEBUG=1.
  if (verboseFlag) {
    console.log();
    console.log(bold("Diagnostic info:"));
    console.log();

    // Summon version
    console.log(`  Summon version:  ${__VERSION__}`);

    // Node.js version
    console.log(`  Node.js version: ${process.version}`);

    // Config directory
    console.log(`  Config dir:      ${CONFIG_DIR}`);

    // Ghostty paths and accessibility
    const ghosttyFound = GHOSTTY_PATHS.find((p) => existsSync(p));
    if (ghosttyFound) {
      console.log(`  Ghostty path:    ${ghosttyFound} ${dim("(found)")}`);
    } else {
      console.log(`  Ghostty path:    ${GHOSTTY_PATHS.join(", ")} ${dim("(not found)")}`);
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
    console.log(`  Trust DB:        ${TRUST_FILE}`);
    console.log(`  Trusted projects: ${trustedCount} project${trustedCount === 1 ? "" : "s"}`);
    console.log();
  }

  const issuesRemain = appliedFixes ? !accessOk : !allGood;
  if (issuesRemain) {
    console.error("Exit code 2: issues were found. See above for details.");
    process.exit(2);
  }
}
