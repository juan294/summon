import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { GHOSTTY_PATHS } from "./utils.js";

export type Capability = {
  state: "supported" | "unsupported" | "unavailable";
  reason: string;
};
export type GhosttyVersion = {
  text: string;
  stable: boolean;
  recommended: boolean;
};
export const GHOSTTY_CONFIG_KEYS = [
  "shell-integration",
  "notify-on-command-finish",
  "scrollback-compression",
  "link-osc8",
  "clipboard-read",
  "clipboard-write",
  "vt-window-resize-allowed",
  "vt-xt-checksum-report",
] as const;
export type GhosttyConfigKey = (typeof GHOSTTY_CONFIG_KEYS)[number];
export type EffectiveConfig = Record<GhosttyConfigKey, string | null>;
export interface GhosttyDiagnostics {
  app: string | null;
  version: GhosttyVersion | null;
  capabilities: Record<
    | "nativeIdentity"
    | "foreground"
    | "titleOverride"
    | "detachTab"
    | "effectiveConfig",
    Capability
  >;
  config: EffectiveConfig;
}

/** The optional list is for isolated fixtures; production only uses known bundle locations. */
export function discoverGhostty(
  locations: readonly string[] = GHOSTTY_PATHS,
): string | null {
  return (
    locations.find((app) => existsSync(join(app, "Contents/MacOS/ghostty"))) ??
    null
  );
}

export function parseVersion(output: string): GhosttyVersion | null {
  const match = /^Ghostty (\d+)\.(\d+)\.(\d+)([-+][\w.+-]+)?(?:\s|$)/m.exec(
    output,
  );
  if (!match) return null;
  const stable = !match[4] && !/channel:\s*(?!stable\b)\S+/.test(output);
  const major = Number(match[1]),
    minor = Number(match[2]);
  return {
    text: `${match[1]}.${match[2]}.${match[3]}${match[4] ?? ""}`,
    stable,
    recommended: stable && (major > 1 || (major === 1 && minor >= 4)),
  };
}

const SCALARS: Record<GhosttyConfigKey, RegExp> = {
  "shell-integration": /^(none|detect|bash|zsh|fish|elvish)$/,
  "notify-on-command-finish": /^(never|unfocused|always)$/,
  "scrollback-compression": /^(true|false)$/,
  "link-osc8": /^(true|false)$/,
  "clipboard-read": /^(ask|allow|deny)$/,
  "clipboard-write": /^(ask|allow|deny)$/,
  "vt-window-resize-allowed": /^(true|false)$/,
  "vt-xt-checksum-report": /^(true|false)$/,
};

export function parseEffectiveConfig(output: string): EffectiveConfig {
  const result = Object.fromEntries(
    GHOSTTY_CONFIG_KEYS.map((key) => [key, null]),
  ) as EffectiveConfig;
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([\w-]+)(?:\s*=\s*(.*))?$/.exec(line);
    const candidate = match?.[1] ?? /^\s*([\w-]+)/.exec(line)?.[1];
    if (!GHOSTTY_CONFIG_KEYS.includes(candidate as GhosttyConfigKey)) continue;
    const key = candidate as GhosttyConfigKey;
    const value = match?.[2]?.trim();
    result[key] =
      !seen.has(key) && value !== undefined && SCALARS[key].test(value)
        ? value
        : null;
    seen.add(key);
  }
  return result;
}

function capability(state: Capability["state"], reason: string): Capability {
  return { state, reason };
}

/** Bounded, shell-free, invocation-local probes. Never retain subprocess output or errors. */
function probe(app: string, args: string[], timeout = 3000): string | null {
  try {
    const result = execFileSync(join(app, "Contents/MacOS/ghostty"), args, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      killSignal: "SIGKILL",
    });
    return Buffer.byteLength(result) <= 1024 * 1024 ? result : null;
  } catch {
    return null;
  }
}

function effectiveConfig(app: string): EffectiveConfig {
  const full = probe(app, [
    "+show-config",
    "--no-pager",
    "--changes-only=false",
  ]);
  if (full !== null && full.trim()) return parseEffectiveConfig(full);
  // Older releases: establish supported flags from help, then overlay changed keys on defaults.
  const help = probe(app, ["+show-config", "--help"]);
  if (!help?.includes("--default") || !help.includes("--no-pager"))
    return parseEffectiveConfig("");
  const defaults = probe(app, ["+show-config", "--no-pager", "--default"]);
  const changes = probe(app, ["+show-config", "--no-pager"]);
  if (defaults === null || changes === null) return parseEffectiveConfig("");
  const merged = parseEffectiveConfig(defaults);
  const changed = parseEffectiveConfig(changes);
  for (const key of GHOSTTY_CONFIG_KEYS) {
    if (new RegExp(`^\\s*${key}(?:\\s|=|$)`, "m").test(changes))
      merged[key] = changed[key];
  }
  return merged;
}

/** Cheap native-only dictionary read; explicit actions never scan effective configuration. */
export function probeGhosttyNative(app: string | null = discoverGhostty()): Pick<GhosttyDiagnostics["capabilities"], "nativeIdentity" | "foreground" | "titleOverride"> {
  const unavailable = capability("unavailable", "Native dictionary unavailable; retry summon doctor.");
  const result = { nativeIdentity: unavailable, foreground: unavailable, titleOverride: unavailable };
  if (!app) return result;
  let dictionary = "";
  try {
    dictionary = readFileSync(
      join(app, "Contents/Resources/Ghostty.sdef"),
      "utf-8",
    );
  } catch {
    /* unavailable */
  }
  const terminal = /<class\s+name="terminal"[\s\S]*?<\/class>/.exec(
    dictionary,
  )?.[0];
  const tab = /<class\s+name="tab"[\s\S]*?<\/class>/.exec(dictionary)?.[0];
  if (terminal) {
    const check = (supported: boolean): Capability =>
      capability(
        supported ? "supported" : "unsupported",
        supported
          ? "Installed scripting dictionary."
          : "Requires a newer Ghostty scripting dictionary; upgrade to 1.4.0 or later.",
      );
    result.nativeIdentity = check(
      /<property\s+name="id"/.test(terminal),
    );
    result.foreground = check(
      /<property\s+name="pid"/.test(terminal) &&
        /<property\s+name="tty"/.test(terminal),
    );
    result.titleOverride = check(
      /<property\s+name="name override"[^>]*access="rw"/.test(terminal) &&
        !!tab &&
        /<property\s+name="name override"[^>]*access="rw"/.test(tab),
    );
  }
  return result;
}

/** Optional app is for native bundle fixtures, never sourced from project configuration. */
export function probeGhostty(
  app: string | null = discoverGhostty(),
): GhosttyDiagnostics {
  const unavailable = capability(
    "unavailable",
    "Probe unavailable; retry summon doctor.",
  );
  const result: GhosttyDiagnostics = {
    app,
    version: null,
    capabilities: {
      nativeIdentity: unavailable,
      foreground: unavailable,
      titleOverride: unavailable,
      detachTab: unavailable,
      effectiveConfig: unavailable,
    },
    config: parseEffectiveConfig(""),
  };
  if (!app) return result;
  const version = probe(app, ["--version"], 2000);
  result.version = version === null ? null : parseVersion(version);
  Object.assign(result.capabilities, probeGhosttyNative(app));
  const actions = probe(app, ["+list-actions"]);
  if (actions?.trim())
    result.capabilities.detachTab = capability(
      /^move_tab_to_new_window(?:\s|$)/m.test(actions)
        ? "supported"
        : "unsupported",
      "Installed +list-actions; upgrade Ghostty if unavailable.",
    );
  result.config = effectiveConfig(app);
  if (GHOSTTY_CONFIG_KEYS.every((key) => result.config[key] !== null))
    result.capabilities.effectiveConfig = capability(
      "supported",
      "Allowlisted effective scalar configuration.",
    );
  return result;
}
