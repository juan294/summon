import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { probeGhostty, type GhosttyConfigKey } from "../ghostty.js";
import { homedir } from "node:os";
import { listConfig, listProjects } from "../config.js";
import {
  probeAccessibility,
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
import { GHOSTTY_ONLY_CONFIG_KEYS, resolveBackendForLaunch } from "../backend.js";
import { createRexCli, defaultRexServer, discoverRex, whoamiOf } from "../backends/rex/cli.js";
import { listAppClients } from "../backends/rex/app.js";
import { escapeControlChars } from "../pane-inventory.js";
import type { CommandContext } from "./types.js";

const PASS = green(`${sym.ok} PASS`);
const FAIL = red(`${sym.fail} FAIL`);

/** UX-H1: Ghostty-only preferences a Rex launch ignores silently when they come from config; doctor names them once. */
function rexIgnoredConfigKeys(config: Map<string, string>): string[] {
  return GHOSTTY_ONLY_CONFIG_KEYS.filter((key) => {
    const value = config.get(key);
    return key === "font-size" ? value !== undefined && value !== "" : value === "true";
  });
}

export async function handleDoctorCommand({
  values,
}: CommandContext): Promise<void> {
  const {
    existsSync,
    readFileSync,
    copyFileSync,
    appendFileSync,
    accessSync,
    constants,
    lstatSync,
  } = await import("node:fs");

  const fixFlag = values.fix;
  const verboseFlag = values.verbose;

  // Track pass/fail counts for summary (UX-M4, UX-M5, UX-M9)
  let totalIssues = 0;
  let autoFixable = 0;
  let totalChecks = 0;
  let passedChecks = 0;

  // Read once: listConfig warns about unknown keys on every read. The first read stays where it was (Rex section or command checks).
  let configRead: Map<string, string> | undefined;
  const userConfig = (): Map<string, string> => (configRead ??= listConfig());

  let allGood = true;
  const record = (ok: boolean): void => {
    totalChecks++;
    if (ok) passedChecks++;
    else {
      allGood = false;
      totalIssues++;
    }
  };

  // Plan P15: with Rex installed and Ghostty absent, the Ghostty checks are not applicable
  // and are not counted as failures.
  const ghosttyConfigPath = join(homedir(), ".config", "ghostty", "config");
  let diagnostics = probeGhostty();
  const rexDiscovery = discoverRex();
  const detection = resolveBackendForLaunch({ discoverRex: () => rexDiscovery });
  const ghosttyApplicable = !!diagnostics.app || rexDiscovery.path === null;

  // FE-M5: diagnostic output goes to stderr so pipelines (e.g. summon export > .summon)
  // are not contaminated. Machine-consumable data (exit codes) stay on stdout.
  console.error("Checking Ghostty configuration...\n");
  if (!ghosttyApplicable) {
    console.error("  - not applicable (Rex detected, Ghostty not installed)");
    console.error();
  }
  if (ghosttyApplicable) {
  record(!!diagnostics.app && !!diagnostics.version);
  if (!diagnostics.app)
    console.error(
      `  ${FAIL}  Ghostty.app not found. Install Ghostty 1.3.1+ (1.4.0 recommended) from https://ghostty.org`,
    );
  else if (!diagnostics.version)
    console.error(
      "  UNAVAILABLE  Ghostty version probe failed; retry summon doctor.",
    );
  else {
    const version = diagnostics.version;
    console.error(
      `  ${version.recommended ? PASS : "WARN"}  Ghostty ${version.text} — 1.4.0 recommended security baseline`,
    );
    if (!version.recommended)
      console.error(
        version.stable
          ? "    Upgrade Ghostty for the recommended security fixes; existing launches remain supported."
          : "    Prerelease: unverified security baseline; use a stable release for security assurance.",
      );
  }
  for (const [name, result] of Object.entries(diagnostics.capabilities)) {
    console.error(`    ${name}: ${result.state} — ${result.reason}`);
    if (name !== "effectiveConfig") record(result.state !== "unavailable");
  }

  const checks: Array<{
    name: string;
    key: GhosttyConfigKey;
    recommended: string;
    deficient: string;
  }> = [
    {
      name: "Command Notifications",
      key: "notify-on-command-finish",
      recommended: "unfocused",
      deficient: "never",
    },
    {
      name: "Shell Integration",
      key: "shell-integration",
      recommended: "detect",
      deficient: "none",
    },
  ];
  // Read the existing target only. Explicit preferences and includes are never rewritten.
  if (!existsSync(ghosttyConfigPath))
    console.error(
      "  - No Ghostty config file found at ~/.config/ghostty/config; effective defaults still apply.",
    );
  let content: string | null = null;
  try {
    content = readFileSync(ghosttyConfigPath, "utf-8");
  } catch {
    /* missing/unreadable target */
  }
  const eligible = checks.filter(
    (check) =>
      diagnostics.capabilities.effectiveConfig.state === "supported" &&
      diagnostics.config[check.key] === check.deficient &&
      content !== null &&
      !new RegExp(`^\\s*${check.key}\\s*=`, "m").test(content),
  );
  let safeOrigin = false;
  if (eligible.length && content !== null) {
    try {
      const alternatives = [
        join(homedir(), ".config/ghostty/config.ghostty"),
        join(
          homedir(),
          "Library/Application Support/com.mitchellh.ghostty/config",
        ),
        join(
          homedir(),
          "Library/Application Support/com.mitchellh.ghostty/config.ghostty",
        ),
      ];
      const xdg = process.env["XDG_CONFIG_HOME"];
      accessSync(ghosttyConfigPath, constants.W_OK);
      safeOrigin =
        lstatSync(ghosttyConfigPath).isFile() &&
        !/^\s*config-file\s*=/m.test(content) &&
        !alternatives.some((path) => existsSync(path)) &&
        (!xdg || xdg === join(homedir(), ".config"));
      if (safeOrigin && fixFlag) {
        // An application launched with config flags may override the ordinary source.
        // Treat inaccessible process evidence as ambiguous, never as permission to write.
        const commands = execFileSync("/bin/ps", ["-axo", "command="], {
          encoding: "utf-8",
          timeout: 2000,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        });
        safeOrigin = !commands
          .split("\n")
          .some(
            (line) =>
              /Ghostty\.app\/Contents\/MacOS\/ghostty/.test(line) &&
              /(?:^|\s)--/.test(line),
          );
      }
    } catch {
      safeOrigin = false;
    }
  }
  if (fixFlag && eligible.length && safeOrigin) {
    try {
      const backup = `${ghosttyConfigPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
      copyFileSync(ghosttyConfigPath, backup);
      appendFileSync(
        ghosttyConfigPath,
        "\n# Added by summon doctor --fix\n" +
          eligible
            .map((check) => `${check.key} = ${check.recommended}`)
            .join("\n") +
          "\n",
      );
      console.error(`  Backed up ${ghosttyConfigPath} → ${backup}`);
      console.error(
        `  Added ${eligible.length} setting(s); reload Ghostty configuration.`,
      );
      const refreshed = probeGhostty(diagnostics.app);
      // Requery configuration without erasing an earlier failed version check.
      diagnostics = {
        ...diagnostics,
        config: refreshed.config,
        capabilities: refreshed.capabilities,
      };
    } catch {
      console.error(
        "  UNAVAILABLE  Could not back up/write configuration; edit and reload it manually, then retry summon doctor.",
      );
    }
  }

  for (const check of checks) {
    const value = diagnostics.config[check.key];
    const ok = value !== null && value !== check.deficient;
    record(ok);
    if (ok)
      console.error(
        `  ${PASS}  ${check.name} (${check.key}=${value}) is configured`,
      );
    else {
      if (safeOrigin && eligible.includes(check)) autoFixable++;
      console.error(
        `  ${value === null ? "UNAVAILABLE" : FAIL}  ${check.name} (${check.key}=${value ?? "unknown"})`,
      );
      console.error(
        `    Review effective configuration; edit ${check.key} = ${check.recommended} if desired and reload Ghostty. Retry summon doctor.`,
      );
      if (value !== null && (!safeOrigin || !eligible.includes(check)))
        console.error(
          "    Explicit preferences or ambiguous configuration sources are preserved; edit and reload manually.",
        );
    }
  }
  const securityKeys: GhosttyConfigKey[] = [
    "scrollback-compression",
    "link-osc8",
    "clipboard-read",
    "clipboard-write",
    "vt-window-resize-allowed",
    "vt-xt-checksum-report",
  ];
  for (const key of securityKeys)
    console.error(
      `    ${key}=${diagnostics.config[key] ?? "UNAVAILABLE"} (advisory; unchanged)`,
    );
  const effectiveAvailable =
    diagnostics.capabilities.effectiveConfig.state === "supported";
  record(effectiveAvailable);
  if (!effectiveAvailable)
    console.error(
      "  UNAVAILABLE  Effective configuration is incomplete; fix Ghostty configuration/probe access and retry summon doctor. No speculative fixes.",
    );
  console.error();
  console.error("Checking permissions...\n");

  const access = probeAccessibility();
  if (access === "unknown") {
    // PE-L3: System Events did not answer in time; that is neither a pass nor a failure.
    console.error("  INFO  Accessibility permission could not be checked (System Events did not answer); a launch will report it if it is missing");
  } else if (access === "granted") {
    totalChecks++;
    passedChecks++;
    console.error(`  ${PASS}  Accessibility permission is granted`);
  } else {
    totalChecks++;
    allGood = false;
    totalIssues++;
    console.error(`  ${FAIL}  Accessibility permission is required`);
    console.error(`    ${ACCESSIBILITY_REQUIRED_MSG}`);
    console.error(`    ${ACCESSIBILITY_SETTINGS_PATH}`);
    console.error(`    ${ACCESSIBILITY_ENABLE_HINT}`);
    console.error();
  }
  } // ghosttyApplicable

  console.error();
  console.error("Checking Rex...\n");
  if (rexDiscovery.path === null) {
    console.error(`  - Rex CLI not found (searched ${rexDiscovery.searched.join(", ")}); not applicable`);
  } else {
    const rexContext = detection.ok && detection.backend === "rex" ? detection : null;
    const server = rexContext?.server ?? defaultRexServer();
    const cli = createRexCli(rexDiscovery.path, server);
    console.error(`  ${PASS}  Rex CLI found at ${rexDiscovery.path}`);
    const version = cli.call("version", ["version"]);
    const versionLines = version.ok ? version.stdout.split("\n").map(escapeControlChars) : [];
    record(version.ok);
    console.error(version.ok
      ? `  ${PASS}  ${versionLines[0] ?? ""} (${versionLines.find((line) => line.startsWith("api:")) ?? "api revision unknown"})`
      : `  ${FAIL}  rex version failed: ${version.reason}`);
    const who = whoamiOf(cli);
    // The server is required only when Rex is the backend of this shell; otherwise it is informational.
    record(rexContext ? who.answers : true);
    if (who.answers) console.error(`  ${PASS}  Rex server reachable at ${server} (host ${who.hostId})`);
    else console.error(`  ${rexContext ? FAIL : "INFO"}  Rex server not reachable at ${server} (${who.reason}); open the Rex app to start it`);
    if (who.answers) {
      const clients = listAppClients(cli, { includeLost: true });
      if (!clients.ok) {
        console.error(`  INFO  app clients unavailable (${clients.reason})`);
      } else if (clients.clients.length === 0) {
        console.error("  INFO  no Rex app connected; open Rex to show workspaces");
      } else {
        for (const client of clients.clients) {
          console.error(`    app client ${client.clientId} ${client.label ? `(${client.label}) ` : ""}${client.connectionState}`);
        }
      }
    }
    console.error(detection.ok
      ? `  INFO  this shell launches in ${detection.backend} (placement ${detection.placement}${detection.backend === "rex" ? `, server ${detection.server}` : ""})`
      : `  INFO  this shell cannot launch: ${detection.reason}`);
    const ignored = rexIgnoredConfigKeys(userConfig());
    if (ignored.length > 0) console.error(`  INFO  Rex ignores these Ghostty settings from your config: ${ignored.join(", ")}`);
  }

  const commandChecks: Array<{ key: string; cmd: string }> = [];
  const editorCmd = userConfig().get("editor");
  const sidebarCmd = userConfig().get("sidebar");
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
        console.error(
          `  ${PASS}  ${key} command "${binary}" found at ${found}`,
        );
      } else {
        allGood = false;
        totalIssues++;
        console.error(
          `  ${FAIL}  ${key} command "${binary ?? cmd}" not found in PATH`,
        );
        console.error(
          `    Install "${binary ?? cmd}" or change with: summon set ${key} <command>`,
        );
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
    console.error(
      `  ${PASS}  No port conflicts (${listProjects().size} projects checked)`,
    );
  } else {
    allGood = false;
    for (const [port, projects] of conflicts) {
      totalIssues++;
      console.error(
        `  ${FAIL}  Port conflict: port ${port} used by ${projects.join(", ")}`,
      );
    }
  }

  console.error();

  // Pass/fail summary (UX-M4, UX-M9)
  if (totalIssues === 0) {
    console.error(
      green(`${sym.ok} ${passedChecks}/${totalChecks} checks passed.`),
    );
  } else {
    const failedChecks = totalChecks - passedChecks;
    const fixablePart =
      autoFixable > 0 ? ` (${autoFixable} auto-fixable with --fix)` : "";
    console.error(
      yellow(
        bold(
          `${passedChecks}/${totalChecks} checks passed — ${failedChecks} failed${fixablePart}.`,
        ),
      ),
    );
    console.error(
      `  Run 'summon doctor --fix' to apply fixes, or 'summon setup' to reconfigure.`,
    );
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
      console.error(
        `  Ghostty path:    ${GHOSTTY_PATHS.join(", ")} ${dim("(not found)")}`,
      );
    }

    // Trust DB
    let trustedCount = 0;
    if (existsSync(TRUST_FILE)) {
      try {
        const raw = readFileSync(TRUST_FILE, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          trustedCount = Object.keys(parsed as Record<string, string>).length;
        }
      } catch {
        // ignore parse errors — count stays 0
      }
    }
    console.error(`  Trust DB:        ${TRUST_FILE}`);
    console.error(
      `  Trusted projects: ${trustedCount} project${trustedCount === 1 ? "" : "s"}`,
    );
    console.error();
  }

  if (!allGood) {
    console.error("Exit code 2: issues were found. See above for details.");
    process.exit(2);
  }
}
