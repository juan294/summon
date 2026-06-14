import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { SESSIONS_DIR } from "./paths.js";
import { LAYOUT_NAME_RE } from "./config.js";

const SESSION_NAME_RE = LAYOUT_NAME_RE;
const SESSIONS_DIR_RESOLVED = resolve(SESSIONS_DIR) + sep;

export function isValidSessionName(name: string): boolean {
  return SESSION_NAME_RE.test(name);
}

export function sessionPath(name: string): string {
  if (!SESSION_NAME_RE.test(name)) throw new Error(`Invalid session name: "${name}"`);
  const p = join(SESSIONS_DIR, name);
  if (!resolve(p).startsWith(SESSIONS_DIR_RESOLVED)) {
    throw new Error(`Invalid session path: "${name}"`);
  }
  return p;
}

export function listSessions(): string[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  // BE-M4 #605: filter out orphaned .tmp files and dotfiles so they never appear as phantom entries
  return readdirSync(SESSIONS_DIR)
    .filter(f => !f.startsWith(".") && !f.endsWith(".tmp"))
    .sort();
}

export function readSession(name: string): string[] | null {
  const p = sessionPath(name);
  let content: string;
  try {
    content = readFileSync(p, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const projects: string[] = [];
  for (const raw of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    projects.push(line);
  }
  return projects;
}

export function writeSession(name: string, projects: string[]): void {
  for (const proj of projects) {
    if (!SESSION_NAME_RE.test(proj)) {
      throw new Error(`Invalid project name in session: "${proj}"`);
    }
  }
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  const body = projects.join("\n") + "\n";
  writeFileSync(sessionPath(name), body, { mode: 0o600 });
}

export function deleteSession(name: string): boolean {
  try {
    unlinkSync(sessionPath(name));
    return true;
  } catch {
    return false;
  }
}

export function sessionExists(name: string): boolean {
  return existsSync(sessionPath(name));
}
