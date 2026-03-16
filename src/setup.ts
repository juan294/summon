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
// ANSI cursor control helpers
// ---------------------------------------------------------------------------

/** @internal — exported for testing only */
export function ansiUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : "";
}

/** @internal — exported for testing only */
export function ansiClearDown(): string {
  return "\x1b[0J";
}

function ansiLineStart(): string {
  return "\r";
}

/** @internal — exported for testing only */
export function ansiSyncStart(): string {
  return "\x1b[?2026h";
}

/** @internal — exported for testing only */
export function ansiSyncEnd(): string {
  return "\x1b[?2026l";
}

// ---------------------------------------------------------------------------
// PreviewRenderer — in-place terminal preview
// ---------------------------------------------------------------------------

/**
 * Manages an in-place preview region on the terminal.
 * Tracks how many lines were rendered and how many lines were printed after
 * the preview, so it can move the cursor back and redraw.
 */
export class PreviewRenderer {
  private lastHeight = 0;
  private linesSince = 0;
  private active = false;

  /** Print a line and track it for cursor math. */
  log(msg: string = ""): void {
    console.log(msg);
    this.linesSince++;
  }

  /** Account for a promptUser() call (prompt + user answer = 1 line). */
  countPrompt(): void {
    this.linesSince++;
  }

  /**
   * Draw or redraw the preview in place.
   * First call: prints normally.
   * Subsequent calls: moves cursor up, clears, redraws.
   */
  draw(grid: string[][]): void {
    const preview = renderLayoutPreview(grid);
    const lines = preview.split("\n");

    if (this.active) {
      const totalUp = this.lastHeight + this.linesSince;
      process.stdout.write(ansiSyncStart());
      process.stdout.write(ansiLineStart() + ansiUp(totalUp) + ansiClearDown());
    }

    for (const line of lines) {
      console.log(`  ${line}`);
    }

    if (this.active) {
      process.stdout.write(ansiSyncEnd());
    }

    this.lastHeight = lines.length;
    this.linesSince = 0;
    this.active = true;
  }

  /** Reset state (for reuse or cleanup). */
  reset(): void {
    this.lastHeight = 0;
    this.linesSince = 0;
    this.active = false;
  }
}

// ---------------------------------------------------------------------------
// Grid builder — state management
// ---------------------------------------------------------------------------

/** State for the interactive grid builder. */
export interface GridBuilderState {
  columns: number[];
  focusCol: number;
  focusRow: number;
}

/** Create initial grid builder state (1 column, 1 pane). */
export function createGridState(): GridBuilderState {
  return { columns: [1], focusCol: 0, focusRow: 0 };
}

/**
 * Apply a keypress action to the grid state. Returns new state (immutable).
 * Returns null if the action is invalid.
 */
export function applyGridAction(
  state: GridBuilderState,
  action: "addCol" | "removeCol" | "addPane" | "removePane" | "nextFocus" | "prevFocus",
): GridBuilderState | null {
  const cols = [...state.columns];
  let { focusCol, focusRow } = state;

  switch (action) {
    case "addCol":
      cols.push(1);
      focusCol = cols.length - 1;
      focusRow = 0;
      break;
    case "removeCol":
      if (cols.length <= 1) return null;
      cols.pop();
      if (focusCol >= cols.length) {
        focusCol = cols.length - 1;
        focusRow = Math.min(focusRow, cols[focusCol]! - 1);
      }
      break;
    case "addPane":
      cols[focusCol] = cols[focusCol]! + 1;
      focusRow = cols[focusCol]! - 1;
      break;
    case "removePane":
      if (cols[focusCol]! <= 1) return null;
      cols[focusCol] = cols[focusCol]! - 1;
      if (focusRow >= cols[focusCol]!) {
        focusRow = cols[focusCol]! - 1;
      }
      break;
    case "nextFocus": {
      focusRow++;
      if (focusRow >= cols[focusCol]!) {
        focusCol = (focusCol + 1) % cols.length;
        focusRow = 0;
      }
      break;
    }
    case "prevFocus": {
      focusRow--;
      if (focusRow < 0) {
        focusCol = (focusCol - 1 + cols.length) % cols.length;
        focusRow = cols[focusCol]! - 1;
      }
      break;
    }
  }

  return { columns: cols, focusCol, focusRow };
}

// ---------------------------------------------------------------------------
// Grid builder — rendering
// ---------------------------------------------------------------------------

/**
 * Render layout preview for the grid builder with focus highlighting.
 * Focused cell shows cyan "*", other cells show dim "·".
 * @internal — exported for testing only
 */
export function renderGridBuilderPreview(
  columns: number[],
  focusCol: number,
  focusRow: number,
): string {
  const grid: string[][] = columns.map((paneCount, c) => {
    const col: string[] = [];
    for (let p = 0; p < paneCount; p++) {
      col.push(c === focusCol && p === focusRow ? cyan("*") : dim("\u00b7"));
    }
    return col;
  });
  return renderLayoutPreview(grid);
}

/**
 * Render key binding hints for the grid builder.
 * Dims unavailable actions based on current state.
 */
/** @internal — exported for testing only */
export function renderGridBuilderHints(state: GridBuilderState): string {
  const canRemoveCol = state.columns.length > 1;
  const canRemovePane = state.columns[state.focusCol]! > 1;

  const hints = [
    "[→] add column",
    canRemoveCol ? "[←] remove column" : dim("[←] remove column"),
    "[↓] add pane",
    canRemovePane ? "[↑] remove pane" : dim("[↑] remove pane"),
    "[Tab] move focus",
    "[Enter] done",
    "[Esc] cancel",
  ];
  return "  " + hints.join("  ");
}

// ---------------------------------------------------------------------------
// Grid builder — interactive flow
// ---------------------------------------------------------------------------

/**
 * Interactive arrow-key grid builder.
 * Enters raw mode, renders grid with focus, responds to keypresses.
 * Returns the column pane counts when user presses Enter.
 * Returns null if user presses Escape (cancel).
 */
export async function runGridBuilder(): Promise<number[] | null> {
  const { emitKeypressEvents } = await import("node:readline");

  let state = createGridState();
  const renderer = new PreviewRenderer();

  const render = (): void => {
    const grid: string[][] = state.columns.map((paneCount, c) => {
      const col: string[] = [];
      for (let p = 0; p < paneCount; p++) {
        col.push(c === state.focusCol && p === state.focusRow ? cyan("*") : dim("\u00b7"));
      }
      return col;
    });
    renderer.draw(grid);
    renderer.log(renderGridBuilderHints(state));
  };

  console.log(bold("  Build your grid:"));
  console.log();
  render();

  process.stdin.setRawMode(true);
  emitKeypressEvents(process.stdin);
  process.stdin.resume();

  return new Promise((resolve) => {
    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      process.removeListener("SIGINT", onSigInt);
    };

    const onSigInt = (): void => {
      cleanup();
      console.log();
      process.exit(0);
    };
    process.once("SIGINT", onSigInt);

    const onKey = (_str: string | undefined, key: { name: string; ctrl?: boolean; shift?: boolean }): void => {
      if (!key) return;

      if (key.ctrl && key.name === "c") {
        cleanup();
        console.log();
        process.exit(0);
      }

      if (key.name === "escape") {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return") {
        cleanup();
        resolve([...state.columns]);
        return;
      }

      // Shift+Tab → prevFocus (must be checked before regular tab mapping)
      if (key.name === "tab" && key.shift) {
        const next = applyGridAction(state, "prevFocus");
        if (next) {
          state = next;
          render();
        }
        return;
      }

      const actionMap: Record<string, Parameters<typeof applyGridAction>[1]> = {
        right: "addCol",
        left: "removeCol",
        down: "addPane",
        up: "removePane",
        tab: "nextFocus",
      };

      const action = actionMap[key.name];
      if (action) {
        const next = applyGridAction(state, action);
        if (next) {
          state = next;
          render();
        }
      }
    };

    process.stdin.on("keypress", onKey);
  });
}

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

// ---------------------------------------------------------------------------
// Grid templates for visual layout builder
// ---------------------------------------------------------------------------

export interface GridTemplate {
  label: string;       // display name, e.g., "2 + 1"
  columns: number[];   // pane count per column (sidebar always appended)
}

export const GRID_TEMPLATES: readonly GridTemplate[] = [
  { label: "1 + 1",     columns: [1, 1] },
  { label: "2 + 1",     columns: [2, 1] },
  { label: "1 + 1 + 1", columns: [1, 1, 1] },
  { label: "1 + 2",     columns: [1, 2] },
  { label: "1 + 2 + 1", columns: [1, 2, 1] },
  { label: "2 + 2",     columns: [2, 2] },
  { label: "2 + 1 + 1", columns: [2, 1, 1] },
];

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
 */
export function gridToTree(
  grid: string[][],
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

  return { tree: columnExprs.join(" | "), panes };
}

/** Measure visible width of a string, ignoring ANSI escape codes. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function visibleLength(s: string): number {
  let stripped = 0;
  ANSI_RE.lastIndex = 0;
  let match;
  while ((match = ANSI_RE.exec(s)) !== null) {
    stripped += match[0].length;
  }
  return s.length - stripped;
}

/** Center text within a fixed width, dimming "?" placeholders. */
function centerLabel(text: string, width: number): string {
  const maxLen = width - 2;
  const vis = visibleLength(text);
  // Truncate by visible length (plain text only — ANSI markers are always short)
  const label = vis > maxLen ? text.slice(0, maxLen) : text;
  const labelVis = vis > maxLen ? maxLen : vis;
  const leftPad = Math.floor((width - labelVis) / 2);
  const rightPad = width - labelVis - leftPad;
  const display = text === "?" ? dim(label) : label;
  return " ".repeat(leftPad) + display + " ".repeat(rightPad);
}

/**
 * Generate an ASCII box diagram preview of the layout.
 * Uses box-drawing characters matching the existing preset diagrams.
 */
export function renderLayoutPreview(
  grid: string[][],
): string {
  const COL_WIDTH = 14;       // chars per column (fits ~12-char command + 2 padding)
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
          rowStr += centerLabel(cmd, COL_WIDTH);
        } else {
          rowStr += " ".repeat(COL_WIDTH);
        }
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
      // Right edge
      const lastCol = grid[grid.length - 1]!;
      const lastHasSplit = row + 1 < lastCol.length;
      sep += lastHasSplit ? BOX.teeLeft : BOX.vertical;
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
      BOX.bottomRight,
  );

  return lines.join("\n");
}

/**
 * Render a compact box diagram showing grid shape (no command names).
 * Returns array of lines (not joined) for side-by-side composition.
 * @internal — exported for testing only
 */
export function renderMiniPreview(columns: number[]): string[] {
  const COL_W = 5;

  const maxRows = Math.max(...columns);
  const lines: string[] = [];

  // Top border
  const topParts = columns.map(() => BOX.horizontal.repeat(COL_W));
  lines.push(
    BOX.topLeft +
      topParts.join(BOX.teeDown) +
      BOX.topRight,
  );

  // Content rows
  for (let row = 0; row < maxRows; row++) {
    let rowStr = "";
    for (let c = 0; c < columns.length; c++) {
      rowStr += BOX.vertical;
      rowStr += " ".repeat(COL_W);
    }
    rowStr += BOX.vertical;
    lines.push(rowStr);

    // Row separator (between pane rows, not after last)
    if (row < maxRows - 1) {
      let sep = "";
      for (let c = 0; c < columns.length; c++) {
        const paneCount = columns[c]!;
        const hasSplit = row + 1 < paneCount;
        if (c === 0) {
          sep += hasSplit ? BOX.teeRight : BOX.vertical;
        } else {
          const prevCount = columns[c - 1]!;
          const prevSplit = row + 1 < prevCount;
          if (prevSplit && hasSplit) sep += BOX.cross;
          else if (prevSplit) sep += BOX.teeLeft;
          else if (hasSplit) sep += BOX.teeRight;
          else sep += BOX.vertical;
        }
        sep += hasSplit ? BOX.horizontal.repeat(COL_W) : " ".repeat(COL_W);
      }
      // Right edge
      const lastCount = columns[columns.length - 1]!;
      const lastSplit = row + 1 < lastCount;
      sep += lastSplit ? BOX.teeLeft : BOX.vertical;
      lines.push(sep);
    }
  }

  // Bottom border
  const bottomParts = columns.map(() => BOX.horizontal.repeat(COL_W));
  lines.push(
    BOX.bottomLeft +
      bottomParts.join(BOX.teeUp) +
      BOX.bottomRight,
  );

  return lines;
}

/**
 * Render template gallery showing grid shapes side by side.
 * Adapts items per row based on terminal width.
 * @internal — exported for testing only
 */
export function renderTemplateGallery(
  templates: readonly GridTemplate[],
  termWidth: number,
): string {
  if (templates.length === 0) return "";

  // Render each template's mini preview
  const previews = templates.map((t) => renderMiniPreview(t.columns));

  // Calculate item width: mini preview width + number prefix ("1) ") + gap
  const previewWidth = previews[0]!.length > 0 ? previews[0]![0]!.length : 10;
  const prefixWidth = 4; // "1)  " or "c)  "
  const gapWidth = 5;
  const itemWidth = prefixWidth + previewWidth + gapWidth;
  const perRow = Math.max(1, Math.min(3, Math.floor(termWidth / itemWidth)));

  const outputLines: string[] = [];

  // Process templates in row groups
  for (let rowStart = 0; rowStart < templates.length; rowStart += perRow) {
    const rowEnd = Math.min(rowStart + perRow, templates.length);
    const rowTemplates = templates.slice(rowStart, rowEnd);
    const rowPreviews = previews.slice(rowStart, rowEnd);

    // Find max height in this row
    const maxHeight = Math.max(...rowPreviews.map((p) => p.length));

    // Render numbered previews side by side
    for (let line = 0; line < maxHeight; line++) {
      let rowStr = "";
      for (let i = 0; i < rowTemplates.length; i++) {
        const idx = rowStart + i;
        const preview = rowPreviews[i]!;
        const prefix = line === 0 ? `${idx + 1})  ` : "    ";
        const content = line < preview.length ? preview[line]! : " ".repeat(previewWidth);
        rowStr += prefix + content;
        if (i < rowTemplates.length - 1) {
          rowStr += " ".repeat(gapWidth);
        }
      }
      outputLines.push(rowStr);
    }

    // Labels below previews
    let labelStr = "";
    for (let i = 0; i < rowTemplates.length; i++) {
      const t = rowTemplates[i]!;
      const label = t.label.padEnd(previewWidth);
      labelStr += "    " + label;
      if (i < rowTemplates.length - 1) {
        labelStr += " ".repeat(gapWidth);
      }
    }
    outputLines.push(labelStr);
    outputLines.push("");
  }

  // Add "Build from scratch" option (numbered sequentially after templates)
  outputLines.push(`${templates.length + 1})  Build from scratch`);

  return outputLines.join("\n");
}

/**
 * Display template gallery and prompt for selection.
 * Returns selected template's columns array, or null for "build from scratch".
 */
export async function selectGridTemplate(): Promise<number[]> {
  const termWidth = process.stdout.columns || 80;
  const gallery = renderTemplateGallery(GRID_TEMPLATES, termWidth);
  console.log(gallery);
  console.log();

  const customOption = GRID_TEMPLATES.length + 1;

  const ask = async (): Promise<number[]> => {
    const trimmed = (
      await promptUser(`  Select [1-${customOption}] (default: 1): `)
    ).trim();

    if (trimmed === "") {
      return [...GRID_TEMPLATES[0]!.columns];
    }
    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num) || num < 1 || num > customOption) {
      console.log(
        yellow(
          `  Invalid selection. Enter 1-${customOption}.`,
        ),
      );
      return ask();
    }
    if (num === customOption) {
      console.log();
      const result = await runGridBuilder();
      if (result === null) {
        // User pressed Escape — re-show template gallery
        console.log(dim("  Returning to template selection..."));
        return selectGridTemplate();
      }
      return result;
    }
    return [...GRID_TEMPLATES[num - 1]!.columns];
  };

  return ask();
}

/**
 * Build a grid with filled commands and "?" placeholders for unfilled cells.
 * @internal — exported for testing only
 */
export function buildPartialGrid(
  columns: number[],
  commands: string[][],
): string[][] {
  return columns.map((paneCount, c) => {
    const col: string[] = [];
    for (let p = 0; p < paneCount; p++) {
      const cmd = commands[c]?.[p];
      col.push(cmd && cmd.length > 0 ? cmd : "?");
    }
    return col;
  });
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

  // --- Grid shape selection ---
  console.log(bold("  Choose a grid shape:"));
  console.log();
  const paneCountsPerColumn = await selectGridTemplate();
  const columnCount = paneCountsPerColumn.length;

  // --- Command assignment with in-place preview ---
  // Detect available tools once (shell lookups are expensive)
  const detected = detectTools([...EDITOR_CATALOG, ...SIDEBAR_CATALOG]);
  const availableCmds = detected
    .filter((t) => t.available)
    .map((t) => t.cmd);
  const hintStr =
    availableCmds.length > 0
      ? dim(`  Detected: ${availableCmds.join(", ")}`)
      : "";

  const renderer = new PreviewRenderer();

  // Initial preview with all placeholders
  const initialGrid = buildPartialGrid(paneCountsPerColumn, []);
  renderer.draw(initialGrid);
  renderer.log();

  const grid: string[][] = [];
  for (let c = 0; c < columnCount; c++) {
    const paneCount = paneCountsPerColumn[c]!;
    const column: string[] = [];
    for (let p = 0; p < paneCount; p++) {
      if (hintStr) renderer.log(hintStr);
      let cmd = "";
      while (!cmd) {
        renderer.countPrompt();
        const input = await promptUser(
          `  Column ${c + 1}, Pane ${p + 1} \u2014 command [shell]: `,
        );
        cmd = input || "shell";
        const validated = await validateBuilderCommand(cmd, availableCmds);
        if (validated !== cmd) {
          // Validation printed extra lines — line counts are unreliable now
          renderer.reset();
        }
        cmd = validated;
      }
      column.push(cmd);

      // In-place preview update
      grid[c] = [...column];
      const partial = buildPartialGrid(paneCountsPerColumn, grid);
      renderer.draw(partial);
      renderer.log();
    }
    grid[c] = column;
  }

  // --- Final preview ---
  renderer.draw(grid);
  renderer.log();

  // --- Confirm ---
  const accepted = await confirm(`  Save as "${name}"?`);
  if (!accepted) {
    console.log("  Cancelled.");
    return;
  }

  // --- Build and save ---
  const { tree, panes } = gridToTree(grid);
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
