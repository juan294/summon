import { existsSync } from "node:fs";
import { setConfig, isValidLayoutName, isCustomLayout, saveCustomLayout } from "./config.js";
import { SAFE_COMMAND_RE, GHOSTTY_PATHS, resolveCommand as resolveCommandPath, promptUser } from "./utils.js";
import { isStarshipInstalled, listStarshipPresets } from "./starship.js";

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

const useTrueColor: boolean = useColor && (
  process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit"
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

export function magenta(s: string): string {
  return wrap("35", s);
}

export function brightCyan(s: string): string {
  return wrap("96", s);
}

/** @internal — exported for testing only */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function trueColorFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** @internal — exported for testing only */
export function colorSwatch(colors: string[]): string {
  if (!useTrueColor) return "";
  return colors.map((hex) => `${trueColorFg(hex)}██\x1b[0m`).join("");
}

// ---------------------------------------------------------------------------
// Box-drawing characters
// ---------------------------------------------------------------------------

/** Box-drawing characters for layout preview rendering. */
const BOX = {
  topLeft:     "\u250c",  // ┌
  topRight:    "\u2510",  // ┐
  bottomLeft:  "\u2514",  // └
  bottomRight: "\u2518",  // ┘
  horizontal:  "\u2500",  // ─
  vertical:    "\u2502",  // │
  teeDown:     "\u252c",  // ┬
  teeUp:       "\u2534",  // ┴
  teeRight:    "\u251c",  // ├
  teeLeft:     "\u2524",  // ┤
  cross:       "\u253c",  // ┼
} as const;

// ---------------------------------------------------------------------------
// Mascot & Logo
// ---------------------------------------------------------------------------

// Wizard mascot — hat with bent tip + face (retro pixel art)
export const WIZARD_MASCOT: readonly string[] = [
  "    ▄▀▀",
  "   ▄██",
  "  ████",
  " ██████",
  "▀▀▀▀▀▀▀▀",
  " ◠    ◠",
];

// Pre-rendered "SUMMON" in box-drawing Unicode font (3 lines)
export const SUMMON_LOGO: readonly string[] = [
  "╔═╗╦ ╦╔╦╗╔╦╗╔═╗╔╗╔",
  "╚═╗║ ║║║║║║║║ ║║║║",
  "╚═╝╚═╝╩ ╩╩ ╩╚═╝╝╚╝",
];

// ---------------------------------------------------------------------------
// Tips
// ---------------------------------------------------------------------------

export const TIPS: readonly string[] = [
  "Use summon add <name> <path> to register projects for quick launching",
  "Create a .summon file in any project root for per-project config",
  "Try --layout minimal for a focused single-editor workspace",
  "Use summon set editor <cmd> to change your default editor",
  "Run summon --dry-run to preview the AppleScript without launching",
  "Project config (.summon) overrides machine config; CLI flags override both",
  "Use summon completions zsh to enable tab completion",
  "Try --layout btop for an editor + system monitor workspace",
  "Use summon config to see all your current settings",
  "The --editor-size flag controls what % of width goes to editors",
];

export function getRandomTip(): string {
  return TIPS[Math.floor(Math.random() * TIPS.length)]!;
}

// ---------------------------------------------------------------------------
// Banner & Section
// ---------------------------------------------------------------------------


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
  // Display options
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    const marker = opt.marker ?? "  ";
    const detail = opt.detail ? `    ${dim(opt.detail)}` : "";
    console.log(`${marker}${i + 1}) ${opt.label}${detail}`);
  }

  const ask = async (): Promise<number> => {
    const trimmed = await promptUser(promptText);

    if (trimmed === "" && defaultIdx !== undefined) {
      return defaultIdx;
    }

    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num) || num < 1 || num > options.length) {
      console.log(
        yellow(
          `  Invalid selection. Please enter a number between 1 and ${options.length}.`,
        ),
      );
      return ask();
    }

    return num - 1;
  };

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
  const display =
    defaultValue !== undefined
      ? `${question} [${defaultValue}]: `
      : `${question} `;

  const trimmed = await promptUser(display);
  if (trimmed === "" && defaultValue !== undefined) {
    return defaultValue;
  }
  return trimmed;
}

/**
 * Yes/no confirmation. Default is "yes" (empty = yes).
 * Accepts: y, yes, n, no (case-insensitive).
 * Re-prompts on invalid input.
 * Returns boolean.
 */
export async function confirm(question: string): Promise<boolean> {
  const ask = async (): Promise<boolean> => {
    const trimmed = (await promptUser(`${question} [Y/n] `)).toLowerCase();

    if (trimmed === "" || trimmed === "y" || trimmed === "yes") {
      return true;
    }
    if (trimmed === "n" || trimmed === "no") {
      return false;
    }

    // Re-prompt on invalid input
    console.log(yellow("  Please enter y or n."));
    return ask();
  };

  return ask();
}

// ---------------------------------------------------------------------------
// Phase 2 — Types (internal)
// ---------------------------------------------------------------------------

interface SetupResult {
  layout: string;
  editor: string;
  sidebar: string;
  shell: string;
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
  { cmd: "nvim", name: "Neovim", desc: "Modern Vim" },
  { cmd: "vim", name: "Vim", desc: "Classic modal editor" },
  { cmd: "emacs", name: "Emacs", desc: "Extensible editor" },
  { cmd: "hx", name: "Helix", desc: "Post-modern modal editor" },
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
    desc: "Two editors + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │        │ editor │      │",
      "  │ editor ├────────┤ side │",
      "  │        │ shell  │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  full: {
    desc: "Three editors + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ editor │ side │",
      "  ├────────┼────────┤      │",
      "  │ editor │ shell  │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  cli: {
    desc: "Single editor + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ shell  │ side │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  btop: {
    desc: "Editor + system monitor + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │        │  btop  │      │",
      "  │ editor ├────────┤ side │",
      "  │        │ shell  │      │",
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
  starship: "brew install starship  OR  curl -sS https://starship.rs/install.sh | sh",
};

// GHOSTTY_PATHS is imported from ./utils.js

// ---------------------------------------------------------------------------
// Phase 2 — Wizard functions
// ---------------------------------------------------------------------------

function printWelcome(): void {
  console.log();

  // Color functions for the logo gradient: cyan → brightCyan → green
  const logoColors = [cyan, brightCyan, green];

  // Compose mascot (left) + logo (right) side by side
  const mascotWidth = 10; // pad mascot lines to this width for alignment
  const gap = "   ";

  // Mascot is 6 lines, logo is 3 lines — tagline starts after a 1-line gap
  const taglineIdx = SUMMON_LOGO.length + 1; // line after blank spacer
  const subtitleIdx = taglineIdx + 1;

  for (let i = 0; i < WIZARD_MASCOT.length; i++) {
    const mascotLine = magenta(WIZARD_MASCOT[i]!.padEnd(mascotWidth));
    if (i < SUMMON_LOGO.length) {
      const colorFn = logoColors[i] ?? cyan;
      console.log(`  ${mascotLine}${gap}${colorFn(SUMMON_LOGO[i]!)}`);
    } else if (i === taglineIdx) {
      console.log(`  ${mascotLine}${gap}Summon your Ghostty workspace.`);
    } else if (i === subtitleIdx) {
      console.log(`  ${mascotLine}${gap}Let's set up your defaults.`);
    } else {
      console.log(`  ${mascotLine}`);
    }
  }

  console.log();
  console.log(`  ${bold(cyan("Tip:"))} ${dim(getRandomTip())}`);
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
  // Add "custom" option at the end
  options.push({
    label: "custom".padEnd(10) + "Create your own layout",
    value: "custom",
  });
  // Default to "pair" (index 1)
  const defaultIdx = presetNames.indexOf("pair");
  const totalCount = options.length;
  const idx = await numberedSelect(
    options,
    `  Select [1-${totalCount}] (default: ${defaultIdx + 1}): `,
    defaultIdx,
  );

  // Custom layout: flow into the layout builder
  if (idx === presetNames.length) {
    console.log();
    let name = "";
    while (!name) {
      name = await promptUser("  Name your layout: ");
      if (!name) {
        console.log(yellow("  No name provided. Please enter a layout name."));
        continue;
      }
      if (!isValidLayoutName(name)) {
        console.log(yellow("  Invalid name. Use letters, digits, hyphens, underscores (start with a letter)."));
        name = "";
      }
    }
    await runLayoutBuilder(name);
    return name;
  }

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
): Promise<string> {
  printSection(sectionTitle);
  const detected = detectTools(catalog);
  const available = detected.filter((t) => t.available);

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

  if (available.length === 0) {
    console.log(dim("  No known tools detected."));
    return askCustom();
  }

  // Display only available tools
  for (let i = 0; i < available.length; i++) {
    const t = available[i]!;
    console.log(`  * ${i + 1}) ${t.cmd.padEnd(10)} ${t.name}    ${dim(t.desc)}`);
  }
  console.log(`    c) Custom command`);

  const askTool = async (): Promise<string> => {
    const trimmed = (await promptUser(`  Select (default: 1): `)).toLowerCase();
    if (trimmed === "") {
      return available[0]!.cmd;
    }
    if (trimmed === "c") {
      return askCustom();
    }
    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num) || num < 1 || num > available.length) {
      console.log(
        yellow(
          `  Invalid selection. Please enter a number between 1 and ${available.length}, or "c" for custom.`,
        ),
      );
      return askTool();
    }
    return available[num - 1]!.cmd;
  };

  return askTool();
}

async function selectEditor(): Promise<string> {
  return selectToolFromCatalog(EDITOR_CATALOG, "Editor");
}

async function selectSidebar(): Promise<string> {
  return selectToolFromCatalog(SIDEBAR_CATALOG, "Sidebar");
}

export async function selectShell(): Promise<string> {
  printSection("Shell Pane");
  const options: SelectOption[] = [
    {
      label: "Shell".padEnd(12) + "Plain terminal (run commands manually)",
      value: "true",
    },
    { label: "Disabled".padEnd(12) + "No shell pane", value: "false" },
    {
      label: "Command".padEnd(12) + "Auto-run a command (e.g. npm run dev)",
      value: "__custom__",
    },
  ];
  const idx = await numberedSelect(options, "  Select [1-3] (default: 1): ", 0);
  const chosen = options[idx]!;
  if (chosen.value === "__custom__") {
    return textInput("  Enter shell command:");
  }
  return chosen.value;
}

const STARSHIP_PRESET_DESCRIPTIONS: Record<string, string> = {
  "bracketed-segments": "Modules wrapped in brackets",
  "catppuccin-powerline": "Catppuccin palette powerline",
  "gruvbox-rainbow": "Gruvbox-inspired powerline",
  "jetpack": "Minimalist, geometry-inspired",
  "nerd-font-symbols": "Nerd Font glyphs (requires Nerd Font)",
  "no-empty-icons": "Hides icons for absent tools",
  "no-nerd-font": "Plain symbols, no special fonts",
  "no-runtime-versions": "Hides runtime version numbers",
  "pastel-powerline": "Pastel-colored powerline segments",
  "plain-text-symbols": "ASCII-only, no Unicode",
  "pure-preset": "Emulates the Pure prompt",
  "tokyo-night": "Tokyo Night color scheme",
};

const STARSHIP_PRESET_PALETTES: Record<string, string[]> = {
  "pastel-powerline": ["#9A348E", "#DA627D", "#FCA17D", "#86BBD8", "#33658A"],
  "tokyo-night": ["#a3aed2", "#769ff0", "#394260", "#212736", "#1d2230"],
  "gruvbox-rainbow": ["#d65d0e", "#d79921", "#689d6a", "#458588", "#665c54"],
  "catppuccin-powerline": ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#74c7ec", "#b4befe"],
};

export async function selectStarshipPreset(): Promise<string | null> {
  if (!isStarshipInstalled()) return null;
  const presets = listStarshipPresets();
  if (presets.length === 0) return null;

  printSection("Starship Prompt Theme");
  const PAD = 22; // longest preset name (catppuccin-powerline) is 20 chars + 2 gap
  const options: SelectOption[] = [
    { label: "Skip (keep current Starship config)", value: "__skip__" },
    { label: "Random (surprise me!)", value: "__random__" },
    ...presets.map((name) => {
      const palette = STARSHIP_PRESET_PALETTES[name];
      const swatch = palette ? colorSwatch(palette) : "";
      const gap = swatch ? "  " : "";
      return {
        label: `${name.padEnd(PAD)}${swatch}${gap}`,
        value: name,
        detail: STARSHIP_PRESET_DESCRIPTIONS[name],
      };
    }),
  ];
  const idx = await numberedSelect(
    options,
    `  Select [1-${options.length}] (default: 1): `,
    0,
  );
  const chosen = options[idx]!;
  if (chosen.value === "__skip__") return null;
  if (chosen.value === "__random__") {
    return presets[Math.floor(Math.random() * presets.length)]!;
  }
  return chosen.value;
}

function printSummary(result: SetupResult, starshipPreset?: string | null): void {
  printSection("Summary");
  const layoutDesc = LAYOUT_INFO[result.layout]?.desc ?? result.layout;
  console.log(`  Layout:    ${bold(result.layout)} (${layoutDesc})`);
  console.log(`  Editor:    ${bold(result.editor)}`);
  console.log(`  Sidebar:   ${bold(result.sidebar)}`);
  if (result.shell === "true") {
    console.log(`  Shell:     ${bold("enabled")} (plain shell)`);
  } else if (result.shell === "false") {
    console.log(`  Shell:     ${bold("disabled")}`);
  } else {
    console.log(`  Shell:     ${bold(result.shell)}`);
  }
  if (starshipPreset) {
    console.log(`  Starship:  ${bold(starshipPreset)}`);
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

  // Check shell (only if it's a custom command, not "true"/"false")
  if (result.shell !== "true" && result.shell !== "false") {
    const shellBin = result.shell.split(" ")[0]!;
    if (resolveCommandPath(shellBin) === null) {
      warnings.push({
        key: "shell",
        cmd: shellBin,
        installHint: INSTALL_HINTS[shellBin],
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
    const isCustom = isCustomLayout(layout);

    // Custom layouts define their own pane commands — skip editor/sidebar/shell
    let editor = "claude";
    let sidebar = "lazygit";
    let shell = "false";

    if (!isCustom) {
      editor = await selectEditor();
      sidebar = await selectSidebar();

      if (layout === "minimal") {
        console.log(dim("  Minimal layout has no shell pane."));
        console.log();
      } else {
        shell = await selectShell();
      }
    } else {
      console.log(dim("  Custom layout — pane commands are defined in the layout."));
      console.log(dim("  Skipping editor, sidebar, and shell selection."));
      console.log();
    }

    const starshipPreset = await selectStarshipPreset();

    const result: SetupResult = { layout, editor, sidebar, shell };

    if (isCustom) {
      printSection("Summary");
      console.log(`  Layout:    ${bold(layout)} (custom)`);
      if (starshipPreset) {
        console.log(`  Starship:  ${bold(starshipPreset)}`);
      }
      console.log();
    } else {
      printSummary(result, starshipPreset);
    }

    const accepted = await confirm("  Save these settings?");
    if (accepted) {
      setConfig("layout", result.layout);
      if (!isCustom) {
        setConfig("editor", result.editor);
        setConfig("sidebar", result.sidebar);
        setConfig("shell", result.shell);
      }
      if (starshipPreset) {
        setConfig("starship-preset", starshipPreset);
      }

      if (!isCustom) {
        const validation = validateSetup(result);
        printValidation(validation);
      }

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

// ---------------------------------------------------------------------------
// Layout Builder — pure helpers
// ---------------------------------------------------------------------------

/**
 * Find the closest match to `input` from a list of known commands.
 * Uses simple edit distance (Levenshtein). Returns null if no close match.
 */
/** @internal — exported for testing */
export function findClosestCommand(input: string, known: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cmd of known) {
    const d = editDistance(input.toLowerCase(), cmd.toLowerCase());
    if (d < bestDist && d <= 3) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}

/** Simple Levenshtein distance for short command names. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/**
 * Validate a command entered in the layout builder.
 * If the command isn't found, warns the user and suggests the closest match.
 * Returns the command to use (original, corrected, or empty string to re-prompt).
 */
async function validateBuilderCommand(cmd: string, knownCmds: string[]): Promise<string> {
  if (cmd === "shell") return cmd; // special value — plain shell
  const cmdName = cmd.split(/\s+/)[0] ?? cmd;
  if (resolveCommandPath(cmdName)) return cmd; // found in PATH

  const suggestion = findClosestCommand(cmdName, knownCmds);
  if (suggestion) {
    console.log(yellow(`  '${cmdName}' not found. Did you mean '${suggestion}'?`));
    const useSuggestion = await confirm(`  Use '${suggestion}' instead?`);
    if (useSuggestion) {
      return cmd.replace(cmdName, suggestion);
    }
  } else {
    console.log(yellow(`  '${cmdName}' not found on this system.`));
  }
  const keepAnyway = await confirm("  Keep it anyway?");
  if (keepAnyway) return cmd;
  return ""; // empty = re-prompt
}

/**
 * Extract a pane name from a command string: first word, deduped.
 * Used names are tracked to append _2, _3, etc.
 */
function derivePaneName(command: string, usedNames: Set<string>): string {
  const base = command.split(/\s+/)[0] ?? "pane";
  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${base}_${suffix}`;
    suffix++;
  }
  usedNames.add(name);
  return name;
}

/**
 * Convert a column/pane grid into a tree DSL string and pane definitions Map.
 *
 * - `grid` is an array of columns, each column is an array of command strings
 * - Each column's panes are joined with `/` (down splits)
 * - Columns are joined with `|` (right splits)
 * - Sidebar pane appended with `|` on the right
 */
export function gridToTree(
  grid: string[][],
  sidebar: string,
): { tree: string; panes: Map<string, string> } {
  const panes = new Map<string, string>();
  const usedNames = new Set<string>();
  const columnExprs: string[] = [];

  for (const column of grid) {
    const paneNames: string[] = [];
    for (const command of column) {
      const name = derivePaneName(command, usedNames);
      panes.set(name, command);
      paneNames.push(name);
    }
    if (paneNames.length === 1) {
      columnExprs.push(paneNames[0]!);
    } else {
      columnExprs.push(`(${paneNames.join(" / ")})`);
    }
  }

  // Add sidebar
  const sidebarName = derivePaneName(sidebar, usedNames);
  panes.set(sidebarName, sidebar);
  columnExprs.push(sidebarName);

  return { tree: columnExprs.join(" | "), panes };
}

/**
 * Generate an ASCII box diagram preview of the layout.
 * Uses box-drawing characters matching the existing preset diagrams.
 */
export function renderLayoutPreview(
  grid: string[][],
  sidebar: string,
): string {
  const COL_WIDTH = 14;       // chars per column (fits ~12-char command + 2 padding)
  const SIDEBAR_WIDTH = 11;   // chars for sidebar column (fits ~9-char command + 2 padding)
  const PANE_HEIGHT = 3;      // lines per pane cell (1 content line + 2 border/spacing)

  // Find max row count across all columns
  const maxRows = Math.max(...grid.map((col) => col.length));

  const lines: string[] = [];

  // --- Top border ---
  const topParts: string[] = [];
  for (let c = 0; c < grid.length; c++) {
    topParts.push(BOX.horizontal.repeat(COL_WIDTH));
  }
  lines.push(
    BOX.topLeft +
      topParts.join(BOX.teeDown) +
      BOX.teeDown +
      BOX.horizontal.repeat(SIDEBAR_WIDTH) +
      BOX.topRight,
  );

  // --- Content rows ---
  for (let row = 0; row < maxRows; row++) {
    // Draw the pane content lines
    for (let lineInPane = 0; lineInPane < PANE_HEIGHT; lineInPane++) {
      let rowStr = "";
      for (let c = 0; c < grid.length; c++) {
        const col = grid[c]!;
        const cmd = col[row] ?? "";
        rowStr += BOX.vertical;
        if (lineInPane === Math.floor(PANE_HEIGHT / 2) && cmd) {
          // Center the command name
          const padded = cmd.slice(0, COL_WIDTH - 2);
          const leftPad = Math.floor((COL_WIDTH - padded.length) / 2);
          const rightPad = COL_WIDTH - padded.length - leftPad;
          rowStr += " ".repeat(leftPad) + padded + " ".repeat(rightPad);
        } else {
          rowStr += " ".repeat(COL_WIDTH);
        }
      }

      // Sidebar spans full height — show label in the middle
      const sidebarMiddleRow = Math.floor((maxRows * PANE_HEIGHT) / 2);
      const currentAbsLine = row * PANE_HEIGHT + lineInPane;
      rowStr += BOX.vertical;
      if (currentAbsLine === sidebarMiddleRow) {
        const padded = sidebar.slice(0, SIDEBAR_WIDTH - 2);
        const leftPad = Math.floor((SIDEBAR_WIDTH - padded.length) / 2);
        const rightPad = SIDEBAR_WIDTH - padded.length - leftPad;
        rowStr += " ".repeat(leftPad) + padded + " ".repeat(rightPad);
      } else {
        rowStr += " ".repeat(SIDEBAR_WIDTH);
      }
      rowStr += BOX.vertical;
      lines.push(rowStr);
    }

    // --- Row separator (between pane rows, not after last) ---
    if (row < maxRows - 1) {
      const sepParts: string[] = [];
      for (let c = 0; c < grid.length; c++) {
        const col = grid[c]!;
        // Only draw horizontal line if this column has a pane in the next row
        if (row + 1 < col.length) {
          sepParts.push(BOX.horizontal.repeat(COL_WIDTH));
        } else {
          sepParts.push(" ".repeat(COL_WIDTH));
        }
      }
      // Build separator with correct junction characters
      let sep = "";
      for (let c = 0; c < grid.length; c++) {
        const col = grid[c]!;
        const hasSplitHere = row + 1 < col.length;
        if (c === 0) {
          sep += hasSplitHere ? BOX.teeRight : BOX.vertical;
        } else {
          // Junction between columns
          const prevCol = grid[c - 1]!;
          const prevHasSplit = row + 1 < prevCol.length;
          if (prevHasSplit && hasSplitHere) sep += BOX.cross;
          else if (prevHasSplit) sep += BOX.teeLeft;
          else if (hasSplitHere) sep += BOX.teeRight;
          else sep += BOX.vertical;
        }
        sep += sepParts[c]!;
      }
      // Junction before sidebar (sidebar spans full height, no split)
      const lastCol = grid[grid.length - 1]!;
      const lastHasSplit = row + 1 < lastCol.length;
      sep += lastHasSplit ? BOX.teeLeft : BOX.vertical;
      sep += " ".repeat(SIDEBAR_WIDTH);
      sep += BOX.vertical;
      lines.push(sep);
    }
  }

  // --- Bottom border ---
  const bottomParts: string[] = [];
  for (let c = 0; c < grid.length; c++) {
    bottomParts.push(BOX.horizontal.repeat(COL_WIDTH));
  }
  lines.push(
    BOX.bottomLeft +
      bottomParts.join(BOX.teeUp) +
      BOX.teeUp +
      BOX.horizontal.repeat(SIDEBAR_WIDTH) +
      BOX.bottomRight,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Layout Builder — interactive flow
// ---------------------------------------------------------------------------

export async function runLayoutBuilder(name: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("Layout builder requires an interactive terminal.");
    process.exit(1);
  }

  // --- Header ---
  console.log();
  printSection("Layout Builder");
  console.log();

  // --- Validate name ---
  if (!isValidLayoutName(name)) {
    console.error(`Error: Invalid layout name "${name}".`);
    console.error(
      "Names must start with a letter and contain only letters, digits, hyphens, and underscores.",
    );
    process.exit(1);
  }

  // --- Check existing ---
  if (isCustomLayout(name)) {
    const overwrite = await confirm(
      `  Layout "${name}" already exists. Overwrite?`,
    );
    if (!overwrite) {
      console.log("  Cancelled.");
      return;
    }
  }

  // --- Column count ---
  const columnOptions: SelectOption[] = [
    { label: "1 column", value: "1" },
    { label: "2 columns", value: "2" },
    { label: "3 columns", value: "3" },
  ];
  console.log(bold("  How many columns?") + dim(" (not counting sidebar)"));
  const colIdx = await numberedSelect(
    columnOptions,
    "  Select [1-3] (default: 1): ",
    0,
  );
  const columnCount = colIdx + 1;
  console.log();

  // --- Pane count per column ---
  // Detect available tools once (shell lookups are expensive)
  const detected = detectTools([...EDITOR_CATALOG, ...SIDEBAR_CATALOG]);
  const availableCmds = detected
    .filter((t) => t.available)
    .map((t) => t.cmd);
  const hintStr =
    availableCmds.length > 0
      ? dim(`  Detected: ${availableCmds.join(", ")}`)
      : "";

  const grid: string[][] = [];
  for (let c = 0; c < columnCount; c++) {
    const paneOptions: SelectOption[] = [
      { label: "1 pane", value: "1" },
      { label: "2 panes", value: "2" },
      { label: "3 panes", value: "3" },
    ];
    console.log(bold(`  Column ${c + 1}`) + dim(" \u2014 how many panes stacked?"));
    const paneIdx = await numberedSelect(
      paneOptions,
      "  Select [1-3] (default: 1): ",
      0,
    );
    const paneCount = paneIdx + 1;
    console.log();

    // --- Command per pane ---
    const column: string[] = [];
    for (let p = 0; p < paneCount; p++) {
      if (hintStr) console.log(hintStr);
      let cmd = "";
      while (!cmd) {
        const input = await promptUser(
          `  Column ${c + 1}, Pane ${p + 1} \u2014 command: `,
        );
        cmd = input || "shell";
        cmd = await validateBuilderCommand(cmd, availableCmds);
      }
      column.push(cmd);
    }
    grid.push(column);
    console.log();
  }

  // --- Sidebar ---
  const sidebarAvailable = detected
    .filter((t) => t.available && SIDEBAR_CATALOG.some((s) => s.cmd === t.cmd))
    .map((t) => t.cmd);
  if (sidebarAvailable.length > 0) {
    console.log(dim(`  Detected: ${sidebarAvailable.join(", ")}`));
  }
  let sidebar = "";
  while (!sidebar) {
    const sidebarInput = await promptUser("  Sidebar \u2014 command: ");
    sidebar = sidebarInput || "lazygit";
    sidebar = await validateBuilderCommand(sidebar, availableCmds);
  }
  console.log();

  // --- Preview ---
  console.log(bold("  Preview:"));
  console.log();
  const preview = renderLayoutPreview(grid, sidebar);
  for (const line of preview.split("\n")) {
    console.log(`  ${line}`);
  }
  console.log();

  // --- Confirm ---
  const accepted = await confirm(`  Save as "${name}"?`);
  if (!accepted) {
    console.log("  Cancelled.");
    return;
  }

  // --- Build and save ---
  const { tree, panes } = gridToTree(grid, sidebar);
  const entries = new Map<string, string>();
  for (const [paneName, command] of panes) {
    entries.set(`pane.${paneName}`, command);
  }
  entries.set("tree", tree);
  saveCustomLayout(name, entries);

  console.log();
  console.log(
    green("  Saved!") +
      " Use with: " +
      bold(`summon . --layout ${name}`),
  );
  console.log();
}
