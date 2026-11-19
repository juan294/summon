import { existsSync, readFileSync, statSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { readKVFile, listProjects } from "./config.js";
import { readAllStatuses } from "./status.js";
import type { ResolvedStatus } from "./status.js";
import { isLiveState } from "./status-record.js";
import type { WorkspaceState } from "./status-record.js";
import { isTrusted } from "./trust.js";
import { getErrorMessage, runPool, IO_CONCURRENCY } from "./utils.js";
import type { LivePort, LivePortsResult, LivePortsStatus } from "./backends/port.js";
import { escapeControlChars } from "./ui/sanitize.js";

export interface PortAssignment {
  port: number;
  project: string;
  source: "config" | "env" | "package.json" | "framework-default";
  state: WorkspaceState;
}

const PORT_ENV_KEYS = ["PORT", "DEV_PORT", "API_PORT", "VITE_PORT", "NEXT_PORT", "DB_PORT"];

const DEV_SERVER_NAMES = new Set([
  "vite", "next", "nuxt", "astro", "remix", "webpack", "parcel",
  "serve", "http-server", "fastapi", "uvicorn", "flask", "django",
  "rails", "puma", "spring", "nodemon", "ts-node", "tsx", "deno", "bun",
]);

const RUNNER_PREFIXES = new Set(["npx", "pnpm", "yarn", "bunx", "node", "bun", "deno"]);

function isDevServerScript(script: string): boolean {
  const tokens = script.trim().split(/\s+/);
  for (const token of tokens) {
    if (token.startsWith("-")) continue;
    const name = token.split("/").pop() ?? token;
    if (DEV_SERVER_NAMES.has(name)) return true;
    if (!RUNNER_PREFIXES.has(name)) return false;
  }
  return false;
}

const FRAMEWORK_DEFAULTS: ReadonlyArray<{ pattern: string; port: number; name: string }> = [
  { pattern: "next.config", port: 3000, name: "Next.js" },
  { pattern: "vite.config", port: 5173, name: "Vite" },
  { pattern: "nuxt.config", port: 3000, name: "Nuxt" },
  { pattern: "remix.config", port: 3000, name: "Remix" },
  { pattern: "astro.config", port: 4321, name: "Astro" },
  { pattern: "svelte.config", port: 5173, name: "SvelteKit" },
];

// Hoisted regex for port flag parsing — /g flag makes it stateful; reset lastIndex before each use.
// BE-H2 (#591): capture the full non-whitespace token so that "3000abc" is captured as-is
// and rejected by the strict /^\d+$/ check below (not silently truncated to 3000).
const PORT_FLAG_RE = /(?:-p|--port)[=\s]+(\S+)/g;

// Extensions to probe when detecting framework config files.
const EXTENSIONS = [".js", ".mjs", ".ts", ".cjs"];

export async function detectProjectPorts(
  projectName: string,
  projectDir: string,
  state: WorkspaceState,
): Promise<PortAssignment[]> {
  const assignments: PortAssignment[] = [];
  const seenPorts = new Set<number>();

  // 1. Read .summon env vars (only if the project directory is trusted)
  const summonFile = join(projectDir, ".summon");
  if (existsSync(summonFile) && isTrusted(projectDir)) {
    const config = readKVFile(summonFile);
    for (const envKey of PORT_ENV_KEYS) {
      const val = config.get(`env.${envKey}`);
      if (val) {
        const port = parseInt(val, 10);
        if (!isNaN(port) && port > 0 && !seenPorts.has(port)) {
          seenPorts.add(port);
          assignments.push({ port, project: projectName, source: "config", state });
        }
      }
    }
  }

  // 2. Read package.json scripts for port flags
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      // BE-H2 (#591): skip files larger than 1MB to prevent DoS via oversized package.json
      const pkgStat = statSync(pkgPath);
      if (pkgStat.size <= 1_048_576) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          scripts?: Record<string, string>;
        };
        const scripts = pkg.scripts ?? {};
        for (const script of Object.values(scripts)) {
          if (!isDevServerScript(script)) continue;
          PORT_FLAG_RE.lastIndex = 0; // reset stateful /g regex before each reuse
          let match;
          while ((match = PORT_FLAG_RE.exec(script)) !== null) {
            // BE-H2 (#591): strict all-digit check — parseInt("3000abc") === 3000 (wrong)
            if (!/^\d+$/.test(match[1]!)) continue;
            const port = parseInt(match[1]!, 10);
            if (port > 0 && !seenPorts.has(port)) {
              seenPorts.add(port);
              assignments.push({ port, project: projectName, source: "package.json", state });
            }
          }
        }
      }
    } catch {
      /* stat/read/parse failure, skip */
    }
  }

  // 3. Framework defaults — single readdir instead of 24 access probes per project.
  let entries: Set<string>;
  try {
    entries = new Set(await fsPromises.readdir(projectDir));
  } catch {
    entries = new Set(); // dir unreadable → no framework defaults (same as all-access-fail today)
  }
  for (const fw of FRAMEWORK_DEFAULTS) {
    if (seenPorts.has(fw.port)) continue;
    const hit = EXTENSIONS.some((ext) => entries.has(fw.pattern + ext));
    if (hit) {
      seenPorts.add(fw.port);
      assignments.push({ port: fw.port, project: projectName, source: "framework-default", state });
    }
  }

  return assignments;
}

/** The macOS ephemeral range starts here: agents and helpers listen above it, dev servers below (owner decision D1). */
export const EPHEMERAL_FROM = 49152;

/** A live port with the workspace it was read from. */
export interface LivePortRow extends LivePort {
  project: string;
  state: WorkspaceState;
  /** In the ephemeral range; `summon ports` hides it unless a project claims the port. */
  ephemeral: boolean;
}

/** A port a running workspace holds while another project claims it: that project's server cannot start. */
export interface HeldConflict {
  port: number;
  holder: string;
  pane: string;
  process: string | null;
  claimants: Array<{ project: string; source: PortAssignment["source"] }>;
}

/** Why a running workspace's live ports are missing or incomplete. */
export interface LiveNote {
  project: string;
  status: Exclude<LivePortsStatus, "ok">;
  reason: string;
}

export interface PortsReport {
  assignments: PortAssignment[];
  /** Ports claimed (statically) by more than one project. */
  conflicts: Map<number, string[]>;
  /** How many registered projects were read (an empty result means something different with none). */
  projectCount: number;
  /** Live ports of running workspaces, sorted by port. */
  live: LivePortRow[];
  held: HeldConflict[];
  notes: LiveNote[];
  /** Running workspaces whose backend has live ports (Rex). */
  liveWorkspaces: number;
  /** Of those, the ones read completely or partially. */
  readWorkspaces: number;
}

async function readLive(statuses: readonly ResolvedStatus[]): Promise<Pick<PortsReport, "live" | "notes" | "liveWorkspaces" | "readWorkspaces">> {
  const running = statuses.filter((status) => isLiveState(status.state));
  if (running.length === 0) return { live: [], notes: [], liveWorkspaces: 0, readWorkspaces: 0 };
  // Loaded only when a workspace runs: the backends are not part of a static-only read.
  const [{ workspaceBackendFor }, { createLiveBudget }] = await Promise.all([import("./backends/workspace.js"), import("./backends/live-budget.js")]);
  const readable = running.flatMap((status) => {
    const read = workspaceBackendFor(status.backend).livePorts;
    return read ? [{ status, read }] : [];
  });
  const budget = createLiveBudget();
  const results = await runPool(readable, IO_CONCURRENCY, async ({ status, read }): Promise<LivePortsResult> => {
    try {
      return await read(status.project, status, budget);
    } catch (error) {
      return { status: "unavailable", ports: [], reason: getErrorMessage(error) };
    }
  });
  const live: LivePortRow[] = [];
  const notes: LiveNote[] = [];
  let readWorkspaces = 0;
  results.forEach((result, index) => {
    const { status } = readable[index]!;
    if (result.status === "ok" || result.status === "partial") readWorkspaces++;
    if (result.status !== "ok") notes.push({ project: status.project, status: result.status, reason: result.reason ?? result.status });
    for (const port of result.ports) live.push({ ...port, project: status.project, state: status.state, ephemeral: port.port >= EPHEMERAL_FROM });
  });
  live.sort((a, b) => a.port - b.port || a.project.localeCompare(b.project) || a.address.localeCompare(b.address));
  return { live, notes, liveWorkspaces: readable.length, readWorkspaces };
}

/** Held conflicts: one per port, holder and pane (a server bound on two addresses is one holder). */
function heldConflicts(live: readonly LivePortRow[], assignments: readonly PortAssignment[]): HeldConflict[] {
  const held: HeldConflict[] = [];
  const seen = new Set<string>();
  for (const row of live) {
    const claimants = assignments.filter((a) => a.port === row.port && a.project !== row.project).map((a) => ({ project: a.project, source: a.source }));
    const key = `${row.port}\n${row.project}\n${row.pane}`;
    if (claimants.length === 0 || seen.has(key)) continue;
    seen.add(key);
    held.push({ port: row.port, holder: row.project, pane: row.pane, process: row.process, claimants });
  }
  return held;
}

/** `<pane> (<process>)`, display-safe; the process is left out when the server cannot tell. */
export function holderLabel(pane: string, process: string | null): string {
  return escapeControlChars(process ? `${pane} (${process})` : pane);
}

/** The line `summon ports` and `summon doctor` print for a held conflict. */
export function heldLine(held: HeldConflict): string {
  const claimants = held.claimants.map((c) => `${c.project} (${c.source})`);
  const who = claimants.length === 1 ? `${claimants[0]} claims it` : `${claimants.slice(0, -1).join(", ")} and ${claimants.at(-1)} claim it`;
  return `Port ${held.port} is held by ${escapeControlChars(held.holder)}/${holderLabel(held.pane, held.process)}; ${escapeControlChars(who)}`;
}

/** One line per reason: the projects whose live ports are incomplete, and the API note once (it names no project). */
export function liveNoteLines(notes: readonly LiveNote[]): string[] {
  const byReason = new Map<string, string[]>();
  for (const note of notes) {
    const key = note.status === "unsupported" ? `\u0000${note.reason}` : note.reason;
    byReason.set(key, [...(byReason.get(key) ?? []), note.project]);
  }
  return [...byReason].map(([key, projects]) => key.startsWith("\u0000")
    ? escapeControlChars(key.slice(1))
    : `live ports incomplete for ${escapeControlChars(projects.join(", "))} (${escapeControlChars(key)})`);
}

export async function detectAllPorts(): Promise<PortsReport> {
  const projects = listProjects();
  const statuses = readAllStatuses();
  const statusMap = new Map(statuses.map((status) => [status.project, status.state]));

  const entries = [...projects];
  const [perProject, liveRead] = await Promise.all([
    runPool(entries, IO_CONCURRENCY, ([name, dir]) => detectProjectPorts(name, dir, statusMap.get(name) ?? "stopped")),
    readLive(statuses),
  ]);
  const allAssignments: PortAssignment[] = perProject.flat();

  // Sort by port number
  allAssignments.sort((a, b) => a.port - b.port);

  // Build conflict map
  const portProjects = new Map<number, string[]>();
  for (const a of allAssignments) {
    const list = portProjects.get(a.port) ?? [];
    list.push(a.project);
    portProjects.set(a.port, list);
  }
  const conflicts = new Map<number, string[]>();
  for (const [port, projs] of portProjects) {
    if (projs.length > 1) conflicts.set(port, projs);
  }

  return { assignments: allAssignments, conflicts, projectCount: entries.length, ...liveRead, held: heldConflicts(liveRead.live, allAssignments) };
}
