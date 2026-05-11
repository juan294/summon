import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".config", "summon");
export const STATUS_DIR = join(CONFIG_DIR, "status");
export const SNAPSHOTS_DIR = join(CONFIG_DIR, "snapshots");
export const LAYOUTS_DIR = join(CONFIG_DIR, "layouts");
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");
export const LOGS_DIR = join(CONFIG_DIR, "logs");
export const TRUST_FILE = join(CONFIG_DIR, "trust.json");
