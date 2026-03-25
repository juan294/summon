import { readAllStatuses, getGitBranch } from "./status.js";
import type { ResolvedStatus } from "./status.js";
import { listProjects } from "./config.js";
import { bold, dim, green, yellow } from "./setup.js";

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

// Terminal control sequences
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[H\x1b[2J";
const INVERT = "\x1b[7m";
const RESET = "\x1b[0m";

// --- Formatting (pure functions, testable) ---

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
  const name = row.name.length > NAME_WIDTH ? row.name.slice(0, NAME_WIDTH - 1) + "\u2026" : row.name.padEnd(NAME_WIDTH);
  const stateText = row.state === "active-long" ? "active" : row.state;
  const stateLabel = colorFn(stateText);
  // Pad the visible text, not the ANSI-wrapped version
  const statePad = " ".repeat(Math.max(0, STATE_WIDTH - stateText.length));
  const uptime = row.uptime.padEnd(UPTIME_WIDTH);

  const branchWidth = Math.max(0, width - FIXED_COLS);
  const branch = row.gitBranch.length > branchWidth
    ? row.gitBranch.slice(0, Math.max(0, branchWidth - 1)) + "\u2026"
    : row.gitBranch;

  const line = `  ${dot} ${name}  ${stateLabel}${statePad}  ${uptime}  ${branch}`;

  if (selected) {
    return `${INVERT}${line}${RESET}`;
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
  const keys = "  \u2191\u2193 navigate  \u23CE open  r refresh  q quit";
  const padded = keys.length < width ? keys + " ".repeat(width - keys.length) : keys.slice(0, width);
  return dim(padded);
}

export function renderScreen(rows: ProjectRow[], selectedIndex: number, width: number, height: number): string {
  const activeCount = rows.filter(r => r.state === "active" || r.state === "active-long").length;
  const header = renderHeader(activeCount, rows.length, width);
  const separator = dim("\u2500".repeat(width));
  const footer = renderFooter(width);

  // Available rows: height minus header, 2 separators, footer
  const availableRows = Math.max(1, height - 4);

  // Compute scroll window
  let scrollStart = 0;
  if (rows.length > availableRows) {
    // Keep selected row visible with some context
    if (selectedIndex >= scrollStart + availableRows) {
      scrollStart = selectedIndex - availableRows + 1;
    }
    if (selectedIndex < scrollStart) {
      scrollStart = selectedIndex;
    }
  }

  const visibleRows = rows.slice(scrollStart, scrollStart + availableRows);
  const renderedRows = visibleRows.map((row, i) =>
    renderRow(row, width, scrollStart + i === selectedIndex),
  );

  // Pad with empty lines if fewer rows than available space
  while (renderedRows.length < availableRows) {
    renderedRows.push("");
  }

  const lines = [header, separator, ...renderedRows, separator, footer];
  return lines.join("\n");
}

// --- Git Branch Cache ---

const gitBranchCache = new Map<string, { value: string; timestamp: number }>();
const GIT_CACHE_TTL_MS = 10_000; // 10 seconds

function getCachedGitBranch(directory: string): string | null {
  const cached = gitBranchCache.get(directory);
  if (cached && Date.now() - cached.timestamp < GIT_CACHE_TTL_MS) {
    return cached.value;
  }
  const branch = getGitBranch(directory);
  if (branch) {
    gitBranchCache.set(directory, { value: branch, timestamp: Date.now() });
  } else {
    gitBranchCache.delete(directory);
  }
  return branch;
}

export function resetGitBranchCache(): void {
  gitBranchCache.clear();
}

// --- Data Loading ---

function classifyState(status: ResolvedStatus): ProjectState {
  if (status.state !== "active") return "stopped";
  if (status.uptime !== null && status.uptime > LONG_RUNNING_MS) return "active-long";
  return "active";
}

function statusToRow(name: string, directory: string, status: ResolvedStatus): ProjectRow {
  const state = classifyState(status);
  return {
    name,
    directory,
    state,
    uptime: status.uptime !== null ? formatUptime(status.uptime) : "\u2014",
    gitBranch: status.state === "active" ? (getCachedGitBranch(directory) ?? "\u2014") : "\u2014",
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
    console.log("No workspace sessions recorded yet.");
    console.log("Launch a workspace with 'summon <project>' to start tracking.");
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
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const getWidth = () => process.stdout.columns || 80;
  const getHeight = () => process.stdout.rows || 24;

  function render(): void {
    const screen = renderScreen(rows, selectedIndex, getWidth(), getHeight());
    process.stdout.write(CLEAR_SCREEN + screen);
  }

  function refresh(): void {
    rows = loadProjectRows();
    // Clamp selection to valid range
    if (selectedIndex >= rows.length) {
      selectedIndex = Math.max(0, rows.length - 1);
    }
    render();
  }

  const onResize = () => render();
  // Declared here so cleanup() can reference it; assigned inside the promise
  let onKeypress: (data: Buffer) => void;

  function cleanup(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    if (onKeypress) process.stdin.off("data", onKeypress);
    process.off("SIGWINCH", onResize);
  }

  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  render();

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

      // Enter → open selected project
      if (key === "\r" || key === "\n") {
        if (rows.length > 0) {
          const selected = rows[selectedIndex];
          if (selected) {
            cleanup();
            console.log(`Opening ${selected.name}...`);
            resolve();
            import("./launcher.js").then(({ launch }) => {
              launch(selected.directory).catch(() => {
                process.exit(1);
              });
            });
          }
        }
        return;
      }
    }

    process.stdin.on("data", onKeypress);
  });
}
