import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { STATUS_DIR } from "./config.js";
import { gitSafeEnv } from "./utils.js";

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

function statusArtifactPath(projectName: string, extension: "json" | "active" | "pid"): string {
  const filePath = join(STATUS_DIR, `${projectName}.${extension}`);
  if (!resolve(filePath).startsWith(resolve(STATUS_DIR) + sep)) {
    throw new Error(`Invalid status path: "${projectName}"`);
  }
  return filePath;
}

function statusFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "json");
}

function markerFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "active");
}

function pidFilePath(projectName: string): string {
  return statusArtifactPath(projectName, "pid");
}

// --- Write ---

/**
 * Write workspace status JSON. Liveness artifacts (.active marker, .pid sidecar)
 * are created by the root shell bootstrap after the pid is durable — see
 * emitRootPanePidBootstrap in src/script.ts. Node never writes the marker; this
 * eliminates a launch-window race where a concurrent reader would observe
 * marker-without-pid and GC both artifacts. (2026-04-19 audit #2.)
 */
export function writeStatus(status: WorkspaceStatus): void {
  mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(statusFilePath(status.project), JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
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


/**
 * Validates the raw JSON parsed from a status file. Returns a typed WorkspaceStatus
 * if all required fields have the correct types, or null if the shape is invalid.
 */
export function parseWorkspaceStatus(raw: unknown): WorkspaceStatus | null {
  if (typeof raw !== "object" || raw === null) return null;

  const d = raw as Record<string, unknown>;

  if (d["version"] !== 1) return null;
  if (d["source"] !== "summon") return null;
  if (typeof d["project"] !== "string") return null;
  if (typeof d["directory"] !== "string") return null;
  if (typeof d["pid"] !== "number") return null;
  if (typeof d["startedAt"] !== "string") return null;
  if (typeof d["layout"] !== "string") return null;
  if (!Array.isArray(d["panes"])) return null;

  return raw as WorkspaceStatus;
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

  const status = parseWorkspaceStatus(data);
  if (!status) return null;

  const markerExists = existsSync(markerFilePath(projectName));
  const shellPid = readShellPid(projectName);
  const active = markerExists && shellPid !== null && isPidAlive(shellPid);

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
      env: gitSafeEnv(),
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
