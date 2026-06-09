import { readAllStatuses, getGitBranch } from "./status.js";
import type { ResolvedStatus } from "./status.js";
import { listProjects } from "./config.js";
import { bold, dim, green, red, yellow, cyan, invert } from "./ui/ansi.js";

// --- Types ---

export type ProjectState = "active" | "active-long" | "stopped" | "unknown";

export interface ProjectRow {
  name: string;
  directory: string;
  state: ProjectState;
  uptime: string;
  gitBranch: string;
}

// --- Constants ---

const LONG_RUNNING_MS = 4 * 60 * 60 * 1000; // 4 hours
const REFRESH_INTERVAL_MS = 3000;
const NAME_WIDTH = 16;
const STATE_WIDTH = 8;
const UPTIME_WIDTH = 8;
const FIXED_COLS = 2 + NAME_WIDTH + 2 + STATE_WIDTH + 2 + UPTIME_WIDTH + 2; // dot + spaces + padding
const MIN_COLS = 60; // minimum terminal width floor to prevent wrapping on narrow terminals

// Terminal control sequences
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[H\x1b[2J";
const CURSOR_HOME = "\x1b[H";

// --- Formatting (pure functions, testable) ---

/**
 * Truncates a string to maxLen characters, appending an ellipsis if truncated.
 * The returned string is always <= maxLen characters.
 */
export function truncate(str: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

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
    case "active-long": return yellow;
    case "stopped":
    case "unknown": return dim;
  }
}

export function stateDot(state: ProjectState): string {
  switch (state) {
    case "active":
    case "active-long": return "\u25CF"; // ●
    case "stopped":
    case "unknown": return "\u25CB"; // ○
  }
}

export function renderRow(row: ProjectRow, width: number, selected: boolean): string {
  const colorFn = stateColor(row.state);
  const dot = colorFn(stateDot(row.state));
  const name = truncate(row.name, NAME_WIDTH).padEnd(NAME_WIDTH);
  const stateText = row.state === "active-long" ? "active" : row.state;
  const stateLabel = colorFn(stateText);
  // Pad the visible text, not the ANSI-wrapped version
  const statePad = " ".repeat(Math.max(0, STATE_WIDTH - stateText.length));
  const uptime = row.uptime.padEnd(UPTIME_WIDTH);

  const branchWidth = Math.max(0, width - FIXED_COLS);
  // For stopped/unknown workspaces, show the directory path (dimmed) instead of em dash
  const isStopped = row.state === "stopped" || row.state === "unknown";
  const rawBranchText = isStopped ? row.directory : row.gitBranch;
  const branchText = truncate(rawBranchText, branchWidth);
  const branch = isStopped ? dim(branchText) : branchText;

  const line = `  ${dot} ${name}  ${stateLabel}${statePad}  ${uptime}  ${branch}`;

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

export function renderFooter(width: number): string {
  const keys = "  \u2191\u2193/jk navigate  \u23CE open  r refresh  ? help  q quit";
  const padded = keys.length < width ? keys + " ".repeat(width - keys.length) : keys.slice(0, width);
  return dim(padded);
}

export function renderScreen(rows: ProjectRow[], selectedIndex: number, width: number, height: number, scrollStart = 0): string {
  const activeCount = rows.filter(r => r.state === "active" || r.state === "active-long").length;
  const header = renderHeader(activeCount, rows.length, width);
  const separator = dim("\u2500".repeat(width));
  const footer = renderFooter(width);

  // Available rows: height minus header, 2 separators, footer
  const availableRows = Math.max(1, height - 4);

  const visibleRows = rows.slice(scrollStart, scrollStart + availableRows);
  let renderedRows: string[];
  if (rows.length === 0) {
    renderedRows = [
      "  No projects found.",
      "  Run `summon add <name> <path>` to get started.",
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

  const lines = [header, separator, ...renderedRows, separator, footer];
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
      (r.state === "active" || r.state === "active-long") &&
      !getCachedGitBranch(r.directory) &&
      !gitBranchFetching.has(r.directory),
  );

  if (toFetch.length === 0) return;

  toFetch.forEach((r) => gitBranchFetching.add(r.directory));

  await Promise.all(
    toFetch.map(async (r) => {
      // Wrap in a resolved promise to yield the event loop before the blocking git call
      await Promise.resolve();
      const branch = getGitBranch(r.directory);
      if (branch) {
        gitBranchCache.set(r.directory, { value: branch, timestamp: Date.now() });
      } else {
        gitBranchCache.delete(r.directory);
      }
      gitBranchFetching.delete(r.directory);
    }),
  );

  onUpdate();
}

export function resetGitBranchCache(): void {
  gitBranchCache.clear();
  gitBranchFetching.clear();
}

// --- Data Loading ---

function classifyState(status: ResolvedStatus): ProjectState {
  if (status.state !== "active") return "stopped";
  if (status.uptime !== null && status.uptime > LONG_RUNNING_MS) return "active-long";
  return "active";
}

function statusToRow(name: string, directory: string, status: ResolvedStatus): ProjectRow {
  const state = classifyState(status);
  const isActive = status.state === "active";
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
  };
}

export function loadProjectRows(): ProjectRow[] {
  const projects = listProjects();
  const statuses = readAllStatuses();
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

  const stateOrder: Record<ProjectState, number> = { active: 0, "active-long": 1, stopped: 2, unknown: 3 };
  return rows.sort((a, b) => stateOrder[a.state] - stateOrder[b.state]);
}

// --- Single-shot mode ---

export function printStatusOnce(): void {
  const rows = loadProjectRows();
  if (rows.length === 0) {
    console.log("No workspaces found.");
    console.log("Run `summon <project>` to launch a workspace.");
    return;
  }

  const activeCount = rows.filter(r => r.state === "active" || r.state === "active-long").length;
  console.log(`Workspace status (${activeCount} active / ${rows.length} total):\n`);

  const width = process.stdout.columns || 80;
  for (const row of rows) {
    console.log(renderRow(row, width, false));
  }
}

// --- TUI Monitor ---

export async function runMonitor(): Promise<void> {
  let rows = loadProjectRows();
  let selectedIndex = 0;
  let scrollStart = 0;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const getWidth = () => Math.max(MIN_COLS, process.stdout.columns || 80);
  const getHeight = () => process.stdout.rows || 24;

  function updateScroll(): void {
    const availableRows = Math.max(1, getHeight() - 4);
    if (selectedIndex >= scrollStart + availableRows) {
      scrollStart = selectedIndex - availableRows + 1;
    } else if (selectedIndex < scrollStart) {
      scrollStart = selectedIndex;
    }
  }

  function render(fullClear = false): void {
    updateScroll();
    const screen = renderScreen(rows, selectedIndex, getWidth(), getHeight(), scrollStart);
    const prefix = fullClear ? CLEAR_SCREEN : CURSOR_HOME;
    process.stdout.write(prefix + screen);
  }

  function refresh(): void {
    rows = loadProjectRows();
    // Clamp selection to valid range
    if (selectedIndex >= rows.length) {
      selectedIndex = Math.max(0, rows.length - 1);
    }
    render(false);
    // Kick off async git branch fetches without blocking the render loop
    void prefetchGitBranches(rows, () => {
      rows = loadProjectRows();
      if (selectedIndex >= rows.length) {
        selectedIndex = Math.max(0, rows.length - 1);
      }
      render(false);
    });
  }

  const onResize = () => render(true);
  // Declared here so cleanup() can reference it; assigned inside the promise
  let onKeypress: (data: Buffer) => void;

  const onUncaughtException = (err: Error): void => {
    cleanup();
    process.stderr.write(err.stack ?? err.message);
    process.exit(1);
  };

  function cleanup(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    if (onKeypress) process.stdin.off("data", onKeypress);
    process.off("SIGWINCH", onResize);
    process.off("exit", cleanup);
    process.off("uncaughtException", onUncaughtException);
  }

  // Register cleanup BEFORE entering alt-screen/raw mode so signals always restore terminal
  process.once("exit", cleanup);
  process.once("uncaughtException", onUncaughtException);

  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  render(true);
  // Initial async branch fetch so the "…" placeholders are filled quickly
  void prefetchGitBranches(rows, () => {
    rows = loadProjectRows();
    if (selectedIndex >= rows.length) {
      selectedIndex = Math.max(0, rows.length - 1);
    }
    render(false);
  });

  refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  process.on("SIGWINCH", onResize);

  return new Promise<void>((resolve) => {
    onKeypress = function (data: Buffer): void {
      const key = data.toString();

      // q or Ctrl+C → quit
      if (key === "q" || key === "\x03") {
        cleanup();
        resolve();
        return;
      }

      // Arrow up or k → move up
      if (key === "\x1b[A" || key === "k") {
        if (selectedIndex > 0) {
          selectedIndex--;
          render();
        }
        return;
      }

      // Arrow down or j → move down
      if (key === "\x1b[B" || key === "j") {
        if (selectedIndex < rows.length - 1) {
          selectedIndex++;
          render();
        }
        return;
      }

      // r → force refresh
      if (key === "r") {
        refresh();
        return;
      }

      // ? → show help overlay
      if (key === "?") {
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
          `  ${bold("Colors:")}`,
          `  ${dim("yellow = active  dim = stopped")}`,
          "",
          `  ${dim("Press any key to dismiss...")}`,
        ];
        process.stdout.write(CLEAR_SCREEN + helpLines.join("\n"));

        // Wait for any key to dismiss
        const dismissHelp = (dismissData: Buffer): void => {
          void dismissData;
          process.stdin.off("data", dismissHelp);
          render();
        };
        process.stdin.once("data", dismissHelp);
        return;
      }

      // Enter → open selected project
      if (key === "\r" || key === "\n") {
        if (rows.length > 0) {
          const selected = rows[selectedIndex];
          if (selected) {
            // Print feedback BEFORE exiting alt-screen so user sees "Opening..." immediately
            process.stdout.write(`Opening ${selected.name}...\n`);
            cleanup();
            import("./launcher.js").then(async ({ launch }) => {
              let launchError: Error | null = null;
              await launch(selected.directory).catch((err: Error) => {
                launchError = err;
              });
              if (launchError !== null) {
                // Re-enter TUI and show the error in-place so the user can continue
                process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);
                if (process.stdin.isTTY) {
                  process.stdin.setRawMode(true);
                }
                process.stdin.resume();
                const errDisplay = [
                  "",
                  `  ${bold("Launch failed:")}`,
                  `  ${red((launchError as Error).message)}`,
                  "",
                  `  ${dim("Press any key to continue...")}`,
                ];
                process.stdout.write(CLEAR_SCREEN + errDisplay.join("\n"));
                // Wait for any key, then resume the TUI
                const dismissError = (_dismissData: Buffer): void => {
                  process.stdin.off("data", dismissError);
                  render(true);
                  refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
                  process.stdin.on("data", onKeypress);
                };
                process.stdin.once("data", dismissError);
              } else {
                resolve();
              }
            });
          }
        }
        return;
      }
    };

    process.stdin.on("data", onKeypress);
  });
}
