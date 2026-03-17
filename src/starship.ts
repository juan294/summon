import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import { resolveCommand, SAFE_COMMAND_RE, getErrorMessage } from "./utils.js";

/** Directory for cached Starship preset TOML files. */
const STARSHIP_DIR = join(CONFIG_DIR, "starship");

/** Cached resolved path for the starship binary — avoids repeated shell-outs. */
let cachedStarshipPath: string | null | undefined;

/** Cached preset list — avoids repeated `starship preset --list` calls. */
let cachedPresets: string[] | null = null;

function getStarshipPath(): string | null {
  if (cachedStarshipPath === undefined) {
    cachedStarshipPath = resolveCommand("starship");
  }
  return cachedStarshipPath;
}

/** @internal — exported for testing only */
export function resetStarshipCache(): void {
  cachedStarshipPath = undefined;
  cachedPresets = null;
}

/** Check whether the `starship` binary is available in PATH. */
export function isStarshipInstalled(): boolean {
  return getStarshipPath() !== null;
}

/** Return the list of built-in Starship preset names, or [] if unavailable. */
export function listStarshipPresets(): string[] {
  if (cachedPresets !== null) return cachedPresets;
  const starshipBin = getStarshipPath();
  if (!starshipBin) return [];
  try {
    const output = execFileSync(starshipBin, ["preset", "--list"], {
      encoding: "utf-8",
    });
    cachedPresets = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return cachedPresets;
  } catch {
    return [];
  }
}

/** @internal — exported for testing only */
export function isValidPreset(name: string): boolean {
  if (!SAFE_COMMAND_RE.test(name)) return false;
  return listStarshipPresets().includes(name);
}

/**
 * Ensure the cached TOML for a preset exists and return its absolute path.
 * Generates the file via `starship preset <name> -o <path>` on cache miss.
 */
export function ensurePresetConfig(presetName: string): string {
  if (!SAFE_COMMAND_RE.test(presetName)) {
    throw new Error(`Invalid Starship preset name: ${presetName}`);
  }
  const starshipBin = getStarshipPath();
  if (!starshipBin) {
    throw new Error("Starship is not installed");
  }
  const targetPath = getPresetConfigPath(presetName);
  if (existsSync(targetPath)) return targetPath;

  mkdirSync(STARSHIP_DIR, { recursive: true, mode: 0o700 });
  try {
    execFileSync(starshipBin, ["preset", presetName, "-o", targetPath], {
      encoding: "utf-8",
    });
  } catch (err) {
    throw new Error(
      `Failed to generate Starship preset "${presetName}": ${getErrorMessage(err)}`,
      { cause: err },
    );
  }
  if (!existsSync(targetPath)) {
    throw new Error(
      `Starship preset "${presetName}" did not produce a config file`,
    );
  }
  chmodSync(targetPath, 0o600);
  return targetPath;
}

/** Pure path computation — no filesystem side effects. */
export function getPresetConfigPath(presetName: string): string {
  return join(STARSHIP_DIR, `${presetName}.toml`);
}
