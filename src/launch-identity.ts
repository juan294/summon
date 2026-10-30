import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATUS_DIR } from "./paths.js";
import { atomicWrite, debugLog, confinedPath, SUMMON_WORKSPACE_ENV } from "./utils.js";
import { shellDoubleQuote } from "./shell-escape.js";
import { isBackendId } from "./backend.js";
import type { BackendId } from "./backend.js";
import { PANE_NAME_RE } from "./tree.js";

/**
 * Per-launch identity and artifacts (plan P12, P13).
 *
 * Every launch owns a UUID v4. Its liveness sidecars, manifest and pane files live under
 * `STATUS_DIR/<project>.launches/<launchId>.*`, so a cleanup trap from one launch can never
 * remove another launch's files, and the shared record `<project>.json` is written only by
 * Node code under the status lock (see `withOwnedRecord` in status.ts).
 */

export const LAUNCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newLaunchId(): string {
  return randomUUID();
}

export function isLaunchId(value: unknown): value is string {
  return typeof value === "string" && LAUNCH_ID_RE.test(value);
}

function assertLaunchId(launchId: string): void {
  if (!LAUNCH_ID_RE.test(launchId)) throw new Error(`Invalid launch id: "${launchId}"`);
}

/** Pane names are identifiers (the tree DSL pattern), never paths, so a pane file cannot escape its launch directory. */
function assertPaneName(paneName: string): void {
  if (!PANE_NAME_RE.test(paneName)) throw new Error(`Invalid pane name: ${JSON.stringify(paneName)}`);
}

// --- Artifact paths (Node side) ---

export interface LaunchArtifactPaths {
  /** `STATUS_DIR/<project>.launches` */
  dir: string;
  /** Rex manifest written by the launcher before `session.create` (P13). */
  manifest: string;
  /** `"$$"` of the root shell; written by the bootstrap, removed by the trap. */
  pid: string;
  /** Holds the launch id; written by the bootstrap, removed by the trap. */
  active: string;
  /** Per-pane `<REX_SESSION>\n<REX_BLOCK>\n` file and its atomic-publication temp name. */
  pane(name: string): { file: string; tmp: string };
}

/** Directory holding every per-launch artifact of a project; path-confined to STATUS_DIR. */
export function launchesDir(project: string): string {
  return confinedPath(STATUS_DIR, `${project}.launches`, "status");
}

export function launchArtifactPaths(project: string, launchId: string): LaunchArtifactPaths {
  assertLaunchId(launchId);
  const dir = launchesDir(project);
  return {
    dir,
    manifest: join(dir, `${launchId}.json`),
    pid: join(dir, `${launchId}.pid`),
    active: join(dir, `${launchId}.active`),
    pane(name: string) {
      const file = confinedPath(dir, `${launchId}.pane.${name}`, "pane");
      return { file, tmp: `${file}.tmp` };
    },
  };
}

/** The files a launch generation may own, grouped by what they prove (see `removeLaunchFileSet`). */
export interface LaunchFileSet {
  /** The liveness sidecars (pid, active marker). */
  liveness: string[];
  /** Rex pane files and their temp names, except the root pane's file. */
  panes: string[];
  /** The Rex manifest: what makes the launch discoverable; absent when it must stay. */
  manifest?: string;
  /** The root pane's file: the proof of which session the launch created (P13 token); absent when it must stay. */
  token?: string;
}

/** Every file a launch generation may own: the liveness sidecars, and (Rex) the pane files, the manifest and the token. */
export function launchArtifactFiles(project: string, launchId: string, paneOrder: readonly string[]): LaunchFileSet {
  const paths = launchArtifactPaths(project, launchId);
  const [rootName] = paneOrder;
  return {
    liveness: [paths.pid, paths.active],
    panes: paneOrder.flatMap((name, i) => (i === 0 ? [paths.pane(name).tmp] : [paths.pane(name).file, paths.pane(name).tmp])),
    manifest: paths.manifest,
    token: rootName === undefined ? undefined : paths.pane(rootName).file,
  };
}

/** The set as one list (listing, presence checks). */
export function launchFileList(files: LaunchFileSet): string[] {
  return [...files.liveness, ...files.panes, files.manifest, files.token].filter((file): file is string => file !== undefined);
}

// --- Workspace environment (both backends) ---

/** `KEY=VALUE` pairs every workspace pane starts with: marker, tab title, Starship, user vars. */
export function buildEnvVarsList(
  starshipConfigPath: string | null | undefined,
  envVars: Record<string, string> | undefined,
  projectName?: string,
): string[] {
  const allEnvVars: string[] = [`${SUMMON_WORKSPACE_ENV}=1`];
  if (projectName) {
    allEnvVars.push(`SUMMON_TAB_TITLE=${projectName}`);
  }
  if (starshipConfigPath) {
    allEnvVars.push(`STARSHIP_CONFIG=${starshipConfigPath}`);
  }
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      allEnvVars.push(`${key}=${value}`);
    }
  }
  return allEnvVars;
}

// --- Shell fragments (typed into the root pane; `$HOME` resolves inside the shell) ---
//
// Every interpolating line in this section is checked by src/shell-escape.lint.test.ts
// (shell-fragment region rule): user text goes through shellDoubleQuote, pane names are
// validated against PANE_NAME_RE, and the launch id through shellLaunchId, which asserts
// LAUNCH_ID_RE (hex and dashes only) before it is interpolated.

const SHELL_STATUS_DIR = "$HOME/.config/summon/status";

/** A launch id that is safe to interpolate: validated, so it can only contain `[0-9a-f-]`. */
function shellLaunchId(launchId: string): string {
  assertLaunchId(launchId);
  return launchId;
}

/** Quoted launch directory of a project. */
function shellLaunchDir(project: string): string {
  return `"${SHELL_STATUS_DIR}/${shellDoubleQuote(project)}.launches"`;
}

/** Quoted path of this launch's pid or active file. */
function shellArtifact(project: string, launchId: string, suffix: "pid" | "active"): string {
  return `"${SHELL_STATUS_DIR}/${shellDoubleQuote(project)}.launches/${shellLaunchId(launchId)}.${suffix}"`;
}

/** Quoted pane file and its temp name (atomic publication, P13). */
function shellPaneFile(project: string, launchId: string, paneName: string): { file: string; tmp: string } {
  assertPaneName(paneName);
  const path = `${SHELL_STATUS_DIR}/${shellDoubleQuote(project)}.launches/${shellLaunchId(launchId)}.pane.${shellDoubleQuote(paneName)}`;
  return { file: `"${path}"`, tmp: `"${path}.tmp"` }; // lint-allow-escape: path is the checked line above
}

/** Quoted cleanup log file of a project. */
function shellLogFile(project: string): string {
  return `"$HOME/.config/summon/logs/cleanup-${shellDoubleQuote(project)}.log"`;
}

/**
 * Root-pane bootstrap: publish this launch's pid and active marker under its own directory.
 * Under Rex it also publishes the root pane's file, which is the ownership token (P13).
 */
export function bootstrapLine(project: string, launchId: string, backend: BackendId, rootPaneName?: string): string {
  const line = `mkdir -p ${shellLaunchDir(project)} && chmod 700 ${shellLaunchDir(project)} && printf '%s\\n' "$$" > ${shellArtifact(project, launchId, "pid")} && printf '%s\\n' '${shellLaunchId(launchId)}' > ${shellArtifact(project, launchId, "active")}`;
  if (backend !== "rex") return line;
  if (rootPaneName === undefined) throw new Error("Rex bootstrap requires the root pane name");
  return `${line} && ${paneFileLine(project, launchId, rootPaneName)}`;
}

/**
 * Every Rex pane writes `$REX_SESSION` and `$REX_BLOCK` to its own file through a temp name
 * and an atomic rename, so a reader never sees a half-written mapping (P13).
 */
export function paneFileLine(project: string, launchId: string, paneName: string): string {
  const { file, tmp } = shellPaneFile(project, launchId, paneName);
  return `printf '%s\\n%s\\n' "$REX_SESSION" "$REX_BLOCK" > ${tmp} && mv -f ${tmp} ${file}`; // lint-allow-escape: both paths come from shellPaneFile
}

export interface CleanupTrapOptions {
  /** Trusted shell fragment from validated config; inlined, never quoted. */
  onStop?: string;
  targetDir?: string;
  layout?: string;
}

/**
 * Root-pane EXIT/HUP trap: on-stop (logged), `summon snapshot save --launch <id>`, then removal
 * of this launch's own pid and active files only. The pane files, the manifest, the shared
 * record and the legacy `<project>.active`/`.pid` paths are never named here (P12).
 *
 * SE-L1: the trap runs inside the root pane with the project directory as cwd and the pane's
 * login environment. `onStop` comes from a trusted `.summon` file (trust gate) and has passed
 * confirmDangerousCommands; it is inlined as a shell fragment so pipes and redirects work, and
 * its output goes to the cleanup log, never to the terminal. escapeAppleScript is applied by
 * the AppleScript emitter at the outer boundary.
 */
export function cleanupTrapLine(project: string, launchId: string, options: CleanupTrapOptions = {}): string {
  assertLaunchId(launchId);
  const parts: string[] = [
    // SE-L3: mode 700 restricts the log directory to the owning user, like STATUS_DIR.
    'mkdir -p "$HOME/.config/summon" "$HOME/.config/summon/logs"',
    'chmod 700 "$HOME/.config/summon" "$HOME/.config/summon/logs"',
  ];

  if (options.onStop) {
    parts.push(`: >> ${shellLogFile(project)}`);
    parts.push(`chmod 600 ${shellLogFile(project)}`);
    parts.push(`${options.onStop} >> ${shellLogFile(project)} 2>&1`); // lint-allow-escape: onStop is a trusted command fragment from validated config (SE-L1 above)
  }

  if (options.targetDir) {
    parts.push(
      `summon snapshot save`
      + ` --dir "${shellDoubleQuote(options.targetDir)}"`
      + ` --project "${shellDoubleQuote(project)}"`
      + ` --layout "${shellDoubleQuote(options.layout ?? "unknown")}"`
      + ` --launch '${shellLaunchId(launchId)}'`
      + ` 2>/dev/null`,
    );
  }

  parts.push(`rm -f ${shellArtifact(project, launchId, "pid")} ${shellArtifact(project, launchId, "active")} 2>/dev/null`);

  return `__summon_cleanup() { ${parts.join("; ")}; }; trap '__summon_cleanup' EXIT HUP`; // lint-allow-escape: composition of the individually checked parts above
}

// --- Launch manifest (Rex only; written before session.create, P13) ---

export interface LaunchManifest {
  version: 1;
  launchId: string;
  project: string;
  directory: string;
  layout: string;
  /** Summon display order. */
  panes: string[];
  /** Builder traversal order used to assign block ids. */
  paneOrder: string[];
  /** Expected block label per pane name. */
  blockLabels: Record<string, string>;
  backend: BackendId;
  server?: string;
  startedAt: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseLaunchManifest(raw: unknown): LaunchManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (d["version"] !== 1) return null;
  if (!isLaunchId(d["launchId"])) return null;
  if (typeof d["project"] !== "string" || typeof d["directory"] !== "string" || typeof d["layout"] !== "string") return null;
  if (!isStringArray(d["panes"]) || !isStringArray(d["paneOrder"])) return null;
  if (typeof d["blockLabels"] !== "object" || d["blockLabels"] === null || Array.isArray(d["blockLabels"])) return null;
  const labels = d["blockLabels"] as Record<string, unknown>;
  if (!Object.values(labels).every((label) => typeof label === "string")) return null;
  if (!isBackendId(d["backend"])) return null;
  if (d["server"] !== undefined && typeof d["server"] !== "string") return null;
  if (typeof d["startedAt"] !== "string" || Number.isNaN(Date.parse(d["startedAt"]))) return null;
  return {
    version: 1,
    launchId: d["launchId"],
    project: d["project"],
    directory: d["directory"],
    layout: d["layout"],
    panes: [...d["panes"]],
    paneOrder: [...d["paneOrder"]],
    blockLabels: { ...(labels as Record<string, string>) },
    backend: d["backend"],
    ...(typeof d["server"] === "string" ? { server: d["server"] } : {}),
    startedAt: d["startedAt"],
  };
}

export function writeLaunchManifest(manifest: LaunchManifest): void {
  const paths = launchArtifactPaths(manifest.project, manifest.launchId);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  atomicWrite(paths.manifest, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
}

function readManifestFile(file: string, launchId: string): LaunchManifest | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    debugLog(`launch manifest ${file} is not valid JSON`);
    return null;
  }
  const manifest = parseLaunchManifest(data);
  if (!manifest || manifest.launchId !== launchId) {
    debugLog(`launch manifest ${file} is invalid or names another launch`);
    return null;
  }
  return manifest;
}

export function readLaunchManifest(project: string, launchId: string): LaunchManifest | null {
  return readManifestFile(launchArtifactPaths(project, launchId).manifest, launchId);
}

/** Every valid manifest of a project, oldest first. */
export function listLaunchManifests(project: string): LaunchManifest[] {
  const dir = launchesDir(project);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const manifests: LaunchManifest[] = [];
  for (const name of names) {
    const match = /^(.+)\.json$/.exec(name);
    if (!match || !isLaunchId(match[1])) continue;
    const manifest = readManifestFile(join(dir, name), match[1]);
    if (manifest) manifests.push(manifest);
  }
  return manifests.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
