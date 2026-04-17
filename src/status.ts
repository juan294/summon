import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { STATUS_DIR } from "./config.js";

// --- Types ---

export interface WorkspaceStatus {
  /** Registered project name or directory basename */
  project: string;
  /** Absolute path to project directory */
  directory: string;
  /** PID recorded at launch (informational; root-shell PID sidecar drives liveness) */
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
  const filePath = join(STATUS_DIR, `${projectName}.json`);
  if (!resolve(filePath).startsWith(resolve(STATUS_DIR))) {
    throw new Error(`Invalid status path: "${projectName}"`);
  }
  return filePath;
}

function markerFilePath(projectName: string): string {
  const filePath = join(STATUS_DIR, `${projectName}.active`);
  if (!resolve(filePath).startsWith(resolve(STATUS_DIR))) {
    throw new Error(`Invalid status path: "${projectName}"`);
  }
  return filePath;
}

function pidFilePath(projectName: string): string {
  const filePath = join(STATUS_DIR, `${projectName}.pid`);
  if (!resolve(filePath).startsWith(resolve(STATUS_DIR))) {
    throw new Error(`Invalid status path: "${projectName}"`);
  }
  return filePath;
}

// --- Write ---

export function writeStatus(status: WorkspaceStatus): void {
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(statusFilePath(status.project), JSON.stringify(status, null, 2) + "\n", { mode: 0o644 });
  // Create .active marker file — removed by shell trap on exit
  writeFileSync(markerFilePath(status.project), "", { mode: 0o644 });
}

export function clearStatus(projectName: string): void {
  const statusPath = statusFilePath(projectName);
  const markerPath = markerFilePath(projectName);
  const pidPath = pidFilePath(projectName);
  try { unlinkSync(statusPath); } catch { /* ignore */ }
  try { unlinkSync(markerPath); } catch { /* ignore */ }
  try { unlinkSync(pidPath); } catch { /* ignore */ }
}

// --- Read ---

export function isWorkspaceActive(projectName: string): boolean {
  return readStatus(projectName)?.state === "active";
}

function readShellPid(projectName: string): number | null {
  try {
    const raw = readFileSync(pidFilePath(projectName), "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function clearStatusArtifacts(projectName: string): void {
  try { unlinkSync(markerFilePath(projectName)); } catch { /* ignore */ }
  try { unlinkSync(pidFilePath(projectName)); } catch { /* ignore */ }
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
  const markerExists = existsSync(markerFilePath(projectName));
  const shellPid = readShellPid(projectName);
  const active = markerExists && shellPid !== null && isPidAlive(shellPid);

  if (markerExists && !active) {
    clearStatusArtifacts(projectName);
  }

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
  if (!existsSync(STATUS_DIR)) return 0;

  const projects = readdirSync(STATUS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));

  let removed = 0;

  for (const project of projects) {
    const status = readStatus(project);
    if (!status) continue;
    if (status.state === "stopped") {
      clearStatus(status.project);
      removed++;
    }
  }

  return removed;
}
