import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "summon");
const PROJECTS_FILE = join(CONFIG_DIR, "projects");
const CONFIG_FILE = join(CONFIG_DIR, "config");

let configEnsured = false;

function ensureConfig(): void {
  if (configEnsured) return;
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PROJECTS_FILE)) writeFileSync(PROJECTS_FILE, "");
  if (!existsSync(CONFIG_FILE)) writeFileSync(CONFIG_FILE, "editor=claude\n");
  configEnsured = true;
}

/** Reset the ensureConfig cache — for test cleanup only. */
export function resetConfigCache(): void {
  configEnsured = false;
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
  writeFileSync(file, lines.join("\n") + "\n");
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
  writeKV(PROJECTS_FILE, projects);
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

export function getConfig(key: string): string | undefined {
  return readKV(CONFIG_FILE).get(key);
}

export function listConfig(): Map<string, string> {
  return readKV(CONFIG_FILE);
}
