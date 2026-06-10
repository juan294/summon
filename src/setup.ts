import { setConfig, isValidLayoutName, isCustomLayout, saveCustomLayout } from "./config.js";
import { LAYOUT_INFO, GRID_TEMPLATES } from "./setup-gallery.js";
export type { GridTemplate } from "./setup-gallery.js";
export { LAYOUT_INFO, GRID_TEMPLATES };
import { SAFE_COMMAND_RE, resolveCommand as resolveCommandPath, promptUser, checkAccessibility, openAccessibilitySettings, isGhosttyInstalled, ACCESSIBILITY_SETTINGS_PATH, ACCESSIBILITY_ENABLE_HINT, debugLog } from "./utils.js";
import { isStarshipInstalled, listStarshipPresets } from "./starship.js";
import { bold, dim, green, yellow, cyan, magenta, brightCyan, colorSwatch } from "./ui/ansi.js";
import { renderLayoutPreview, renderTemplateGallery, getDisplayWidth } from "./ui/layout-preview.js";
import { sym } from "./ui/symbols.js";
import { commandExecutable, replaceCommandExecutable } from "./command-spec.js";

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
// ANSI cursor control helpers
// ---------------------------------------------------------------------------

const SHOW_CURSOR = "\x1b[?25h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";

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
    // FE-M4 (#548): count physical rows, not just logical lines.
    // A line wider than the terminal wraps and occupies multiple physical rows.
    const cols = process.stdout.columns || 80;
    const safeWidth = cols > 0 ? cols : 80;
    // Strip ANSI escape sequences before measuring display width
    // eslint-disable-next-line no-control-regex
    const visible = msg.replace(/\x1b\[[0-9;]*m/g, "");
    const displayW = getDisplayWidth(visible);
    this.linesSince += Math.max(1, Math.ceil(displayW / safeWidth));
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
    const maxWidth = Math.max(20, (process.stdout.columns || 84) - 4);
    const preview = renderLayoutPreview(grid, maxWidth);
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

  /**
   * Erase the preview from the terminal and reset state.
   * Moves cursor back to the start of the preview and clears to end of screen,
   * so subsequent output (e.g. validation warnings) appears on a clean screen.
   * If the renderer is inactive this is a no-op.
   */
  clear(): void {
    if (this.active) {
      const totalUp = this.lastHeight + this.linesSince;
      process.stdout.write(ansiSyncStart());
      process.stdout.write(ansiLineStart() + ansiUp(totalUp) + ansiClearDown());
      process.stdout.write(ansiSyncEnd());
    }
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
 * Build a string[][] grid with focus highlighting for the grid builder.
 * Focused cell shows cyan "*", other cells show dim "·".
 */
function buildFocusGrid(
  columns: number[],
  focusCol: number,
  focusRow: number,
): string[][] {
  return columns.map((paneCount, c) => {
    const col: string[] = [];
    for (let p = 0; p < paneCount; p++) {
      col.push(c === focusCol && p === focusRow ? cyan("*") : dim("\u00b7"));
    }
    return col;
  });
}

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
  return renderLayoutPreview(buildFocusGrid(columns, focusCol, focusRow));
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
    "[Shift+Tab] move focus back",
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
    renderer.draw(buildFocusGrid(state.columns, state.focusCol, state.focusRow));
    renderer.log(renderGridBuilderHints(state));
  };

  console.log(bold("  Build your grid:"));
  console.log();
  render();

  // FE-M4 (#261): Register emergency cleanup handlers BEFORE entering raw mode
  const emergencyCleanup = (): void => {
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
  };
  const uncaughtHandler = (err: Error): never => {
    emergencyCleanup();
    throw err;
  };
  process.once("exit", emergencyCleanup);
  process.once("uncaughtException", uncaughtHandler);

  process.stdin.setRawMode(true);
  emitKeypressEvents(process.stdin);
  process.stdin.resume();

  return new Promise((resolve) => {
    const cleanup = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      process.removeListener("SIGINT", onSigInt);
      // Remove emergency handlers registered before raw mode
      process.removeListener("exit", emergencyCleanup);
      process.removeListener("uncaughtException", uncaughtHandler);
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


export function printSection(title: string, termWidth?: number): void {
  const PREFIX_DASHES = 2;
  const rawWidth = termWidth ?? process.stdout.columns ?? 80;
  const TOTAL_WIDTH = Math.min(rawWidth, 100);
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
 * Reuses resolveCommand from utils.ts — single source of truth for shell resolution.
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
// Wizard back navigation sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel returned by wizard step functions when the user requests to go back.
 * The wizard state machine checks for this value and decrements the step counter.
 * @internal — exported for testing only
 */
export const WIZARD_BACK = Symbol("WIZARD_BACK");

// ---------------------------------------------------------------------------
// Interactive input helpers
// ---------------------------------------------------------------------------

/**
 * Show numbered options and prompt for selection.
 * Re-prompts on invalid input. Returns 0-based index.
 * Empty input selects defaultIdx.
 * Returns WIZARD_BACK if the user enters 'b' or 'back'.
 */
export async function numberedSelect(
  options: SelectOption[],
  promptText: string,
  defaultIdx?: number,
  showBackHint = true,
): Promise<number | typeof WIZARD_BACK> {
  const printOptions = (): void => {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const marker = opt.marker ?? "  ";
      const detail = opt.detail ? `    ${dim(opt.detail)}` : "";
      console.log(`${marker}${i + 1}) ${opt.label}${detail}`);
    }
  };

  // Display options on initial render
  printOptions();

  // #434 UX-M7: Back hint shown below options so users know they can press 0/b to go back.
  // #482 UX-H3: Suppressed at step 1 where there is no previous step.
  const BACK_HINT = dim("  (press 0 or b to go back)");
  if (showBackHint) {
    console.log(BACK_HINT);
  }

  const ask = async (isRetry = false): Promise<number | typeof WIZARD_BACK> => {
    if (isRetry) {
      // #412 FE-M6: On retry we need to move up past: options, back hint (1 line if shown),
      // the previous prompt+answer line (1 line), and the error message line (1 line).
      const hintLines = showBackHint ? 1 : 0;
      process.stdout.write(ansiLineStart() + ansiUp(options.length + 2 + hintLines) + ansiClearDown());
      printOptions();
      if (showBackHint) {
        console.log(BACK_HINT);
      }
    }

    const trimmed = await promptUser(promptText);

    if (trimmed === "0" || trimmed === "b" || trimmed === "back") {
      return WIZARD_BACK;
    }

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
      return ask(true);
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
  { cmd: "vim", name: "Vim", desc: "Classic modal editor" },
  { cmd: "nvim", name: "Neovim", desc: "Modern Vim" },
  { cmd: "hx", name: "Helix", desc: "Post-modern modal editor" },
  { cmd: "emacs", name: "Emacs", desc: "Extensible editor" },
  { cmd: "nano", name: "Nano", desc: "Simple text editor" },
  { cmd: "claude", name: "Claude Code", desc: "AI pair programmer" },
];

export const SIDEBAR_CATALOG: readonly ToolEntry[] = [
  { cmd: "lazygit", name: "lazygit", desc: "Git TUI" },
  { cmd: "gitui", name: "GitUI", desc: "Fast Git TUI in Rust" },
  { cmd: "tig", name: "tig", desc: "Text-mode git interface" },
  { cmd: "btop", name: "btop", desc: "Resource monitor" },
  { cmd: "htop", name: "htop", desc: "Process viewer" },
];

// LAYOUT_INFO and GRID_TEMPLATES are imported from ./setup-gallery.js (AR-S2 #317)

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

// isGhosttyInstalled is imported from ./utils.js

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

export async function selectLayout(): Promise<string | typeof WIZARD_BACK> {
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
  // #482 UX-H3: suppress back hint at step 1 (Layout is the first wizard step; there is no previous step).
  const idx = await numberedSelect(
    options,
    `  Select [1-${totalCount}] (default: ${defaultIdx + 1}): `,
    defaultIdx,
    false,
  );

  if (idx === WIZARD_BACK) return WIZARD_BACK;

  // Custom layout: flow into the layout builder
  if (idx === presetNames.length) {
    console.log();
    let name = "";
    while (!name) {
      name = await promptUser("  Name your layout (e.g., mysetup): ");
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
  // #427 UX-L3: legend explaining pane label shorthands shown in the diagram
  console.log(dim("  [E] = editor  [S] = sidebar  [R] = right column / shell"));
  console.log();
  return chosen;
}

export async function selectToolFromCatalog(
  catalog: readonly ToolEntry[],
  sectionTitle: string,
): Promise<string | typeof WIZARD_BACK> {
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

  // The tool list height is available.length tool rows + 1 "c) Custom" row
  const toolListHeight = available.length + 1;

  const printToolList = (): void => {
    for (let i = 0; i < available.length; i++) {
      const t = available[i]!;
      console.log(`  * ${i + 1}) ${t.cmd.padEnd(10)} ${t.name}    ${dim(t.desc)}`);
    }
    console.log(`    c) Custom command`);
  };

  // Display only available tools
  printToolList();

  const askTool = async (isRetry = false): Promise<string | typeof WIZARD_BACK> => {
    if (isRetry) {
      // Move cursor back to start of tool list, clear, and reprint
      process.stdout.write(ansiLineStart() + ansiUp(toolListHeight) + ansiClearDown());
      printToolList();
    }

    const trimmed = (await promptUser(`  Select (default: 1): `)).toLowerCase();
    if (trimmed === "") {
      return available[0]!.cmd;
    }
    // #483 UX-M1: back navigation support in tool selection steps
    if (trimmed === "b" || trimmed === "back" || trimmed === "0") {
      return WIZARD_BACK;
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
      return askTool(true);
    }
    return available[num - 1]!.cmd;
  };

  return askTool();
}

async function selectEditor(): Promise<string | typeof WIZARD_BACK> {
  return selectToolFromCatalog(EDITOR_CATALOG, "Editor");
}

async function selectSidebar(): Promise<string | typeof WIZARD_BACK> {
  return selectToolFromCatalog(SIDEBAR_CATALOG, "Sidebar");
}

export async function selectShell(): Promise<string | typeof WIZARD_BACK> {
  printSection("Shell Pane");
  const options: SelectOption[] = [
    {
      label: "Shell".padEnd(12) + "Open a plain shell (run commands manually)",
      value: "true",
    },
    { label: "Disabled".padEnd(12) + "No shell pane", value: "false" },
    {
      label: "Command".padEnd(12) + "Auto-run a command (e.g. npm run dev)",
      value: "__custom__",
    },
  ];
  const idx = await numberedSelect(options, "  Select [1-3] (default: 1): ", 0);
  if (idx === WIZARD_BACK) return WIZARD_BACK;
  const chosen = options[idx]!;
  if (chosen.value === "__custom__") {
    let cmd = "";
    while (!cmd) {
      cmd = await textInput("  Enter shell command:");
    }
    return cmd;
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

export async function selectStarshipPreset(): Promise<string | null | typeof WIZARD_BACK> {
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
  if (idx === WIZARD_BACK) return WIZARD_BACK;
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
  const editorExecutable = commandExecutable(result.editor);
  if (editorExecutable && resolveCommandPath(editorExecutable) === null) {
    warnings.push({
      key: "editor",
      cmd: editorExecutable,
      installHint: INSTALL_HINTS[editorExecutable],
    });
  }

  // Check sidebar
  const sidebarExecutable = commandExecutable(result.sidebar);
  if (sidebarExecutable && resolveCommandPath(sidebarExecutable) === null) {
    warnings.push({
      key: "sidebar",
      cmd: sidebarExecutable,
      installHint: INSTALL_HINTS[sidebarExecutable],
    });
  }

  // Check shell (only if it's a custom command, not "true"/"false")
  if (result.shell !== "true" && result.shell !== "false") {
    const shellExecutable = commandExecutable(result.shell);
    if (shellExecutable && resolveCommandPath(shellExecutable) === null) {
      warnings.push({
        key: "shell",
        cmd: shellExecutable,
        installHint: INSTALL_HINTS[shellExecutable],
      });
    }
  }

  // Check Ghostty
  const ghosttyFound = isGhosttyInstalled();

  return { warnings, ghosttyFound };
}

function printValidation(validation: ValidationResult): void {
  printSection("Checking tools");

  if (validation.ghosttyFound) {
    console.log(`  ${green(sym.ok)} Ghostty    found`);
  } else {
    console.log(
      `  ${yellow(sym.warn)} Ghostty    not found — install from https://ghostty.org`,
    );
  }

  if (validation.warnings.length === 0) {
    console.log(`  ${green(sym.ok)} All selected tools are available`);
  } else {
    for (const w of validation.warnings) {
      const hint = w.installHint ? ` — install with: ${w.installHint}` : "";
      console.log(`  ${yellow(sym.warn)} ${w.cmd.padEnd(10)} not found${hint}`);
    }
    console.log();
    console.log(dim("  Some tools are missing. Install them later or"));
    console.log(
      dim("  change your config with: summon set <key> <value>"),
    );
  }

  console.log();
}

export async function checkAndRecoverAccessibility(): Promise<boolean> {
  printSection("Accessibility");
  const granted = checkAccessibility();

  if (granted) {
    console.log(`  ${green(sym.ok)} Accessibility permission granted`);
    console.log();
    return true;
  }

  // Not granted — show warning and offer recovery
  console.log(`  ${yellow(sym.warn)} Accessibility permission not granted`);
  console.log();
  console.log(dim("  Summon uses System Events to control Ghostty panes."));
  console.log(dim(`  Grant accessibility access to Ghostty in ${ACCESSIBILITY_SETTINGS_PATH}.`));
  console.log();

  const shouldOpen = await confirm("  Open Accessibility settings now?");
  if (shouldOpen) {
    openAccessibilitySettings();
    console.log();
    console.log(dim(`  ${ACCESSIBILITY_ENABLE_HINT}`));
    console.log(dim("  You may need to click the lock icon first."));
    console.log();
    await promptUser("  Press Enter after granting access...");
    const rechecked = checkAccessibility();
    if (rechecked) {
      console.log(`  ${green(sym.ok)} Accessibility permission granted!`);
      console.log();
      return true;
    }
    console.log(`  ${yellow(sym.warn)} Still not detected — you can grant it later.`);
    console.log(dim("  Summon will work once Ghostty has Accessibility access."));
    console.log();
    return false;
  }

  console.log(dim("  You can grant it later. Summon needs Accessibility to work."));
  console.log();
  return false;
}

/** Wizard step indices for back navigation history tracking. */
const enum WizardStep {
  Layout = 0,
  Editor = 1,
  Sidebar = 2,
  Shell = 3,
  Starship = 4,
  Confirm = 5,
}

// AR-L2 (#399): This function is the wizard state machine and composes multiple concerns
// (welcome, layout, editor, sidebar, shell, starship, confirm). Extracting it into a
// dedicated module (e.g., src/wizard.ts) is tracked as architectural debt in #399.
export async function runSetup(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("Setup requires an interactive terminal.");
    console.error("Configure manually with: summon set <key> <value>");
    process.exit(1);
  }

  debugLog("wizard start");
  printWelcome();

  // UX-H3 (#282): accessibility check runs AFTER the first selectLayout prompt
  // so users can read the welcome before being presented with a system-permission dialog.
  let accessibilityChecked = false;

  // State collected across wizard steps
  let layout = "";
  let editor = "";
  let sidebar = "";
  let shell = "false";
  let starshipPreset: string | null = null;

  // Step-based navigation: history tracks which steps we've visited
  const history: WizardStep[] = [];
  let currentStep: WizardStep = WizardStep.Layout;

  const goBack = (): void => {
    const prev = history.pop();
    currentStep = prev ?? WizardStep.Layout;
  };

  while (true) {
    if (currentStep === WizardStep.Layout) {
      debugLog(`wizard step: layout`);
      const result = await selectLayout();
      if (result === WIZARD_BACK) {
        // Already at first step — just re-show
        continue;
      }
      layout = result;
      debugLog(`wizard step complete: layout=${layout}`);
      if (!accessibilityChecked) {
        accessibilityChecked = true;
        await checkAndRecoverAccessibility();
      }
      history.push(WizardStep.Layout);
      const isCustom = isCustomLayout(layout);
      if (isCustom) {
        console.log(dim("  Custom layout — pane commands are defined in the layout."));
        console.log(dim("  Skipping editor, sidebar, and shell selection."));
        console.log();
        currentStep = WizardStep.Starship;
      } else {
        currentStep = WizardStep.Editor;
      }
      continue;
    }

    if (currentStep === WizardStep.Editor) {
      debugLog(`wizard step: editor`);
      const editorResult = await selectEditor();
      // #483 UX-M1: back navigation support in editor step
      if (editorResult === WIZARD_BACK) {
        goBack();
        continue;
      }
      editor = editorResult;
      history.push(WizardStep.Editor);
      currentStep = WizardStep.Sidebar;
      continue;
    }

    if (currentStep === WizardStep.Sidebar) {
      debugLog(`wizard step: sidebar`);
      const sidebarResult = await selectSidebar();
      // #483 UX-M1: back navigation support in sidebar step
      if (sidebarResult === WIZARD_BACK) {
        goBack();
        continue;
      }
      sidebar = sidebarResult;
      history.push(WizardStep.Sidebar);
      if (layout === "minimal") {
        console.log(dim("  Minimal layout has no shell pane."));
        console.log();
        shell = "false";
        currentStep = WizardStep.Starship;
      } else {
        currentStep = WizardStep.Shell;
      }
      continue;
    }

    if (currentStep === WizardStep.Shell) {
      debugLog(`wizard step: shell`);
      const result = await selectShell();
      if (result === WIZARD_BACK) {
        goBack();
        continue;
      }
      shell = result;
      history.push(WizardStep.Shell);
      currentStep = WizardStep.Starship;
      continue;
    }

    if (currentStep === WizardStep.Starship) {
      debugLog(`wizard step: starship`);
      const result = await selectStarshipPreset();
      if (result === WIZARD_BACK) {
        goBack();
        continue;
      }
      starshipPreset = result;
      history.push(WizardStep.Starship);
      currentStep = WizardStep.Confirm;
      continue;
    }

    // Confirm step
    const isCustom = isCustomLayout(layout);
    const wizardResult: SetupResult = { layout, editor, sidebar, shell };

    if (isCustom) {
      printSection("Summary");
      console.log(`  Layout:    ${bold(layout)} (custom)`);
      if (starshipPreset) {
        console.log(`  Starship:  ${bold(starshipPreset)}`);
      }
      console.log();
    } else {
      printSummary(wizardResult, starshipPreset);
    }

    const accepted = await confirm("  Save these settings?");
    if (accepted) {
      setConfig("layout", wizardResult.layout);
      if (!isCustom) {
        setConfig("editor", wizardResult.editor);
        setConfig("sidebar", wizardResult.sidebar);
        setConfig("shell", wizardResult.shell);
      }
      if (starshipPreset) {
        setConfig("starship-preset", starshipPreset);
      }

      if (!isCustom) {
        const validation = validateSetup(wizardResult);
        printValidation(validation);
      }

      debugLog("wizard exit: completed");
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
    debugLog("wizard exit: cancelled (looping back)");
    console.log();
    // Reset wizard state and restart from layout
    history.length = 0;
    layout = "";
    editor = "";
    sidebar = "";
    shell = "false";
    starshipPreset = null;
    currentStep = WizardStep.Layout;
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
 * Also returns whether the renderer state is now stale (extra output was printed).
 * @internal — exported for testing only
 */
export async function validateBuilderCommand(
  cmd: string,
  knownCmds: string[],
): Promise<{ cmd: string; rendererStale: boolean }> {
  if (cmd === "shell") return { cmd, rendererStale: false }; // special value — plain shell
  const cmdName = commandExecutable(cmd) ?? cmd;
  if (resolveCommandPath(cmdName)) return { cmd, rendererStale: false }; // found in PATH

  // Command not found — will print extra output, so renderer state becomes stale
  const suggestion = findClosestCommand(cmdName, knownCmds);
  if (suggestion) {
    console.log(yellow(`  '${cmdName}' not found. Did you mean '${suggestion}'?`));
    const useSuggestion = await confirm(`  Use '${suggestion}' instead?`);
    if (useSuggestion) {
      return { cmd: replaceCommandExecutable(cmd, suggestion), rendererStale: true };
    }
  } else {
    console.log(yellow(`  '${cmdName}' not found on this system.`));
  }
  const keepAnyway = await confirm("  Keep it anyway?");
  if (keepAnyway) return { cmd, rendererStale: true };
  return { cmd: "", rendererStale: true }; // empty = re-prompt
}

/**
 * Extract a pane name from a command string: first word, deduped.
 * Used names are tracked to append _2, _3, etc.
 */
function derivePaneName(command: string, usedNames: Set<string>): string {
  const base = (commandExecutable(command) ?? "pane")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+/, "") || "pane";
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
  // Detect available tools once
  const detected = detectTools([...EDITOR_CATALOG, ...SIDEBAR_CATALOG]);
  const availableTools = detected.filter((t) => t.available);
  const availableCmds = availableTools.map((t) => t.cmd); // still used by validateBuilderCommand

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
      // Numbered quick-pick list (each renderer.log() call is tracked for cursor math)
      for (let i = 0; i < availableTools.length; i++) {
        const t = availableTools[i]!;
        renderer.log(`  * ${i + 1}) ${t.cmd.padEnd(10)} ${t.name}    ${dim(t.desc)}`);
      }
      if (availableTools.length > 0) {
        renderer.log(`    c) Custom command`);
      }
      renderer.log(`    [Enter] shell (default)`);

      let cmd = "";
      while (!cmd) {
        renderer.countPrompt();
        const raw = await promptUser(
          `  Column ${c + 1}, Pane ${p + 1} \u2014 select or type [shell]: `,
        );
        const trimmed = raw.trim();
        if (trimmed === "") {
          cmd = "shell";
        } else if (trimmed.toLowerCase() === "c") {
          renderer.countPrompt(); // account for the upcoming textInput prompt + answer
          cmd = (await textInput("  Enter command:")) || "shell";
        } else {
          const num = parseInt(trimmed, 10);
          if (!isNaN(num) && num >= 1 && num <= availableTools.length) {
            cmd = availableTools[num - 1]!.cmd;
          } else {
            cmd = trimmed; // free-form \u2192 goes through validateBuilderCommand as before
          }
        }
        // Clear the preview before validation (while cursor math is still accurate),
        // so any warning output from validateBuilderCommand appears on a clean screen.
        // FE-M5 (#389): prevents stacked duplicate previews after validation errors.
        renderer.clear();
        const { cmd: validated } = await validateBuilderCommand(cmd, availableCmds);
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
