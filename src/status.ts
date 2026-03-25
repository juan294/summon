import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { STATUS_DIR } from "./config.js";

// --- Types ---

export interface WorkspaceStatus {
  /** Registered project name or directory basename */
  project: string;
  /** Absolute path to project directory */
  directory: string;
  /** PID recorded at launch (informational, not used for liveness) */
  pid: number;
  /** ISO 8601 timestamp of workspace launch */
  startedAt: string;
  /** Layout used (preset name or "custom") */
  layout: string;
  /** Pane names in the workspace */
  panes: string[];
  /** Source of this status entry */
  source: "summon";
  /** Schema version for future compatibility */
  version: 1;
}

export type WorkspaceState = "active" | "stopped" | "unknown";

export interface ResolvedStatus extends WorkspaceStatus {
  /** Derived from marker file check at read time */
  state: WorkspaceState;
  /** Milliseconds since workspace started (if active), null if stopped */
  uptime: number | null;
}

// --- Paths ---

function statusFilePath(projectName: string): string {
  return join(STATUS_DIR, `${projectName}.json`);
}

function markerFilePath(projectName: string): string {
  return join(STATUS_DIR, `${projectName}.active`);
}

// --- Write ---

export function writeStatus(status: WorkspaceStatus): void {
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(statusFilePath(status.project), JSON.stringify(status, null, 2) + "\n", { mode: 0o644 });
  // Create .active marker file — removed by shell trap on exit
  writeFileSync(markerFilePath(status.project), "", { mode: 0o644 });
}

export function clearStatus(projectName: string): void {
  try { unlinkSync(statusFilePath(projectName)); } catch { /* ignore */ }
  try { unlinkSync(markerFilePath(projectName)); } catch { /* ignore */ }
}

// --- Read ---

export function isWorkspaceActive(projectName: string): boolean {
  return existsSync(markerFilePath(projectName));
}

export function readStatus(projectName: string): ResolvedStatus | null {
  const filePath = statusFilePath(projectName);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof data !== "object" || data === null ||
    (data as WorkspaceStatus).version !== 1 ||
    (data as WorkspaceStatus).source !== "summon"
  ) {
    return null;
  }

  const status = data as WorkspaceStatus;
  const active = isWorkspaceActive(projectName);
  const now = Date.now();
  const started = Date.parse(status.startedAt);

  return {
    ...status,
    state: active ? "active" : "stopped",
    uptime: active && !isNaN(started) ? now - started : null,
  };
}

export function readAllStatuses(): ResolvedStatus[] {
  if (!existsSync(STATUS_DIR)) return [];

  const files = readdirSync(STATUS_DIR).filter(f => f.endsWith(".json"));
  const statuses: ResolvedStatus[] = [];

  for (const file of files) {
    const projectName = file.replace(/\.json$/, "");
    const status = readStatus(projectName);
    if (status) statuses.push(status);
  }

  // Sort: active first (newest first), then stopped (newest first)
  return statuses.sort((a, b) => {
    if (a.state === "active" && b.state !== "active") return -1;
    if (a.state !== "active" && b.state === "active") return 1;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });
}

// --- Git ---

export function getGitBranch(directory: string): string | null {
  try {
    const result = execFileSync("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

export function cleanStaleStatuses(): number {
  const statuses = readAllStatuses();
  let removed = 0;

  for (const status of statuses) {
    if (status.state === "stopped") {
      clearStatus(status.project);
      removed++;
    }
  }

  return removed;
}
