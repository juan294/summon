import { sym } from "./ui/symbols.js";
import { readAllStatuses, getGitBranch, isLiveState as isLiveWorkspaceState, unverifiedMessage } from "./status.js";
import type { ProgramState } from "./backends/rex/status.js";
import type { ResolvedStatus } from "./status.js";
import { listProjects } from "./config.js";
import { bold, dim, green, red, yellow, cyan, invert } from "./ui/ansi.js";
import { getDisplayWidth, truncate } from "./ui/width.js";
import { runPool, IO_CONCURRENCY } from "./utils.js";
import { createMonitorInputDecoder } from "./monitor-input.js";
import { createMonitorVisibility, type VisibilityEffects } from "./monitor-visibility.js";

// --- Types ---

/** `partial`: a Rex workspace whose root pane closed while other panes live; `unknown`: liveness could not be read (plan P10). */
export type ProjectState = "active" | "active-long" | "partial" | "stopped" | "unknown";

export interface ProjectRow {
  name: string;
  directory: string;
  state: ProjectState;
  uptime: string;
  gitBranch: string;
  /** Why the state is `unknown` or `partial`; shown in the detail column. */
  reason?: string;
  /** Advisory lines (late adoption, pane-file refresh) printed under the row by `summon status --once`. */
  notices?: string[];
  /** Rex only: the root pane's program status (OSC 7501), shown as a glyph before the dot. */
  programStatus?: ProgramState;
}

/** One column: what the root pane's program reports (`idle` and nothing shows a space). */
export function programGlyph(state: ProgramState | undefined): string {
  switch (state) {
    case "blocked": return yellow(sym.warn);
    case "error": return red(sym.fail);
    case "working": return cyan("\u22EF"); // ⋯
    case "done": return green(sym.ok);
    default: return " ";
  }
}

/** States that have a live workspace to focus (`active-long` is `active` with a long uptime). */
export function isLiveState(state: ProjectState): boolean {
  return isLiveWorkspaceState(state === "active-long" ? "active" : state);
}

// --- Constants ---

const LONG_RUNNING_MS = 4 * 60 * 60 * 1000; // 4 hours
const REFRESH_INTERVAL_MS = 3000;
const NAME_WIDTH = 16;
const STATE_WIDTH = 8;
const UPTIME_WIDTH = 8;
const FIXED_COLS = 2 + 1 + NAME_WIDTH + 2 + STATE_WIDTH + 2 + UPTIME_WIDTH + 2; // dot + program glyph + spaces + padding
const MIN_COLS = 60; // below this width, show the narrow-terminal guard

// Terminal control sequences
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[H\x1b[2J";
const CURSOR_HOME = "\x1b[H";

// --- Formatting (pure functions, testable) ---

// truncate is re-exported from ui/width.ts for use in this module and its tests.
// It is imported above from "./ui/width.js".
export { truncate };

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  if (hours < 24) return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

export function stateColor(state: ProjectState): (s: string) => string {
  switch (state) {
    case "active": return green;
    case "active-long":
    case "partial": return yellow;
    case "stopped":
    case "unknown": return dim;
  }
}

export function stateDot(state: ProjectState): string {
  switch (state) {
    case "active":
    case "active-long":
    case "partial": return "\u25CF"; // ●
    case "stopped":
    case "unknown": return "\u25CB"; // ○
  }
}

/**
 * Pad a string to at least `targetWidth` display columns using trailing spaces.
 * Wide characters (CJK, emoji) are counted as 2 columns each.
 */
function displayPadEnd(str: string, targetWidth: number): string {
  const w = getDisplayWidth(str);
  return w < targetWidth ? str + " ".repeat(targetWidth - w) : str;
}

export function renderRow(row: ProjectRow, width: number, selected: boolean): string {
  const colorFn = stateColor(row.state);
  const dot = colorFn(stateDot(row.state));
  const name = displayPadEnd(truncate(row.name, NAME_WIDTH), NAME_WIDTH);
  // UX-H2 (#599): active-long gets "active*" label so it is distinguishable without color
  const stateText = row.state === "active-long" ? "active*" : row.state;
  const stateLabel = colorFn(stateText);
  // Pad the visible text, not the ANSI-wrapped version
  const statePad = " ".repeat(Math.max(0, STATE_WIDTH - stateText.length));
  const uptime = row.uptime.padEnd(UPTIME_WIDTH);

  const branchWidth = Math.max(0, width - FIXED_COLS);
  // For stopped/unknown workspaces, show the directory path (dimmed) instead of em dash;
  // any non-active state with a reason (Rex: partial, stopped, unknown) shows the reason instead.
  const isStopped = row.state === "stopped" || row.state === "unknown";
  const detail = row.state !== "active" && row.state !== "active-long" && row.reason ? row.reason : undefined;
  const rawBranchText = detail ?? (isStopped ? row.directory : row.gitBranch);
  const branchText = truncate(rawBranchText, branchWidth);
  const branch = isStopped || detail ? dim(branchText) : branchText;

  const line = ` ${programGlyph(row.programStatus)}${dot} ${name}  ${stateLabel}${statePad}  ${uptime}  ${branch}`;

  if (selected) {
    return invert(line);
  }
  return line;
}

export function renderHeader(activeCount: number, totalCount: number, width: number): string {
  const left = `  ${bold("summon status")}`;
  const right = `\u25B8 ${activeCount} / ${totalCount}  `;
  // Left side has ANSI codes, so pad by visible width
  const leftVisible = "  summon status".length;
  const padding = Math.max(0, width - leftVisible - right.length);
  return left + " ".repeat(padding) + dim(right);
}

export function renderFooter(width: number, visibilityUnavailable = false): string {
  const keys = visibilityUnavailable
    ? "  ↑↓/jk navigate  ⏎ open  ? help  q quit | Visibility unavailable; polling"
    : "  \u2191\u2193/jk navigate  \u23CE open  r refresh  ? help  q quit";
  const padded = keys.length < width ? keys + " ".repeat(width - keys.length) : keys.slice(0, width);
  return dim(padded);
}

export function renderScreen(rows: ProjectRow[], selectedIndex: number, width: number, height: number, scrollStart = 0, visibilityUnavailable = false): string {
  // UX-L1 (#616): when terminal is too narrow, render a guard message instead of a clamped grid
  if (width < MIN_COLS) {
    return `Terminal too narrow \u2014 widen to \u2265${MIN_COLS} cols`;
  }

  const activeCount = rows.filter(r => isLiveState(r.state)).length;
  const header = renderHeader(activeCount, rows.length, width);
  const separator = dim("\u2500".repeat(width));
  const footer = renderFooter(width, visibilityUnavailable);

  // Available rows: height minus header, 2 separators, footer
  const availableRows = Math.max(1, height - 4);

  const visibleRows = rows.slice(scrollStart, scrollStart + availableRows);
  let renderedRows: string[];
  if (rows.length === 0) {
    renderedRows = [
      "  No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.",
    ];
  } else {
    renderedRows = visibleRows.map((row, i) =>
      renderRow(row, width, scrollStart + i === selectedIndex),
    );
  }

  // Pad with empty lines if fewer rows than available space
  while (renderedRows.length < availableRows) {
    renderedRows.push("");
  }

  // FE-M3 (#611): append EL (erase-to-end-of-line) to each content row so that
  // CURSOR_HOME repaints never leave trailing characters from previously-longer lines.
  const clearedRows = renderedRows.map(r => `${r}\x1b[0K`);

  const lines = [header, separator, ...clearedRows, separator, footer];
  return lines.join("\n");
}

// --- Git Branch Cache ---

const gitBranchCache = new Map<string, { value: string; timestamp: number }>();
const gitBranchFetching = new Set<string>(); // directories with in-flight fetches
const GIT_CACHE_TTL_MS = 10_000; // 10 seconds

/**
 * Returns cached git branch if fresh, or null if stale/missing.
 * Never blocks — callers should use "…" placeholder when null is returned
 * and kick off an async fetch via prefetchGitBranches().
 */
function getCachedGitBranch(directory: string): string | null {
  const cached = gitBranchCache.get(directory);
  if (cached && Date.now() - cached.timestamp < GIT_CACHE_TTL_MS) {
    return cached.value;
  }
  return null;
}

/**
 * Async: for each active row whose branch is not yet cached, spawn a background
 * git call. Calls onUpdate() once (after all fetches) if any new data was stored.
 * Safe to call from a render loop — won't double-fetch the same directory.
 */
export async function prefetchGitBranches(rows: ProjectRow[], onUpdate: () => void): Promise<void> {
  const toFetch = rows.filter(
    (r) =>
      isLiveState(r.state) &&
      !getCachedGitBranch(r.directory) &&
      !gitBranchFetching.has(r.directory),
  );

  if (toFetch.length === 0) return;

  toFetch.forEach((r) => gitBranchFetching.add(r.directory));

  await runPool(toFetch, IO_CONCURRENCY, async (r) => {
    const branch = await getGitBranch(r.directory);
    if (branch) {
      gitBranchCache.set(r.directory, { value: branch, timestamp: Date.now() });
    } else {
      gitBranchCache.delete(r.directory);
    }
    gitBranchFetching.delete(r.directory);
  });

  onUpdate();
}

export function resetGitBranchCache(): void {
  gitBranchCache.clear();
  gitBranchFetching.clear();
}

// --- Data Loading ---

/** The four workspace states map one to one; `active` splits by uptime (plan P10: `unknown` is never collapsed). */
export function classifyState(status: ResolvedStatus): ProjectState {
  if (status.state === "unknown") return "unknown";
  if (status.state === "partial") return "partial";
  if (status.state === "stopped") return "stopped";
  if (status.uptime !== null && status.uptime > LONG_RUNNING_MS) return "active-long";
  return "active";
}

function statusToRow(name: string, directory: string, status: ResolvedStatus): ProjectRow {
  const state = classifyState(status);
  const isActive = status.state === "active" || status.state === "partial";
  let gitBranch: string;
  if (isActive) {
    const cached = getCachedGitBranch(directory);
    // Use cached value if fresh; use "\u2026" as a placeholder when git data is being fetched async
    gitBranch = cached ?? "\u2026";
  } else {
    gitBranch = "\u2014";
  }
  return {
    name,
    directory,
    state,
    uptime: status.uptime !== null ? formatUptime(status.uptime) : "\u2014",
    gitBranch,
    ...(status.reason ? { reason: status.reason } : {}),
    ...(status.notices && status.notices.length > 0 ? { notices: status.notices } : {}),
    ...(status.programStatus ? { programStatus: status.programStatus.state } : {}),
  };
}

export function loadProjectRows(): ProjectRow[] {
  const projects = listProjects();
  const statuses = readAllStatuses({ programStatus: true });
  const statusMap = new Map<string, ResolvedStatus>();
  for (const s of statuses) {
    statusMap.set(s.project, s);
  }

  const rows: ProjectRow[] = [];
  const seen = new Set<string>();

  for (const [name, directory] of projects) {
    seen.add(name);
    const status = statusMap.get(name);
    if (status) {
      rows.push(statusToRow(name, directory, status));
    } else {
      rows.push({ name, directory, state: "unknown", uptime: "\u2014", gitBranch: "\u2014" });
    }
  }

  for (const status of statuses) {
    if (seen.has(status.project)) continue;
    rows.push(statusToRow(status.project, status.directory, status));
  }

  const stateOrder: Record<ProjectState, number> = { active: 0, "active-long": 1, partial: 2, stopped: 3, unknown: 4 };
  return rows.sort((a, b) => stateOrder[a.state] - stateOrder[b.state]);
}

// --- Single-shot mode ---

export function printStatusOnce(): void {
  const rows = loadProjectRows();
  if (rows.length === 0) {
    console.log("No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.");
    return;
  }

  const activeCount = rows.filter(r => isLiveState(r.state)).length;
  console.log(`Workspace status (${activeCount} active / ${rows.length} total):\n`);

  const width = process.stdout.columns || 80;
  for (const row of rows) {
    console.log(renderRow(row, width, false));
    for (const line of row.notices ?? []) console.log(`      ${dim(`note: ${line}`)}`);
  }
}

// --- TUI Monitor ---

export async function runMonitor(): Promise<void> {
  let rows = loadProjectRows();
  let selectedIndex = 0;
  let scrollStart = 0;
  let prevFrame: string | null = null;
  let ui: "dashboard" | "help" | "error" = "dashboard";
  let errorLines: string[] = [];
  let generation = 0;
  type Session = {
    generation: number;
    disposed: boolean;
    hidden: boolean;
    fallback: boolean;
    dirty: boolean;
    wasRaw: boolean;
    decoder: ReturnType<typeof createMonitorInputDecoder>;
    visibility: ReturnType<typeof createMonitorVisibility>;
    refreshTimer: ReturnType<typeof setInterval> | null;
    visibilityTimer: ReturnType<typeof setTimeout> | null;
    inputTimer: ReturnType<typeof setTimeout> | null;
    onSigint: () => void;
    onSigterm: () => void;
  };
  let session: Session;
  const getWidth = () => process.stdout.columns || 80;
  const getHeight = () => process.stdout.rows || 24;
  const current = (s: Session) => session === s && !s.disposed && s.generation === generation;

    const helpLines = [
          "",
          `  ${bold("Key bindings:")}`,
          `  ${cyan("↑/k")}        ${dim("move up")}`,
          `  ${cyan("↓/j")}        ${dim("move down")}`,
          `  ${cyan("⏎")}          ${dim("open selected project")}`,
          `  ${cyan("r")}          ${dim("refresh")}`,
          `  ${cyan("?")}          ${dim("show this help")}`,
          `  ${cyan("q / Ctrl+C")} ${dim("quit")}`,
          "",
          // UX-H2 (#599) + UX-L1 (#616): glyph markers so the legend is readable
          // under NO_COLOR; "active*" matches the row label for long-running workspaces.
          `  ${bold("State legend:")}`,
          `  ${green("●")} ${dim("active")}   ${yellow("●")} ${dim("active* (running >4h)")}   ${dim("○ stopped/unknown")}`,
          `  ${dim("color: green = active, yellow = running >4h, dim = stopped")}`,
          "",
          `  ${dim("Press any key to dismiss...")}`,
        ];
  function render(fullClear = false): void {
    if (!current(session) || session.hidden) return;
    const availableRows = Math.max(1, getHeight() - 4);
    if (selectedIndex >= scrollStart + availableRows) scrollStart = selectedIndex - availableRows + 1;
    else if (selectedIndex < scrollStart) scrollStart = selectedIndex;
    const screen = ui === "help" ? helpLines.join("\n")
      : ui === "error" ? errorLines.join("\n")
      : renderScreen(rows, selectedIndex, getWidth(), getHeight(), scrollStart, session.fallback);
    if (!fullClear && !session.dirty && screen === prevFrame) return;
    process.stdout.write((fullClear || session.dirty ? CLEAR_SCREEN : CURSOR_HOME) + screen);
    session.dirty = false;
    prevFrame = screen;
  }

  function prefetch(): void {
    const owner = session;
    void prefetchGitBranches(rows, () => {
      if (!current(owner) || owner.hidden) return;
      for (const row of rows) {
        const cached = getCachedGitBranch(row.directory);
        if (isLiveState(row.state) && cached) row.gitBranch = cached;
      }
      if (ui === "dashboard") render();
    });
  }

  function refresh(): void {
    if (!current(session) || session.hidden) return;
    rows = loadProjectRows();
    selectedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1));
    if (ui === "dashboard") render();
    prefetch();
  }

  function applyEffects(s: Session, effects: VisibilityEffects): void {
    if (!current(s)) return;
    const wasFallback = s.fallback;
    s.hidden = effects.hidden;
    s.fallback = effects.fallback;
    if (s.visibilityTimer) clearTimeout(s.visibilityTimer);
    s.visibilityTimer = effects.nextDeadline === null ? null : setTimeout(() => {
      if (current(s)) applyEffects(s, s.visibility.tick(Date.now()));
    }, Math.max(0, effects.nextDeadline - Date.now()));
    if (s.hidden) {
      if (s.refreshTimer) clearInterval(s.refreshTimer);
      s.refreshTimer = null;
    } else if (!s.refreshTimer) s.refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
    // Schedule before writing: a terminal can respond synchronously in an IO harness.
    for (const wire of effects.writes) process.stdout.write(wire);
    if (effects.refresh) { refresh(); if (ui !== "dashboard") render(); }
    else if (!wasFallback && s.fallback) render();
  }

  function cleanup(): void {
    const s = session;
    if (!s || s.disposed) return;
    s.disposed = true;
    if (s.refreshTimer) clearInterval(s.refreshTimer);
    if (s.visibilityTimer) clearTimeout(s.visibilityTimer);
    if (s.inputTimer) clearTimeout(s.inputTimer);
    s.decoder.reset();
    for (const wire of s.visibility.dispose().writes) process.stdout.write(wire);
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
    if (process.stdin.isTTY) process.stdin.setRawMode(s.wasRaw);
    process.stdin.off("data", onInput);
    process.stdin.pause();
    process.off("SIGWINCH", onResize);
    process.off("exit", cleanup);
    process.off("uncaughtException", onUncaughtException);
    process.off("SIGINT", s.onSigint);
    process.off("SIGTERM", s.onSigterm);
  }
  function onSignal(owner: Session, exitCode: number): void {
    if (!current(owner)) return;
    cleanup();
    process.exit(exitCode);
  }
  const onResize = () => {
    if (!current(session)) return;
    session.dirty = true;
    if (!session.hidden) render(true);
  };
  const onUncaughtException = (error: Error) => {
    cleanup();
    process.stderr.write(error.stack ?? error.message);
    process.exit(1);
  };

  let finish: () => void;
  function onInput(data: Buffer): void {
    const owner = session;
    if (!current(owner)) return;
    const events = owner.decoder.push(data, Date.now());
    if (owner.inputTimer) clearTimeout(owner.inputTimer);
    const deadline = owner.decoder.pendingDeadline();
    owner.inputTimer = deadline === null ? null : setTimeout(() => {
      if (current(owner)) owner.decoder.expire(Date.now());
      owner.inputTimer = null;
    }, Math.max(0, deadline - Date.now()));
    for (const event of events) {
      if (!current(owner)) break;
      if (event.type !== "key") applyEffects(owner, owner.visibility.handle(event, Date.now()));
      else handleKey(event.bytes);
    }
  }
  function enter(): void {
    const owner: Session = {
      generation: ++generation, disposed: false, hidden: false, fallback: false, dirty: true,
      wasRaw: !!process.stdin.isRaw, decoder: createMonitorInputDecoder(),
      visibility: createMonitorVisibility(!!process.stdin.isTTY && !!process.stdout.isTTY && process.env["SUMMON_NO_VISIBILITY"] !== "1"),
      refreshTimer: null, visibilityTimer: null, inputTimer: null,
      onSigint: () => onSignal(owner, 130),
      onSigterm: () => onSignal(owner, 143),
    };
    session = owner;
    prevFrame = null;
    process.once("exit", cleanup);
    process.once("uncaughtException", onUncaughtException);
    process.once("SIGINT", owner.onSigint);
    process.once("SIGTERM", owner.onSigterm);
    process.on("SIGWINCH", onResize);
    // The decoder is installed before any query is emitted.
    process.stdin.on("data", onInput);
    process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    render(true);
    applyEffects(session, session.visibility.start(Date.now()));
    if (!session.hidden) prefetch();
  }

  async function handoff(selected: ProjectRow): Promise<void> {
    if (!session.hidden) process.stdout.write(`Opening ${selected.name}...\n`);
    cleanup();
    const isActive = isLiveState(selected.state);
    try {
      // Plan P10: an unknown workspace is never launched over or focused; the reason is shown.
      if (selected.state === "unknown") throw new Error(unverifiedMessage(selected.name, selected.reason));
      const { launch, focusWorkspace } = await import("./launcher.js");
      if (isActive) {
        const result = focusWorkspace(selected.name);
        if (result.kind !== "focused") throw new Error(result.reason);
      } else await launch(selected.directory);
      finish();
    } catch (error) {
      ui = "error";
      errorLines = ["", `  ${bold(selected.state === "unknown" ? "Cannot open (state unknown):" : isActive ? "Focus failed:" : "Launch failed:")}`,
        `  ${red(error instanceof Error ? error.message : String(error))}`, "",
        `  ${dim("Press any key to continue...")}`];
      enter();
    }
  }
  function handleKey(key: string): void {
    if (key === "\x03" || (ui === "dashboard" && key === "q")) { cleanup(); finish(); return; }
    if (ui !== "dashboard") { ui = "dashboard"; prevFrame = null; render(true); return; }
    if (key === "\x1b[A" || key === "k") { if (selectedIndex > 0) { selectedIndex--; render(); } return; }
    if (key === "\x1b[B" || key === "j") { if (selectedIndex < rows.length - 1) { selectedIndex++; render(); } return; }
    if (key === "r") { refresh(); return; }
    if (key === "?") { ui = "help"; prevFrame = null; render(true); return; }
    if (key === "\r" || key === "\n") {
      const selected = rows[selectedIndex];
      if (selected) void handoff(selected);
    }
  }
  return new Promise<void>((resolve, reject) => {
    finish = resolve;
    try { enter(); } catch (error) { cleanup(); reject(error); }
  });
}
