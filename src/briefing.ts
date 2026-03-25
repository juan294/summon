import { execFileSync } from "node:child_process";
import { listProjects } from "./config.js";
import { readAllStatuses, getGitBranch } from "./status.js";
import type { ResolvedStatus } from "./status.js";
import { bold, dim, green, yellow, cyan } from "./setup.js";

// --- Types ---

export interface CommitSummary {
  hash: string;
  subject: string;
  author: string;
  isAgent: boolean;
}

export interface ProjectBriefing {
  name: string;
  directory: string;
  state: "active" | "stopped" | "unknown";
  uptime: number | null;
  gitBranch: string | null;
  overnightCommits: CommitSummary[];
  dirtyFiles: string[];
  lastSession: string | null;
}

export interface BriefingSummary {
  totalProjects: number;
  activeCount: number;
  totalOvernightCommits: number;
  recommendation: string | null;
}

// --- Agent commit detection heuristic ---

const AGENT_AUTHOR_RE = /claude|copilot|agent|bot/i;
const AGENT_MESSAGE_RE = /co-authored-by:.*(claude|copilot|agent)/i;

export function isAgentCommit(author: string, message: string): boolean {
  return AGENT_AUTHOR_RE.test(author) || AGENT_MESSAGE_RE.test(message);
}

// --- Git data collection ---

export function collectGitData(directory: string): { branch: string | null; commits: CommitSummary[]; dirty: string[] } {
  const branch = getGitBranch(directory);

  let commits: CommitSummary[] = [];
  try {
    const raw = execFileSync("git", ["-C", directory, "log", "--format=%H|%s|%an", "--since=yesterday 00:00"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (raw) {
      commits = raw.split("\n").map(line => {
        const [hash = "", subject = "", author = ""] = line.split("|");
        return { hash, subject, author, isAgent: isAgentCommit(author, subject) };
      });
    }
  } catch {
    /* not a git repo or git error */
  }

  let dirty: string[] = [];
  try {
    const raw = execFileSync("git", ["-C", directory, "status", "--porcelain"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (raw) dirty = raw.split("\n").map(l => l.slice(3).trim());
  } catch {
    /* ignore */
  }

  return { branch, commits, dirty };
}

// --- Prioritization ---

export function generateRecommendation(projects: ProjectBriefing[]): string | null {
  // Priority order:
  // 1. Active + dirty + long uptime (>8h) = stale
  const stale = projects.find(
    p => p.state === "active" && p.dirtyFiles.length > 0 && p.uptime !== null && p.uptime > 8 * 3600000,
  );
  if (stale) return `${stale.name} (long-running, uncommitted changes)`;

  // 2. Project with overnight agent commits
  const agentWork = projects.find(p => p.overnightCommits.some(c => c.isAgent));
  if (agentWork) return `${agentWork.name} (agent commits to review)`;

  // 3. Project with uncommitted changes
  const dirty = projects.find(p => p.dirtyFiles.length > 0);
  if (dirty) return `${dirty.name} (uncommitted changes)`;

  return null;
}

// --- Collect all briefing data ---

export function collectBriefingData(): { projects: ProjectBriefing[]; summary: BriefingSummary } {
  const registeredProjects = listProjects();
  const statuses = readAllStatuses();
  const statusMap = new Map<string, ResolvedStatus>();
  for (const s of statuses) statusMap.set(s.project, s);

  const projects: ProjectBriefing[] = [];
  for (const [name, directory] of registeredProjects) {
    const status = statusMap.get(name);
    const gitData = collectGitData(directory);
    projects.push({
      name,
      directory,
      state: status?.state ?? "unknown",
      uptime: status?.uptime ?? null,
      gitBranch: gitData.branch,
      overnightCommits: gitData.commits,
      dirtyFiles: gitData.dirty,
      lastSession: null, // Phase 5 integration point
    });
  }

  const activeCount = projects.filter(p => p.state === "active").length;
  const totalOvernightCommits = projects.reduce((sum, p) => sum + p.overnightCommits.length, 0);

  return {
    projects,
    summary: {
      totalProjects: projects.length,
      activeCount,
      totalOvernightCommits,
      recommendation: generateRecommendation(projects),
    },
  };
}

// --- Formatting (pure functions) ---

export function formatProjectBriefing(project: ProjectBriefing): string {
  const lines: string[] = [];
  const dot = project.state === "active" ? green("\u25CF") : dim("\u25CB");
  const stateLabel = project.state === "active" ? green("active") : dim(project.state);

  lines.push(`  ${dot} ${bold(project.name)}${" ".repeat(Math.max(1, 40 - project.name.length))}${stateLabel}`);

  if (project.gitBranch) {
    lines.push(`  \u251C\u2500 Branch: ${cyan(project.gitBranch)}`);
  }

  if (project.overnightCommits.length > 0) {
    const count = project.overnightCommits.length;
    lines.push(`  \u251C\u2500 ${count} commit${count !== 1 ? "s" : ""} since yesterday`);
    const shown = project.overnightCommits.slice(0, 5);
    for (const c of shown) {
      const tag = c.isAgent ? dim(" (agent)") : dim(" (you)");
      lines.push(`  \u2502   \u2022 ${c.subject}${tag}`);
    }
    if (count > 5) lines.push(`  \u2502   ${dim(`+ ${count - 5} more`)}`);
  } else {
    lines.push(`  \u251C\u2500 No new commits`);
  }

  if (project.dirtyFiles.length > 0) {
    const count = project.dirtyFiles.length;
    lines.push(`  \u251C\u2500 ${yellow(`${count} modified file${count !== 1 ? "s" : ""} (uncommitted)`)}`);
  } else {
    lines.push(`  \u251C\u2500 Clean working tree`);
  }

  // Uptime warning for long-running workspaces
  if (project.state === "active" && project.uptime !== null && project.uptime > 8 * 3600000) {
    const hours = Math.floor(project.uptime / 3600000);
    lines.push(`  \u2514\u2500 Workspace running for ${yellow(`${hours}h`)}`);
  } else if (project.lastSession) {
    lines.push(`  \u2514\u2500 Last session: ${dim(project.lastSession)}`);
  } else {
    // Replace last ├─ with └─ for clean tree ending
    const lastIdx = lines.length - 1;
    const lastLine = lines[lastIdx];
    if (lastLine) lines[lastIdx] = lastLine.replace("\u251C\u2500", "\u2514\u2500");
  }

  return lines.join("\n");
}

export function formatBriefingHeader(): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const title = `summon briefing \u2014 ${date}`;
  const border = "\u2550".repeat(title.length + 4);
  return `  \u2554${border}\u2557\n  \u2551  ${bold(title)}  \u2551\n  \u255A${border}\u255D`;
}

export function formatBriefingSummary(summary: BriefingSummary): string {
  const lines: string[] = [];
  const sep = dim("\u2500".repeat(48));
  lines.push(`  ${sep}`);
  lines.push(`  ${summary.totalProjects} projects \u00B7 ${summary.activeCount} active \u00B7 ${summary.totalOvernightCommits} overnight commits`);
  if (summary.recommendation) {
    lines.push(`\n  Start with: ${bold(summary.recommendation)}`);
  }
  return lines.join("\n");
}

export function formatFullBriefing(projects: ProjectBriefing[], summary: BriefingSummary): string {
  const parts = [formatBriefingHeader(), ""];
  for (const p of projects) {
    parts.push(formatProjectBriefing(p));
    parts.push("");
  }
  parts.push(formatBriefingSummary(summary));
  return parts.join("\n");
}

// --- Entry point ---

export function runBriefing(): void {
  const { projects, summary } = collectBriefingData();
  if (projects.length === 0) {
    console.log("No projects registered. Use 'summon add <name> <path>' to register projects.");
    return;
  }
  console.log(formatFullBriefing(projects, summary));
}
