import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "summon");
const PROJECTS_FILE = join(CONFIG_DIR, "projects");
const CONFIG_FILE = join(CONFIG_DIR, "config");

let configEnsured = false;

function ensureConfig(): void {
  if (configEnsured) return;
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(PROJECTS_FILE)) writeFileSync(PROJECTS_FILE, "", { mode: 0o600 });
  if (!existsSync(CONFIG_FILE)) writeFileSync(CONFIG_FILE, "", { mode: 0o600 });
  configEnsured = true;
}

/** @internal — test-only, reset the ensureConfig cache */
export function resetConfigCache(): void {
  configEnsured = false;
}

/**
 * Check if this is a first-run scenario (config file does not exist yet).
 * Does NOT call ensureConfig() — must not create the file as a side effect.
 */
export function isFirstRun(): boolean {
  return !existsSync(CONFIG_FILE);
}

// --- Per-project config ---

export function readKVFile(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return map;
  for (const line of content.split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    map.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return map;
}

function readKV(file: string): Map<string, string> {
  ensureConfig();
  return readKVFile(file);
}

function writeKV(file: string, map: Map<string, string>): void {
  const lines = [...map.entries()].map(
    ([k, v]) =>
      `${k.replace(/[\n\r]/g, "")}=${v.replace(/[\n\r]/g, "")}`,
  );
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
}

// --- Projects ---

export function addProject(name: string, path: string): void {
  const projects = readKV(PROJECTS_FILE);
  projects.set(name, path);
  writeKV(PROJECTS_FILE, projects);
}

export function removeProject(name: string): boolean {
  const projects = readKV(PROJECTS_FILE);
  const existed = projects.delete(name);
  if (existed) writeKV(PROJECTS_FILE, projects);
  return existed;
}

export function getProject(name: string): string | undefined {
  return readKV(PROJECTS_FILE).get(name);
}

export function listProjects(): Map<string, string> {
  return readKV(PROJECTS_FILE);
}

// --- Machine config ---

export function setConfig(key: string, value: string): void {
  const config = readKV(CONFIG_FILE);
  config.set(key, value);
  writeKV(CONFIG_FILE, config);
}

export function removeConfig(key: string): boolean {
  const config = readKV(CONFIG_FILE);
  const existed = config.delete(key);
  if (existed) writeKV(CONFIG_FILE, config);
  return existed;
}

/** @internal — test-only, not used in production */
export function getConfig(key: string): string | undefined {
  return readKV(CONFIG_FILE).get(key);
}

export function listConfig(): Map<string, string> {
  return readKV(CONFIG_FILE);
}

export const VALID_KEYS = ["editor", "sidebar", "panes", "editor-size", "shell", "layout", "auto-resize"];

export const CLI_FLAGS = [
  "--help", "--version", "--layout", "--editor", "--panes",
  "--editor-size", "--sidebar", "--shell", "--auto-resize",
  "--no-auto-resize", "--dry-run",
  "-h", "-v", "-l", "-e", "-p", "-s", "-n",
];
