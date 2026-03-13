import { existsSync } from "node:fs";
import { setConfig } from "./config.js";
import { SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand as resolveCommandPath } from "./utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolEntry {
  cmd: string; // binary name (e.g., "nvim")
  name: string; // display name (e.g., "Neovim")
  desc: string; // short description (e.g., "Modern Vim")
}

export interface DetectedTool extends ToolEntry {
  available: boolean; // true if `command -v` succeeds
}

export interface SelectOption {
  label: string; // display text
  value: string; // returned on selection
  detail?: string; // secondary text (dimmed)
  marker?: string; // prefix marker (e.g., "* " or "  ")
}

// ---------------------------------------------------------------------------
// Color support — check once at module load
// ---------------------------------------------------------------------------

const useColor: boolean = !!(
  process.stdout.isTTY && !process.env.NO_COLOR
);

// ---------------------------------------------------------------------------
// ANSI output helpers
// ---------------------------------------------------------------------------

const wrap = (code: string, s: string): string =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export function bold(s: string): string {
  return wrap("1", s);
}

export function dim(s: string): string {
  return wrap("2", s);
}

export function green(s: string): string {
  return wrap("32", s);
}

export function yellow(s: string): string {
  return wrap("33", s);
}

export function cyan(s: string): string {
  return wrap("36", s);
}

// ---------------------------------------------------------------------------
// Banner & Section
// ---------------------------------------------------------------------------

export function printBanner(lines: string[]): void {
  if (lines.length === 0) return;
  const maxLen = Math.max(...lines.map((l) => l.length));
  const width = maxLen + 4; // 2 padding on each side
  const top = `╭${"─".repeat(width)}╮`;
  const bottom = `╰${"─".repeat(width)}╯`;

  console.log(top);
  for (const line of lines) {
    const padded = line.padEnd(maxLen);
    console.log(`│  ${padded}  │`);
  }
  console.log(bottom);
}

export function printSection(title: string): void {
  const PREFIX_DASHES = 2;
  const TOTAL_WIDTH = 40;
  const prefix = "─".repeat(PREFIX_DASHES);
  const suffixLen = Math.max(
    2,
    TOTAL_WIDTH - PREFIX_DASHES - title.length - 2,
  ); // 2 for spaces around title
  const suffix = "─".repeat(suffixLen);
  console.log(`${dim(prefix)} ${title} ${dim(suffix)}`);
}

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

// resolveCommandPath is imported from ./utils.js
export { resolveCommandPath };

/**
 * Check catalog of tools, return each with `available` flag.
 */
export function detectTools(
  catalog: readonly ToolEntry[],
): DetectedTool[] {
  return catalog.map((entry) => ({
    ...entry,
    available: resolveCommandPath(entry.cmd) !== null,
  }));
}

// ---------------------------------------------------------------------------
// Interactive input helpers
// ---------------------------------------------------------------------------

/**
 * Show numbered options and prompt for selection.
 * Re-prompts on invalid input. Returns 0-based index.
 * Empty input selects defaultIdx.
 */
export async function numberedSelect(
  options: SelectOption[],
  promptText: string,
  defaultIdx?: number,
): Promise<number> {
  const { createInterface } = await import("node:readline");

  // Display options
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    const marker = opt.marker ?? "  ";
    const detail = opt.detail ? `    ${dim(opt.detail)}` : "";
    console.log(`${marker}${i + 1}) ${opt.label}${detail}`);
  }

  const ask = (): Promise<number> =>
    new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(promptText, (answer: string) => {
        rl.close();
        const trimmed = answer.trim();

        if (trimmed === "" && defaultIdx !== undefined) {
          resolve(defaultIdx);
          return;
        }

        const num = parseInt(trimmed, 10);
        if (Number.isNaN(num) || num < 1 || num > options.length) {
          // Re-prompt
          resolve(ask());
          return;
        }

        resolve(num - 1);
      });
    });

  return ask();
}

/**
 * Prompt for text input with optional default.
 * Shows: "question [default]: "
 * Empty input returns defaultValue.
 * Trims whitespace.
 */
export async function textInput(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const display =
    defaultValue !== undefined
      ? `${question} [${defaultValue}]: `
      : `${question} `;

  return new Promise((resolve) => {
    rl.question(display, (answer: string) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === "" && defaultValue !== undefined) {
        resolve(defaultValue);
      } else {
        resolve(trimmed);
      }
    });
  });
}

/**
 * Yes/no confirmation. Default is "yes" (empty = yes).
 * Accepts: y, yes, n, no (case-insensitive).
 * Re-prompts on invalid input.
 * Returns boolean.
 */
export async function confirm(question: string): Promise<boolean> {
  const { createInterface } = await import("node:readline");

  const ask = (): Promise<boolean> =>
    new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(`${question} [Y/n] `, (answer: string) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();

        if (trimmed === "" || trimmed === "y" || trimmed === "yes") {
          resolve(true);
          return;
        }
        if (trimmed === "n" || trimmed === "no") {
          resolve(false);
          return;
        }

        // Re-prompt on invalid input
        resolve(ask());
      });
    });

  return ask();
}

// ---------------------------------------------------------------------------
// Phase 2 — Types (internal)
// ---------------------------------------------------------------------------

interface SetupResult {
  layout: string;
  editor: string;
  sidebar: string;
  server: string;
}

interface ValidationWarning {
  key: string;
  cmd: string;
  installHint?: string;
}

interface ValidationResult {
  warnings: ValidationWarning[];
  ghosttyFound: boolean;
}

// ---------------------------------------------------------------------------
// Phase 2 — Constants
// ---------------------------------------------------------------------------

// SAFE_COMMAND_RE is imported from ./utils.js
export { SAFE_COMMAND_RE };

export const EDITOR_CATALOG: readonly ToolEntry[] = [
  { cmd: "claude", name: "Claude Code", desc: "AI pair programmer" },
  { cmd: "cursor", name: "Cursor", desc: "AI-powered editor" },
  { cmd: "nvim", name: "Neovim", desc: "Modern Vim" },
  { cmd: "vim", name: "Vim", desc: "Classic modal editor" },
  { cmd: "code", name: "VS Code", desc: "Visual Studio Code" },
  { cmd: "emacs", name: "Emacs", desc: "Extensible editor" },
  { cmd: "hx", name: "Helix", desc: "Post-modern modal editor" },
  { cmd: "zed", name: "Zed", desc: "High-performance editor" },
  { cmd: "nano", name: "Nano", desc: "Simple text editor" },
];

export const SIDEBAR_CATALOG: readonly ToolEntry[] = [
  { cmd: "lazygit", name: "lazygit", desc: "Git TUI" },
  { cmd: "gitui", name: "GitUI", desc: "Fast Git TUI in Rust" },
  { cmd: "tig", name: "tig", desc: "Text-mode git interface" },
  { cmd: "btop", name: "btop", desc: "Resource monitor" },
  { cmd: "htop", name: "htop", desc: "Process viewer" },
];

export const LAYOUT_INFO: Record<string, { desc: string; diagram: string }> = {
  minimal: {
    desc: "Single editor + sidebar",
    diagram: [
      "  ┌────────┬──────┐",
      "  │ editor │ side │",
      "  └────────┴──────┘",
    ].join("\n"),
  },
  pair: {
    desc: "Two editors + sidebar + server",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ editor │ side │",
      "  ├────────┴────────┤      │",
      "  │ server          │      │",
      "  └─────────────────┴──────┘",
    ].join("\n"),
  },
  full: {
    desc: "Three editors + sidebar + server",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ editor │ side │",
      "  ├────────┼────────┤      │",
      "  │ editor │ server │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  cli: {
    desc: "Single editor + sidebar + server",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ server │ side │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  mtop: {
    desc: "Editor + system monitor + sidebar + server",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │  mtop  │ side │",
      "  ├────────┼────────┤      │",
      "  │ (shell)│ server │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
};

const INSTALL_HINTS: Record<string, string> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  lazygit: "brew install lazygit",
  gitui: "brew install gitui",
  tig: "brew install tig",
  btop: "brew install btop",
  htop: "brew install htop",
  nvim: "brew install neovim",
  hx: "brew install helix",
};

// GHOSTTY_PATHS is imported from ./utils.js

// ---------------------------------------------------------------------------
// Phase 2 — Wizard functions
// ---------------------------------------------------------------------------

function printWelcome(): void {
  console.log();
  printBanner([
    "Welcome to summon!",
    "Let's set up your workspace defaults.",
  ]);
  console.log();
  console.log(dim("  You can change these later with: summon set <key> <value>"));
  console.log();
}

export async function selectLayout(): Promise<string> {
  printSection("Layout");
  const presetNames = Object.keys(LAYOUT_INFO);
  const options: SelectOption[] = presetNames.map((name) => {
    const info = LAYOUT_INFO[name]!;
    return {
      label: name.padEnd(10) + info.desc,
      value: name,
    };
  });
  // Default to "pair" (index 1)
  const defaultIdx = presetNames.indexOf("pair");
  const idx = await numberedSelect(
    options,
    `  Select [1-${presetNames.length}] (default: ${defaultIdx + 1}): `,
    defaultIdx,
  );
  const chosen = presetNames[idx]!;
  // Show the diagram for the chosen layout
  console.log();
  console.log(LAYOUT_INFO[chosen]!.diagram);
  console.log();
  return chosen;
}

export async function selectToolFromCatalog(
  catalog: readonly ToolEntry[],
  sectionTitle: string,
  fallbackCmd: string,
): Promise<string> {
  printSection(sectionTitle);
  const detected = detectTools(catalog);
  // Sort: available first, then unavailable, maintain catalog order within groups
  const sorted = [
    ...detected.filter((t) => t.available),
    ...detected.filter((t) => !t.available),
  ];

  // Display options
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const marker = t.available ? "  * " : "    ";
    const detail = t.available ? dim(t.desc) : dim(`${t.desc} (not detected)`);
    console.log(`${marker}${i + 1}) ${t.cmd.padEnd(10)} ${t.name}    ${detail}`);
  }
  console.log(`    c) Custom command`);

  const firstDetected = sorted.findIndex((t) => t.available);
  const defaultIdx =
    firstDetected >= 0
      ? firstDetected
      : sorted.findIndex((t) => t.cmd === fallbackCmd);
  const defaultDisplay = defaultIdx >= 0 ? defaultIdx + 1 : 1;

  const { createInterface } = await import("node:readline");

  const askCustom = async (): Promise<string> => {
    const cmd = await textInput("  Enter command name:");
    if (!SAFE_COMMAND_RE.test(cmd)) {
      console.log(
        yellow(
          "  Invalid command name. Use only letters, digits, hyphens, dots, underscores, plus signs.",
        ),
      );
      return askCustom();
    }
    return cmd;
  };

  const askTool = (): Promise<string> =>
    new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(
        `  Select (default: ${defaultDisplay}): `,
        (answer: string) => {
          rl.close();
          const trimmed = answer.trim().toLowerCase();
          if (trimmed === "") {
            resolve(
              defaultIdx >= 0 ? sorted[defaultIdx]!.cmd : fallbackCmd,
            );
            return;
          }
          if (trimmed === "c") {
            resolve(askCustom());
            return;
          }
          const num = parseInt(trimmed, 10);
          if (Number.isNaN(num) || num < 1 || num > sorted.length) {
            resolve(askTool());
            return;
          }
          resolve(sorted[num - 1]!.cmd);
        },
      );
    });

  return askTool();
}

async function selectEditor(): Promise<string> {
  return selectToolFromCatalog(EDITOR_CATALOG, "Editor", "claude");
}

async function selectSidebar(): Promise<string> {
  return selectToolFromCatalog(SIDEBAR_CATALOG, "Sidebar", "lazygit");
}

export async function selectServer(): Promise<string> {
  printSection("Server Pane");
  const options: SelectOption[] = [
    {
      label: "Shell".padEnd(12) + "Plain terminal (run commands manually)",
      value: "true",
    },
    { label: "Disabled".padEnd(12) + "No server pane", value: "false" },
    {
      label: "Command".padEnd(12) + "Auto-run a command (e.g. npm run dev)",
      value: "__custom__",
    },
  ];
  const idx = await numberedSelect(options, "  Select [1-3] (default: 1): ", 0);
  const chosen = options[idx]!;
  if (chosen.value === "__custom__") {
    return textInput("  Enter server command:");
  }
  return chosen.value;
}

function printSummary(result: SetupResult): void {
  printSection("Summary");
  const layoutDesc = LAYOUT_INFO[result.layout]?.desc ?? result.layout;
  console.log(`  Layout:    ${bold(result.layout)} (${layoutDesc})`);
  console.log(`  Editor:    ${bold(result.editor)}`);
  console.log(`  Sidebar:   ${bold(result.sidebar)}`);
  if (result.server === "true") {
    console.log(`  Server:    ${bold("enabled")} (plain shell)`);
  } else if (result.server === "false") {
    console.log(`  Server:    ${bold("disabled")}`);
  } else {
    console.log(`  Server:    ${bold(result.server)}`);
  }
  console.log();
}

export function validateSetup(result: SetupResult): ValidationResult {
  const warnings: ValidationWarning[] = [];

  // Check editor
  if (resolveCommandPath(result.editor) === null) {
    warnings.push({
      key: "editor",
      cmd: result.editor,
      installHint: INSTALL_HINTS[result.editor],
    });
  }

  // Check sidebar
  if (resolveCommandPath(result.sidebar) === null) {
    warnings.push({
      key: "sidebar",
      cmd: result.sidebar,
      installHint: INSTALL_HINTS[result.sidebar],
    });
  }

  // Check server (only if it's a custom command, not "true"/"false")
  if (result.server !== "true" && result.server !== "false") {
    const serverBin = result.server.split(" ")[0]!;
    if (resolveCommandPath(serverBin) === null) {
      warnings.push({
        key: "server",
        cmd: serverBin,
        installHint: INSTALL_HINTS[serverBin],
      });
    }
  }

  // Check Ghostty
  const ghosttyFound = GHOSTTY_PATHS.some((p) => existsSync(p));

  return { warnings, ghosttyFound };
}

function printValidation(validation: ValidationResult): void {
  printSection("Checking tools");

  if (validation.ghosttyFound) {
    console.log(`  ${green("✓")} Ghostty    found`);
  } else {
    console.log(
      `  ${yellow("!")} Ghostty    not found — install from https://ghostty.org`,
    );
  }

  if (validation.warnings.length === 0) {
    console.log(`  ${green("✓")} All selected tools are available`);
  } else {
    for (const w of validation.warnings) {
      const hint = w.installHint ? ` — install with: ${w.installHint}` : "";
      console.log(`  ${yellow("!")} ${w.cmd.padEnd(10)} not found${hint}`);
    }
    console.log();
    console.log(dim("  Some tools are missing. Install them later or"));
    console.log(
      dim("  change your config with: summon set <key> <value>"),
    );
  }
  console.log();
}

export async function runSetup(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("Setup requires an interactive terminal.");
    console.error("Configure manually with: summon set <key> <value>");
    process.exit(1);
  }

  printWelcome();

  while (true) {
    const layout = await selectLayout();
    const editor = await selectEditor();
    const sidebar = await selectSidebar();

    let server = "false";
    if (layout === "minimal") {
      console.log(dim("  Minimal layout has no server pane."));
      console.log();
    } else {
      server = await selectServer();
    }

    const result: SetupResult = { layout, editor, sidebar, server };
    printSummary(result);

    const accepted = await confirm("  Save these settings?");
    if (accepted) {
      setConfig("layout", result.layout);
      setConfig("editor", result.editor);
      setConfig("sidebar", result.sidebar);
      setConfig("server", result.server);

      const validation = validateSetup(result);
      printValidation(validation);

      console.log(green("  Settings saved to ~/.config/summon/config"));
      console.log();
      console.log(
        "  You're all set! Run " +
          bold("summon .") +
          " to launch your first workspace.",
      );
      console.log();
      return;
    }
    // User declined — loop back to layout selection
    console.log();
  }
}
