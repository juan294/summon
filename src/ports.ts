import { existsSync, readFileSync, statSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { readKVFile, listProjects } from "./config.js";
import { readAllStatuses } from "./status.js";
import { isTrusted } from "./trust.js";
import { runPool, ioConcurrency } from "./utils.js";

// Computed once at module load (this module is lazy-loaded, off the cold-start path).
const IO_CONCURRENCY = ioConcurrency();

export interface PortAssignment {
  port: number;
  project: string;
  source: "config" | "env" | "package.json" | "framework-default";
  state: "active" | "stopped" | "unknown";
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
  state: "active" | "stopped" | "unknown",
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

export async function detectAllPorts(): Promise<{
  assignments: PortAssignment[];
  conflicts: Map<number, string[]>;
}> {
  const projects = listProjects();
  const statusMap = new Map(
    readAllStatuses().map((status) => [status.project, status.state]),
  );

  const perProject = await runPool([...projects], IO_CONCURRENCY, ([name, dir]) =>
    detectProjectPorts(name, dir, statusMap.get(name) ?? "unknown"),
  );
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

  return { assignments: allAssignments, conflicts };
}
