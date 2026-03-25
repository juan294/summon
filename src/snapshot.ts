import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { SNAPSHOTS_DIR } from "./config.js";

// --- Types ---

export interface ContextSnapshot {
  project: string;
  directory: string;
  timestamp: string; // ISO 8601
  layout: string;
  git: {
    branch: string;
    dirty: string[];
    recentCommits: string[];
  };
  version: 1;
}

// --- Helpers ---

function snapshotPath(project: string): string {
  return join(SNAPSHOTS_DIR, `${project}.json`);
}

function gitCommand(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// --- Public API ---

export function saveSnapshot(project: string, directory: string, layout: string): ContextSnapshot | null {
  const branch = gitCommand(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return null;

  const statusOutput = gitCommand(directory, ["status", "--porcelain"]);
  const dirty = statusOutput
    ? statusOutput.split("\n").filter(Boolean).map(line => line.slice(3))
    : [];

  const logOutput = gitCommand(directory, ["log", "--oneline", "-3"]);
  const recentCommits = logOutput
    ? logOutput.split("\n").filter(Boolean)
    : [];

  const snapshot: ContextSnapshot = {
    project,
    directory,
    timestamp: new Date().toISOString(),
    layout,
    git: { branch, dirty, recentCommits },
    version: 1,
  };

  mkdirSync(SNAPSHOTS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(snapshotPath(project), JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  return snapshot;
}

export function readSnapshot(project: string): ContextSnapshot | null {
  const filePath = snapshotPath(project);
  if (!existsSync(filePath)) return null;

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
    (data as ContextSnapshot).version !== 1
  ) {
    return null;
  }

  return data as ContextSnapshot;
}

export function clearSnapshot(project: string): boolean {
  const filePath = snapshotPath(project);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function formatTimeSince(isoTimestamp: string): string {
  const then = Date.parse(isoTimestamp);
  if (isNaN(then)) return "unknown";

  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  return `${days} days ago`;
}

export function formatRestorationBanner(snapshot: ContextSnapshot): string {
  const useColor = !!(process.stdout.isTTY && !process.env.NO_COLOR);
  const dim = (s: string) => useColor ? `\x1b[2m${s}\x1b[0m` : s;
  const green = (s: string) => useColor ? `\x1b[32m${s}\x1b[0m` : s;

  const timeSince = formatTimeSince(snapshot.timestamp);
  const shortDate = new Date(snapshot.timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const lines: string[] = [];
  lines.push(`  ${dim("Welcome back to")} ${green(snapshot.project)}`);
  lines.push(`  ${dim("Last session:")} ${green(timeSince)} ${dim(`(${shortDate})`)}`);
  lines.push(`  ${dim("Branch:")} ${green(snapshot.git.branch)}`);

  if (snapshot.git.dirty.length > 0) {
    const MAX_SHOWN = 3;
    const shown = snapshot.git.dirty.slice(0, MAX_SHOWN);
    const extra = snapshot.git.dirty.length - MAX_SHOWN;
    const fileList = shown.join(", ") + (extra > 0 ? ` + ${extra} more` : "");
    lines.push(`  ${dim("Modified:")} ${green(fileList)}`);
  }

  if (snapshot.git.recentCommits.length >= 2) {
    // Show first two commits as "commit1 -> commit2"
    const [first, second] = snapshot.git.recentCommits;
    lines.push(`  ${dim("Recent:")} ${green(`${first} -> ${second}`)}`);
  } else if (snapshot.git.recentCommits.length === 1) {
    lines.push(`  ${dim("Recent:")} ${green(snapshot.git.recentCommits[0]!)}`);
  }

  return lines.join("\n");
}
