import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import { sym } from "./ui/symbols.js";
import { hasRexState, readAllStatuses, rexBinaryPath, readProjectStatus, getGitBranch, unverifiedMessage } from "./status.js";
import { isLiveState as isLiveWorkspaceState } from "./status-record.js";
import type { ProgramState } from "./backends/rex/status.js";
import type { ResolvedStatus } from "./status.js";
import { listProjects } from "./config.js";
import { bold, dim, green, red, yellow, cyan, invert } from "./ui/ansi.js";
import { getDisplayWidth, truncate } from "./ui/width.js";
import { runPool, IO_CONCURRENCY, PromptCancelled } from "./utils.js";
import { createMonitorInputDecoder, type MonitorInput } from "./monitor-input.js";
import { createMonitorVisibility, type VisibilityEffects } from "./monitor-visibility.js";
import { selfInvocation } from "./self.js";
import { withTrustPrompt } from "./trust.js";
import { MONITOR_READ_ARG, MONITOR_READ_OPTIONS, MONITOR_REX_BINARY_ENV } from "./monitor-read.js";

export { MONITOR_READ_ARG } from "./monitor-read.js";

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
/** The one-column pad before the glyph; the `summon open` picker renders rows without it. */
const ROW_PAD = " ";
/** The columns after the pad and before the detail. PREFIX_COLS is measured from this same template, so they cannot drift apart. */
function rowPrefix(glyph: string, dot: string, name: string, state: string, uptime: string): string {
  return `${glyph}${dot} ${name}  ${state}  ${uptime}  `;
}
const PREFIX_COLS = rowPrefix(" ", " ", " ".repeat(NAME_WIDTH), " ".repeat(STATE_WIDTH), " ".repeat(UPTIME_WIDTH)).length;
const FIXED_COLS = ROW_PAD.length + PREFIX_COLS;
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

/** The reason a non-active row shows in its detail column (Rex: partial, stopped, unknown), if any. */
function rowDetail(row: ProjectRow): string | undefined {
  return row.state !== "active" && row.state !== "active-long" && row.reason ? row.reason : undefined;
}

/** `leadingPad: false` drops the pad before the glyph (the picker); the row still fills `width`. */
export function renderRow(row: ProjectRow, width: number, selected: boolean, { leadingPad = true } = {}): string {
  const pad = leadingPad ? ROW_PAD : "";
  const colorFn = stateColor(row.state);
  const dot = colorFn(stateDot(row.state));
  const name = displayPadEnd(truncate(row.name, NAME_WIDTH), NAME_WIDTH);
  // UX-H2 (#599): active-long gets "active*" label so it is distinguishable without color
  const stateText = row.state === "active-long" ? "active*" : row.state;
  const stateLabel = colorFn(stateText);
  // Pad the visible text, not the ANSI-wrapped version
  const statePad = " ".repeat(Math.max(0, STATE_WIDTH - stateText.length));
  const uptime = row.uptime.padEnd(UPTIME_WIDTH);

  const branchWidth = Math.max(0, width - pad.length - PREFIX_COLS);
  // For stopped/unknown workspaces, show the directory path (dimmed) instead of em dash;
  // any non-active state with a reason (Rex: partial, stopped, unknown) shows the reason instead.
  const isStopped = row.state === "stopped" || row.state === "unknown";
  const detail = rowDetail(row);
  const rawBranchText = detail ?? (isStopped ? row.directory : row.gitBranch);
  const branchText = truncate(rawBranchText, branchWidth);
  const branch = isStopped || detail ? dim(branchText) : branchText;

  const line = pad + rowPrefix(programGlyph(row.programStatus), dot, name, stateLabel + statePad, uptime) + branch;

  if (selected) {
    return invert(line);
  }
  return line;
}

/** `note`: how stale the rows are (a read still running, or the age after a failed one), shown dim before the count. */
export function renderHeader(activeCount: number, totalCount: number, width: number, note?: string): string {
  const left = `  ${bold("summon status")}`;
  const right = `${note ? `${note}  ` : ""}\u25B8 ${activeCount} / ${totalCount}  `;
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

export interface RenderScreenOptions {
  /** The first row shown (the list scrolls). */
  scrollStart?: number;
  /** The footer says visibility tracking is off and the monitor polls. */
  visibilityUnavailable?: boolean;
  /** Said in the header when the rows are stale ("updating…", "last updated 6s ago"). */
  staleNote?: string | undefined;
}

export function renderScreen(rows: ProjectRow[], selectedIndex: number, width: number, height: number, options: RenderScreenOptions = {}): string {
  const { scrollStart = 0, visibilityUnavailable = false, staleNote } = options;
  // UX-L1 (#616): when terminal is too narrow, render a guard message instead of a clamped grid
  if (width < MIN_COLS) {
    return `Terminal too narrow \u2014 widen to \u2265${MIN_COLS} cols`;
  }

  const activeCount = rows.filter(r => isLiveState(r.state)).length;
  const header = renderHeader(activeCount, rows.length, width, staleNote);
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

/** Live rows with their git branch filled in; other rows unchanged. */
async function withGitBranches(rows: ProjectRow[]): Promise<ProjectRow[]> {
  const branches = new Map<string, string | null>();
  await runPool(rows.filter((row) => isLiveState(row.state)), IO_CONCURRENCY, async (row) => {
    branches.set(row.directory, await getGitBranch(row.directory));
  });
  // The lookups are done: a live row without a branch (not a git repository) shows the dash, never the placeholder.
  return rows.map((row) => (isLiveState(row.state) ? { ...row, gitBranch: branches.get(row.directory) ?? "\u2014" } : row));
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

/** A registered project with no status record was never launched: stopped, with nothing to verify. */
function neverLaunchedRow(name: string, directory: string): ProjectRow {
  return { name, directory, state: "stopped", uptime: "\u2014", gitBranch: "\u2014" };
}

/**
 * One project's row from one status read (`summon open <project>`); undefined when it is not registered.
 * A launch with a manifest but no record is `unknown` here as in the full listing (never launched over).
 */
export function loadProjectRow(name: string): ProjectRow | undefined {
  const directory = listProjects().get(name);
  if (directory === undefined) return undefined;
  const status = readProjectStatus(name, { reconcile: true });
  return status ? statusToRow(name, directory, status) : neverLaunchedRow(name, directory);
}

/** The monitor's status read: every row, with the Rex program status. */
function readMonitorStatuses(): ResolvedStatus[] {
  return readAllStatuses(MONITOR_READ_OPTIONS);
}

export function loadProjectRows(): ProjectRow[] {
  return rowsFromStatuses(readMonitorStatuses());
}

/** The rows for one status read: every registered project, then the statuses of unregistered ones, live rows first. */
export function rowsFromStatuses(statuses: ResolvedStatus[]): ProjectRow[] {
  const projects = listProjects();
  const statusMap = new Map<string, ResolvedStatus>();
  for (const s of statuses) {
    statusMap.set(s.project, s);
  }

  const rows: ProjectRow[] = [];
  const seen = new Set<string>();

  for (const [name, directory] of projects) {
    seen.add(name);
    const status = statusMap.get(name);
    rows.push(status ? statusToRow(name, directory, status) : neverLaunchedRow(name, directory));
  }

  for (const status of statuses) {
    if (seen.has(status.project)) continue;
    rows.push(statusToRow(status.project, status.directory, status));
  }

  const stateOrder: Record<ProjectState, number> = { active: 0, "active-long": 1, partial: 2, stopped: 3, unknown: 4 };
  return rows.sort((a, b) => stateOrder[a.state] - stateOrder[b.state]);
}

// --- Status read in a child process (PE-H1) ---

/** The child read failed; `signal` is set when the child was ended by a signal (stopped, never retried in-process). */
export class ChildReadError extends Error {
  constructor(message: string, readonly signal: NodeJS.Signals | null) {
    super(message);
  }
}

/**
 * Run `execPath args` and parse its stdout as the statuses. The child leads its own process group:
 * an abort ends the group, so a `rex` call it is waiting on ends too (records are written atomically
 * under their lock, so an interrupted read is safe). It is unreferenced and never holds Summon open.
 * `env` is laid over this process's environment; a key set to undefined there is removed.
 */
export function readStatusesInChild(execPath: string, args: readonly string[], signal?: AbortSignal, env: NodeJS.ProcessEnv = {}): Promise<ResolvedStatus[]> {
  return new Promise((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    // A key set to undefined in `env` is removed, never inherited from this process.
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete childEnv[key];
    const child = spawn(execPath, args, { detached: true, stdio: ["ignore", "pipe", "ignore"], env: childEnv });
    const stop = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* the group has already exited */ }
    };
    const settle = () => signal?.removeEventListener("abort", stop);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", (error) => { settle(); reject(error); });
    child.once("close", (code, ended) => {
      settle();
      if (code !== 0) { reject(new ChildReadError(`status read ended with ${ended ?? `exit code ${code}`}`, ended)); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as ResolvedStatus[]); } catch (error) { reject(error as Error); }
    });
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.unref();
    (child.stdout as Socket).unref();
  });
}

type RowLoader = (signal: AbortSignal) => ProjectRow[] | Promise<ProjectRow[]>;

/** A Rex status: reading it again may spawn `rex`, so the next read runs in the child. */
function hasRexStatus(statuses: ResolvedStatus[]): boolean {
  return statuses.some((status) => status.backend === "rex");
}

/**
 * In the CLI, with Rex state present, a child process of this same Summon. Otherwise in-process:
 * Ghostty liveness is files and `process.kill`, never a `rex` spawn, so it costs no child per tick
 * (also library use and tests, where no invocation is registered). Before an in-process read the
 * file-only `hasRexState` scan runs, so a new Rex launch moves the very next read to the child; in the
 * child, a read that lists a Rex status skips that scan for the next one. The `rex` binary is resolved
 * once, here, for every child; without one, an inherited value of the variable never reaches the child.
 */
function defaultRowLoader(): RowLoader {
  const self = selfInvocation();
  if (!self) return loadProjectRows;
  let inChild = false;
  const decide = (statuses: ResolvedStatus[]): ProjectRow[] => {
    inChild = hasRexStatus(statuses);
    return rowsFromStatuses(statuses);
  };
  let childEnv: NodeJS.ProcessEnv | undefined;
  return (signal) => {
    if (!inChild && !hasRexState()) return decide(readMonitorStatuses());
    childEnv ??= { [MONITOR_REX_BINARY_ENV]: rexBinaryPath() ?? undefined };
    return readStatusesInChild(self.execPath, [self.script, MONITOR_READ_ARG], signal, childEnv).then(decide);
  };
}

/** "6s", or the uptime format from a minute on. */
function formatAge(ms: number): string {
  return ms < 60_000 ? `${Math.floor(ms / 1000)}s` : formatUptime(ms);
}

// --- Single-shot mode ---

export async function printStatusOnce(): Promise<void> {
  // One-shot output cannot repaint: wait for the live rows' branches instead of printing the placeholder (D3).
  const rows = await withGitBranches(loadProjectRows());
  if (rows.length === 0) {
    console.log("No projects registered. Run `summon add <name> <path>` or `summon setup` to get started.");
    return;
  }

  const activeCount = rows.filter(r => isLiveState(r.state)).length;
  console.log(`Workspace status (${activeCount} active / ${rows.length} total):\n`);

  const width = process.stdout.columns || 80;
  for (const row of rows) {
    console.log(renderRow(row, width, false));
    // A reason the detail column cuts off is printed in full: it often ends with the command to run (F16).
    const detail = rowDetail(row);
    if (detail && getDisplayWidth(detail) > Math.max(0, width - FIXED_COLS)) console.log(`      ${dim(`reason: ${detail}`)}`);
    for (const line of row.notices ?? []) console.log(`      ${dim(`note: ${line}`)}`);
  }
}

// --- TUI Monitor ---

/**
 * The first rows, before the first frame. A read that failed on its own (spawn error, failure exit,
 * bad output) is done once in-process; one ended by a signal is not run again. Ctrl+C or SIGTERM
 * while it runs stop it before Summon exits.
 */
async function firstRows(first: Promise<ProjectRow[]>, abort: AbortController): Promise<ProjectRow[]> {
  const onSignal = (code: number) => () => { abort.abort(); process.exit(code); };
  const onSigint = onSignal(130);
  const onSigterm = onSignal(143);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    return await first;
  } catch (error) {
    if (error instanceof ChildReadError && error.signal) throw error;
    return loadProjectRows();
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

export interface MonitorOptions {
  /** Where the rows come from (tests); a promise is awaited while keys, resize and render keep running. */
  loadRows?: RowLoader;
}

export async function runMonitor(options: MonitorOptions = {}): Promise<void> {
  const loadRows = options.loadRows ?? defaultRowLoader();
  const firstAbort = new AbortController();
  const first = loadRows(firstAbort.signal);
  // An in-process read stays synchronous: the dashboard is entered before runMonitor returns.
  let rows = Array.isArray(first) ? first : await firstRows(first, firstAbort);
  /** The read in flight: ticks and `r` start none until it settles (never two reads at once, PE-H1). */
  let reading: { abort: AbortController; startedAt: number } | null = null;
  let lastUpdated = Date.now();
  let readFailed = false;
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
          `  ${green("●")} ${dim("active")}    ${yellow("●")} ${dim("active* (running >4h)")}`,
          `  ${yellow("●")} ${dim("partial   Rex root pane closed, other panes live")}`,
          `  ${dim("○ stopped   ○ unknown (could not be read; not opened)")}`,
          `  ${dim("color: green = active, yellow = >4h or partial,")}`,
          `  ${dim("dim = stopped or unknown")}`,
          "",
          `  ${bold("Program status (Rex, left of the dot):")}`,
          `  ${programGlyph("blocked")} ${dim("blocked")}   ${programGlyph("error")} ${dim("error")}   ${programGlyph("working")} ${dim("working")}   ${programGlyph("done")} ${dim("done")}   ${dim("blank = idle")}`,
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
      : renderScreen(rows, selectedIndex, getWidth(), getHeight(), { scrollStart, visibilityUnavailable: session.fallback, staleNote: staleNote() });
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

  /** The rows are stale: say so instead of showing old rows silently. */
  function staleNote(): string | undefined {
    if (readFailed) return `last updated ${formatAge(Date.now() - lastUpdated)} ago`;
    if (reading && Date.now() - reading.startedAt >= REFRESH_INTERVAL_MS) return "updating\u2026";
    return undefined;
  }

  function refresh(): void {
    if (!current(session) || session.hidden) return;
    // A read is in flight: no second one; only the staleness note moves.
    if (reading) { if (ui === "dashboard") render(); return; }
    const abort = new AbortController();
    const next = loadRows(abort.signal);
    if (Array.isArray(next)) { applyRows(next); return; }
    const read = { abort, startedAt: Date.now() };
    reading = read;
    if (ui === "dashboard") render(); // after a failed read, its age keeps counting
    void next.then(applyRows, () => {
      // A failed read keeps the rows on screen with their age; the next tick reads again. A stopped one says nothing.
      if (abort.signal.aborted) return;
      readFailed = true;
      if (current(session) && !session.hidden && ui === "dashboard") render();
    }).finally(() => { if (reading === read) reading = null; });
  }

  function applyRows(next: ProjectRow[]): void {
    lastUpdated = Date.now();
    readFailed = false;
    // FE-M1: rows reorder by state, so keep the cursor on the same project; clamp only when it is gone.
    const selectedName = rows[selectedIndex]?.name;
    rows = next;
    const kept = rows.findIndex((row) => row.name === selectedName);
    selectedIndex = kept >= 0 ? kept : Math.min(selectedIndex, Math.max(0, rows.length - 1));
    if (!current(session) || session.hidden) return;
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
    // Quit, signals and the Enter handoff all pass here: the read in flight is stopped, never orphaned.
    reading?.abort.abort();
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
      owner.inputTimer = null;
      // A lone Esc expires into an escape key (FE-M2).
      if (current(owner)) dispatch(owner, owner.decoder.expire(Date.now()));
    }, Math.max(0, deadline - Date.now()));
    dispatch(owner, events);
  }
  function dispatch(owner: Session, events: MonitorInput[]): void {
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
    const visible = !session.hidden;
    cleanup();
    // On the normal screen, after leaving the alternate one, so it stays visible during the handoff (FE-L2).
    if (visible) process.stdout.write(`Opening ${selected.name}...\n`);
    const isActive = isLiveState(selected.state);
    try {
      // Plan P10: an unknown workspace is never launched over or focused; the reason is shown.
      if (selected.state === "unknown") throw new Error(unverifiedMessage(selected.name, selected.reason));
      if (isActive) {
        const { focusWorkspace } = await import("./workspace-focus.js");
        const result = focusWorkspace(selected.name);
        if (result.kind !== "focused") throw new Error(result.reason);
      } else {
        const { launch } = await import("./launcher.js");
        // UX-M4: a new or changed `.summon` is shown and offered for trust here, on the normal screen.
        await withTrustPrompt(() => launch(selected.directory));
      }
      finish();
    } catch (error) {
      ui = "error";
      // UX-M4: n or Enter ("Trust declined.") and Ctrl+C or Esc at the trust prompt are a cancel, not a failure.
      if (error instanceof PromptCancelled) {
        const detail = error.message === "Trust declined." ? "Trust declined. Nothing was trusted." : "Nothing was trusted.";
        errorLines = ["", `  ${bold("Launch cancelled.")}`, `  ${dim(detail)}`, "", `  ${dim("Press any key to continue...")}`];
        enter();
        return;
      }
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
