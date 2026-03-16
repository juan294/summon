import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isPresetName } from "./layout.js";

export const CONFIG_DIR = join(homedir(), ".config", "summon");
export const LAYOUTS_DIR = join(CONFIG_DIR, "layouts");
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

/** @internal — exported for testing only */
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
  let content: string;
  try {
    content = readFileSync(path, "utf-8").trim();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return map;
    throw err;
  }
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

function formatKVLines(map: Map<string, string>): string {
  const lines = [...map.entries()].map(
    ([k, v]) =>
      `${k.replace(/[\n\r]/g, "")}=${v.replace(/[\n\r]/g, "")}`,
  );
  return lines.join("\n") + "\n";
}

function writeKV(file: string, map: Map<string, string>): void {
  writeFileSync(file, formatKVLines(map), { mode: 0o600 });
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

/** @internal — exported for testing only */
export function getConfig(key: string): string | undefined {
  return readKV(CONFIG_FILE).get(key);
}

export function listConfig(): Map<string, string> {
  return readKV(CONFIG_FILE);
}

export const VALID_KEYS = ["editor", "sidebar", "panes", "editor-size", "shell", "layout", "auto-resize", "starship-preset", "new-window", "fullscreen", "maximize", "float", "font-size", "theme", "on-start"];

/** Config keys that accept only "true" or "false" values. */
export const BOOLEAN_KEYS = new Set(["auto-resize", "new-window", "fullscreen", "maximize", "float"]);

export const CLI_FLAGS = [
  "--help", "--version", "--layout", "--editor", "--panes",
  "--editor-size", "--sidebar", "--shell", "--auto-resize",
  "--no-auto-resize", "--starship-preset", "--dry-run",
  "--env", "--new-window", "--fullscreen", "--maximize", "--float", "--font-size", "--theme", "--on-start",
  "-h", "-v", "-l", "-e", "-p", "-s", "-n",
];

// --- Custom layouts ---

export const LAYOUT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function isValidLayoutName(name: string): boolean {
  return LAYOUT_NAME_RE.test(name) && !isPresetName(name);
}

export function listCustomLayouts(): string[] {
  if (!existsSync(LAYOUTS_DIR)) return [];
  return readdirSync(LAYOUTS_DIR).sort();
}

export function readCustomLayout(name: string): Map<string, string> | null {
  const filePath = join(LAYOUTS_DIR, name);
  if (!existsSync(filePath)) return null;
  return readKVFile(filePath);
}

export function saveCustomLayout(name: string, entries: Map<string, string>): void {
  mkdirSync(LAYOUTS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(join(LAYOUTS_DIR, name), formatKVLines(entries), { mode: 0o600 });
}

export function deleteCustomLayout(name: string): boolean {
  try {
    unlinkSync(join(LAYOUTS_DIR, name));
    return true;
  } catch {
    return false;
  }
}

export function isCustomLayout(name: string): boolean {
  return existsSync(join(LAYOUTS_DIR, name));
}
