import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readKVFile, listProjects } from "./config.js";
import { readAllStatuses } from "./status.js";

export interface PortAssignment {
  port: number;
  project: string;
  source: "config" | "env" | "package.json" | "framework-default";
  state: "active" | "stopped" | "unknown";
}

const PORT_ENV_KEYS = ["PORT", "DEV_PORT", "API_PORT", "VITE_PORT", "NEXT_PORT", "DB_PORT"];

const FRAMEWORK_DEFAULTS: ReadonlyArray<{ pattern: string; port: number; name: string }> = [
  { pattern: "next.config", port: 3000, name: "Next.js" },
  { pattern: "vite.config", port: 5173, name: "Vite" },
  { pattern: "nuxt.config", port: 3000, name: "Nuxt" },
  { pattern: "remix.config", port: 3000, name: "Remix" },
  { pattern: "astro.config", port: 4321, name: "Astro" },
  { pattern: "svelte.config", port: 5173, name: "SvelteKit" },
];

export function detectProjectPorts(
  projectName: string,
  projectDir: string,
  state: "active" | "stopped" | "unknown",
): PortAssignment[] {
  const assignments: PortAssignment[] = [];
  const seenPorts = new Set<number>();

  // 1. Read .summon env vars
  const summonFile = join(projectDir, ".summon");
  if (existsSync(summonFile)) {
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
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      for (const script of Object.values(scripts)) {
        const portRe = /(?:-p|--port)[=\s]+(\d+)/g;
        let match;
        while ((match = portRe.exec(script)) !== null) {
          const port = parseInt(match[1]!, 10);
          if (port > 0 && !seenPorts.has(port)) {
            seenPorts.add(port);
            assignments.push({ port, project: projectName, source: "package.json", state });
          }
        }
      }
    } catch {
      /* invalid JSON, skip */
    }
  }

  // 3. Framework defaults (only if no explicit ports found for that default)
  const extensions = [".js", ".mjs", ".ts", ".cjs"];
  for (const fw of FRAMEWORK_DEFAULTS) {
    const found = extensions.some((ext) => existsSync(join(projectDir, fw.pattern + ext)));
    if (found && !seenPorts.has(fw.port)) {
      seenPorts.add(fw.port);
      assignments.push({ port: fw.port, project: projectName, source: "framework-default", state });
    }
  }

  return assignments;
}

export function detectAllPorts(): {
  assignments: PortAssignment[];
  conflicts: Map<number, string[]>;
} {
  const projects = listProjects();
  const statusMap = new Map(
    readAllStatuses().map((status) => [status.project, status.state]),
  );

  const allAssignments: PortAssignment[] = [];
  for (const [name, dir] of projects) {
    allAssignments.push(...detectProjectPorts(name, dir, statusMap.get(name) ?? "unknown"));
  }

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
