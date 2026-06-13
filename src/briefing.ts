import { listProjects } from "./config.js";
import { readAllStatuses, getGitBranch } from "./status.js";
import type { ResolvedStatus } from "./status.js";
import { bold, dim, green, yellow, cyan } from "./ui/ansi.js";
import { sym } from "./ui/symbols.js";
import { gitOutput, runPool, ioConcurrency } from "./utils.js";

// Computed once at module load (this module is lazy-loaded, off the cold-start path).
const IO_CONCURRENCY = ioConcurrency();

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
  allClean: boolean;
}

// --- Agent commit detection heuristic ---

const AGENT_AUTHOR_RE = /claude|copilot|agent|bot/i;
const AGENT_MESSAGE_RE = /co-authored-by:.*(claude|copilot|agent)/i;

export function isAgentCommit(author: string, message: string): boolean {
  return AGENT_AUTHOR_RE.test(author) || AGENT_MESSAGE_RE.test(message);
}

// --- Git data collection ---

type GitData = { branch: string | null; commits: CommitSummary[]; dirty: string[] };
type GitCacheEntry = { data: GitData; timestamp: number };

const MAX_CACHE_AGE_MS = 10 * 60 * 1000; // 10 minutes

const gitDataCache = new Map<string, GitCacheEntry>();

export function resetGitDataCache(): void {
  gitDataCache.clear();
}

/**
 * Run `git -C <dir> <args>` and return trimmed stdout split into lines (empty on any error).
 * AR-M1 #603: delegates to shared gitOutput helper in utils.ts.
 */
async function gitLines(directory: string, args: string[]): Promise<string[]> {
  try {
    const raw = await gitOutput(directory, args);
    return raw ? raw.split("\n") : [];
  } catch {
    return [];
  }
}

async function gitLog(directory: string): Promise<CommitSummary[]> {
  const lines = await gitLines(directory, ["log", "--format=%H|%s|%an", "--since=yesterday 00:00"]);
  return lines.map(line => {
    const [hash = "", subject = "", author = ""] = line.split("|");
    return { hash, subject, author, isAgent: isAgentCommit(author, subject) };
  });
}

async function gitStatus(directory: string): Promise<string[]> {
  const lines = await gitLines(directory, ["status", "--porcelain"]);
  return lines.map(l => l.slice(3).trim());
}

export async function collectGitData(directory: string): Promise<GitData> {
  const cached = gitDataCache.get(directory);
  if (cached && Date.now() - cached.timestamp <= MAX_CACHE_AGE_MS) return cached.data;

  const [branch, commits, dirty] = await Promise.all([
    getGitBranch(directory),
    gitLog(directory),
    gitStatus(directory),
  ]);

  const result: GitData = { branch, commits, dirty };
  gitDataCache.set(directory, { data: result, timestamp: Date.now() });
  return result;
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

export async function collectBriefingData(): Promise<{ projects: ProjectBriefing[]; summary: BriefingSummary }> {
  const registeredProjects = listProjects();
  const statuses = readAllStatuses();
  const statusMap = new Map<string, ResolvedStatus>();
  for (const s of statuses) statusMap.set(s.project, s);

  const sortedProjects = [...registeredProjects].sort(([a], [b]) => a.localeCompare(b));
  const projects = await runPool(sortedProjects, IO_CONCURRENCY, async ([name, directory]) => {
    const status = statusMap.get(name);
    const gitData = await collectGitData(directory);
    return {
      name,
      directory,
      state: status?.state ?? "unknown",
      uptime: status?.uptime ?? null,
      gitBranch: gitData.branch,
      overnightCommits: gitData.commits,
      dirtyFiles: gitData.dirty,
      lastSession: null, // Phase 5 integration point
    } satisfies ProjectBriefing;
  });

  const activeCount = projects.filter(p => p.state === "active").length;
  const totalOvernightCommits = projects.reduce((sum, p) => sum + p.overnightCommits.length, 0);
  const allClean = projects.length > 0 && projects.every(
    p => p.dirtyFiles.length === 0 && p.overnightCommits.length === 0,
  );

  return {
    projects,
    summary: {
      totalProjects: projects.length,
      activeCount,
      totalOvernightCommits,
      recommendation: generateRecommendation(projects),
      allClean,
    },
  };
}

// --- Formatting (pure functions) ---

export function formatProjectBriefing(project: ProjectBriefing): string {
  const lines: string[] = [];
  // UX-M2 (#601): use canonical sym glyphs so dots are consistent with ports/monitor outputs.
  const dot = project.state === "active" ? green(sym.dotFilled) : dim(sym.dotEmpty);
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
    lines.push(`  \u251C\u2500 ${yellow(`${sym.warn} ${count} modified file${count !== 1 ? "s" : ""} (uncommitted)`)}`);
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
    // Scan backward for last \u251C\u2500 line and convert to \u2514\u2500 (robust to sub-lines)
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]?.includes("\u251C\u2500")) {
        lines[i] = lines[i]!.replace("\u251C\u2500", "\u2514\u2500");
        break;
      }
    }
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
  if (summary.allClean) {
    lines.push(`  ${green(sym.ok)} All projects clean`);
  }
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

export async function runBriefing(): Promise<void> {
  const { projects, summary } = await collectBriefingData();
  if (projects.length === 0) {
    console.log("No projects registered. Use 'summon add <name> <path>' to register projects.");
    return;
  }
  console.log(formatFullBriefing(projects, summary));
}
