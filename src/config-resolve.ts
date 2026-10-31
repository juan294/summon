import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isPresetName,
  getPresetNames,
  getPreset,
  PANES_MIN,
  PANES_DEFAULT,
  EDITOR_SIZE_MIN,
  EDITOR_SIZE_MAX,
  EDITOR_SIZE_DEFAULT,
} from "./layout.js";
import type { LayoutOptions } from "./layout.js";
import { listConfig, readKVFromString, readCustomLayout, isCustomLayout, LAYOUT_NAME_RE } from "./config.js";
import { parseTreeDSL, extractPaneDefinitions, extractPaneCwds, assertPaneCwdContained } from "./tree.js";
import type { LayoutNode } from "./tree.js";
import { warn } from "./ui/output.js";
import { assertTrusted, assertTrustedContent } from "./trust.js";
import { parseIntInRange, parsePositiveFloat, ENV_KEY_RE } from "./validation.js";

/** Convert resolved layout options to a key-value config map suitable for saving as a custom layout. */
export function optsToConfigMap(opts: Partial<LayoutOptions>): Map<string, string> {
  const entries = new Map<string, string>();
  if (opts.editor) entries.set("editor", opts.editor);
  if (opts.sidebarCommand) entries.set("sidebar", opts.sidebarCommand);
  if (opts.secondaryEditor) entries.set("secondary-editor", opts.secondaryEditor);
  if (opts.editorPanes !== undefined) entries.set("panes", String(opts.editorPanes));
  if (opts.editorSize !== undefined) entries.set("editor-size", String(opts.editorSize));
  if (opts.shell !== undefined) entries.set("shell", opts.shell);
  if (opts.autoResize !== undefined) entries.set("auto-resize", String(opts.autoResize));
  if (opts.fontSize !== undefined && opts.fontSize !== null) entries.set("font-size", String(opts.fontSize));
  if (opts.newWindow) entries.set("new-window", "true");
  if (opts.newTab) entries.set("new-tab", "true");
  if (opts.fullscreen) entries.set("fullscreen", "true");
  if (opts.maximize) entries.set("maximize", "true");
  if (opts.float) entries.set("float", "true");
  return entries;
}

export interface CLIOverrides {
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  shell?: string;
  "auto-resize"?: string;
  "starship-preset"?: string;
  env?: string[];
  "font-size"?: string;
  "on-start"?: string;
  "new-window"?: string;
  "new-tab"?: string;
  "no-project-config"?: string;
  fullscreen?: string;
  maximize?: string;
  float?: string;
  dryRun?: boolean;
  clean?: string;
}

export interface ResolvedConfig {
  opts: Partial<LayoutOptions>;
  projectOverrides: Map<string, string>;
  machineConfig: Map<string, string>;
  starshipPreset?: string;
  onStart?: string;
  onStop?: string;
  envVars: Record<string, string>;
  treeLayout?: {
    tree: LayoutNode;
    panes: Map<string, string>;
    paneCwds?: Map<string, string>;
    /** Custom layout that defined the tree, named in command fix hints. */
    layoutName: string;
  };
}

/**
 * Denylisted env var key prefixes and exact names that could be used for
 * code injection via dynamic linkers, shell hooks, or interpreter startup files.
 */
const ENV_DENYLIST_PREFIXES = [
  "DYLD_",
  "LD_",
  // SE-L3: GIT_CONFIG, GIT_CONFIG_COUNT/KEY_n/VALUE_n, _PARAMETERS, _GLOBAL and _SYSTEM inject git
  // config such as core.pager, core.fsmonitor or alias.* (each runs a command in git).
  "GIT_CONFIG",
];
const ENV_DENYLIST_EXACT = new Set([
  "NODE_OPTIONS",
  "BASH_ENV",
  "PYTHONSTARTUP",
  "PROMPT_COMMAND",
  "CDPATH",
  "IFS",
  // SE-L3: both backends apply these before the pane shell starts, so they change what runs at
  // shell startup or inside common tools. PATH, PYTHONPATH, ZDOTDIR and HOME stay allowed: search
  // paths, a startup location and the home directory users set on purpose (the Rex E2E suites pass
  // --env ZDOTDIR=<dir> and env.HOME).
  "ENV", // sh, ksh and bash in POSIX mode source $ENV at startup
  "SHELL", // tools such as vim, tmux and script(1) run $SHELL
  "PS1", // bash runs command substitutions in the prompt at each prompt
  "PROMPT", // zsh alias of PS1 (command substitution with PROMPT_SUBST)
  "PERL5OPT", // perl applies -M/-I options from it at every start
  "RUBYOPT", // ruby applies -r options from it at every start
  "GIT_ASKPASS", // git runs it to read credentials
  "SSH_ASKPASS", // ssh runs it to read passphrases
  "LESSOPEN", // less runs it as an input preprocessor
  "LESSCLOSE", // less runs it after LESSOPEN
  // SE-M2 (#609): command-carrying vars — these execute a subprocess when a tool reads
  // them (e.g. git spawning $GIT_SSH_COMMAND, pagers honouring $PAGER, editors via $EDITOR).
  // Values are correctly escaped for injection, but allowing them lets a trusted .summon
  // author swap out the subprocess invoked inside the workspace pane.
  "GIT_SSH_COMMAND",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "PAGER",
  "EDITOR",
  "VISUAL",
  "GIT_EDITOR",
]);

function isDenylisted(envKey: string): boolean {
  if (ENV_DENYLIST_EXACT.has(envKey)) return true;
  return ENV_DENYLIST_PREFIXES.some((prefix) => envKey.startsWith(prefix));
}

function collectEnvVars(
  machineConfig: Map<string, string>,
  projectConfig: Map<string, string>,
  cliEnvFlags: string[] | undefined,
): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Machine config (lowest priority)
  for (const [key, value] of machineConfig) {
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      if (isDenylisted(envKey)) {
        warn(`ignoring denylisted env var key "${envKey}" from machine config.`);
      } else if (ENV_KEY_RE.test(envKey)) {
        envVars[envKey] = value;
      } else {
        // BE-L2 (#618): warn on invalid keys for parity with .summon and --env sources.
        warn(`ignoring invalid env var key "${envKey}" from machine config.`);
      }
    }
  }

  // Project config (overrides machine)
  for (const [key, value] of projectConfig) {
    if (key.startsWith("env.")) {
      const envKey = key.slice(4);
      if (isDenylisted(envKey)) {
        warn(`ignoring denylisted env var key "${envKey}" from .summon file.`);
      } else if (ENV_KEY_RE.test(envKey)) {
        envVars[envKey] = value;
      } else {
        warn(`ignoring invalid env var key "${envKey}" from .summon file.`);
      }
    }
  }

  // CLI flags (highest priority)
  if (cliEnvFlags) {
    for (const entry of cliEnvFlags) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx > 0) {
        const envKey = entry.slice(0, eqIdx);
        if (isDenylisted(envKey)) {
          warn(`ignoring denylisted env var key "${envKey}" from --env flag.`);
        } else if (ENV_KEY_RE.test(envKey)) {
          envVars[envKey] = entry.slice(eqIdx + 1);
        } else {
          warn(`ignoring invalid env var key "${envKey}" from --env flag.`);
        }
      }
    }
  }

  return envVars;
}

/**
 * Pick a config value with priority: CLI > project > global.
 * Empty strings in project or machine config are treated as "not set" — they
 * do not override preset or default values. This preserves the intent that an
 * empty config key means "use the default".
 *
 * Note: To distinguish "explicitly set to empty" from "not present" in project
 * config, callers that need that distinction should use `project.has(key)` directly.
 */
export function pickConfigValue(
  cli: string | undefined,
  projKey: string,
  project: Map<string, string>,
  machineConfig: Map<string, string>,
): string | undefined {
  if (cli !== undefined) return cli;
  return project.get(projKey) || machineConfig.get(projKey) || undefined;
}

/**
 * Resolve the layout key to a base LayoutOptions partial and optional tree layout.
 * Handles: preset lookup, custom layout loading, tree expression parsing.
 */
function resolveLayoutBase(
  layoutKey: string | undefined,
): { base: Partial<LayoutOptions>; treeLayout?: ResolvedConfig["treeLayout"] } {
  if (!layoutKey) return { base: {} };

  if (isPresetName(layoutKey)) {
    return { base: getPreset(layoutKey) };
  }

  if (LAYOUT_NAME_RE.test(layoutKey) && isCustomLayout(layoutKey)) {
    const customData = readCustomLayout(layoutKey);
    if (!customData) return { base: {} };

    const base: Partial<LayoutOptions> = {};
    if (customData.has("editor-size")) {
      const es = parseIntInRange(customData.get("editor-size")!, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
      if (es.ok) {
        base.editorSize = es.value;
      } else {
        warn(
          `Invalid editor-size value in custom layout "${layoutKey}": "${customData.get("editor-size")}". Must be ${EDITOR_SIZE_MIN}-${EDITOR_SIZE_MAX}. Using default (${EDITOR_SIZE_DEFAULT}).`,
        );
      }
    }
    if (customData.has("auto-resize")) base.autoResize = customData.get("auto-resize") === "true";
    if (customData.has("font-size")) {
      const fs = parsePositiveFloat(customData.get("font-size")!);
      if (fs.ok) {
        base.fontSize = fs.value;
      } else {
        warn(
          `Invalid font-size value in custom layout "${layoutKey}": "${customData.get("font-size")}". Must be a positive number. Ignoring.`,
        );
      }
    }
    if (customData.has("new-window")) base.newWindow = customData.get("new-window") === "true";
    if (customData.has("new-tab")) base.newTab = customData.get("new-tab") === "true";
    if (customData.has("fullscreen")) base.fullscreen = customData.get("fullscreen") === "true";
    if (customData.has("maximize")) base.maximize = customData.get("maximize") === "true";
    if (customData.has("float")) base.float = customData.get("float") === "true";

    const treeExpr = customData.get("tree");
    if (treeExpr) {
      const tree = parseTreeDSL(treeExpr);
      const panes = extractPaneDefinitions(customData);
      const paneCwds = extractPaneCwds(customData);
      return { base, treeLayout: { tree, panes, paneCwds: paneCwds.size > 0 ? paneCwds : undefined, layoutName: layoutKey } };
    }

    // Traditional custom layout (no tree= key)
    if (customData.has("editor")) base.editor = customData.get("editor");
    if (customData.has("sidebar")) base.sidebarCommand = customData.get("sidebar");
    if (customData.has("secondary-editor")) base.secondaryEditor = customData.get("secondary-editor");
    if (customData.has("panes")) {
      const p = parseIntInRange(customData.get("panes")!, PANES_MIN);
      if (p.ok) {
        base.editorPanes = p.value;
      } else {
        warn(
          `Invalid panes value in custom layout "${layoutKey}": "${customData.get("panes")}". Must be a positive integer. Ignoring.`,
        );
      }
    }
    if (customData.has("shell")) base.shell = customData.get("shell");
    return { base };
  }

  warn(
    `Unknown layout preset: "${layoutKey}". Valid presets: ${getPresetNames().join(", ")}. Using defaults.`,
  );
  return { base: {} };
}

/**
 * Layer config values: CLI overrides > project > global config > base preset.
 * Returns merged Partial<LayoutOptions>.
 */
function layerConfigValues(
  base: Partial<LayoutOptions>,
  cliOverrides: CLIOverrides,
  project: Map<string, string>,
  machineConfig: Map<string, string>,
): Partial<LayoutOptions> {
  const pick = (cli: string | undefined, projKey: string) =>
    pickConfigValue(cli, projKey, project, machineConfig);

  const editor = pick(cliOverrides.editor, "editor");
  const sidebar = pick(cliOverrides.sidebar, "sidebar");
  const secondaryEditor = pick(undefined, "secondary-editor");
  const panes = pick(cliOverrides.panes, "panes");
  const editorSize = pick(cliOverrides["editor-size"], "editor-size");
  const shell = pick(cliOverrides.shell, "shell");
  const autoResize = pick(cliOverrides["auto-resize"], "auto-resize");

  const result: Partial<LayoutOptions> = { ...base };
  if (editor !== undefined) result.editor = editor;
  if (sidebar !== undefined) result.sidebarCommand = sidebar;
  if (secondaryEditor !== undefined) result.secondaryEditor = secondaryEditor;
  if (panes !== undefined) {
    const parsed = parseIntInRange(panes, PANES_MIN);
    if (parsed.ok) {
      result.editorPanes = parsed.value;
    } else {
      warn(
        `Invalid panes value: "${panes}". Must be a positive integer. Using default (${PANES_DEFAULT}).`,
      );
      result.editorPanes = PANES_DEFAULT;
    }
  }
  if (editorSize !== undefined) {
    const parsed = parseIntInRange(editorSize, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
    if (parsed.ok) {
      result.editorSize = parsed.value;
    } else {
      warn(
        `Invalid editor-size value: "${editorSize}". Must be ${EDITOR_SIZE_MIN}-${EDITOR_SIZE_MAX}. Using default (${EDITOR_SIZE_DEFAULT}).`,
      );
      result.editorSize = EDITOR_SIZE_DEFAULT;
    }
  }
  if (shell !== undefined) result.shell = shell;
  if (autoResize !== undefined) result.autoResize = autoResize === "true";

  const fontSize = pick(cliOverrides["font-size"], "font-size");
  if (fontSize !== undefined) {
    const parsed = parsePositiveFloat(fontSize);
    if (parsed.ok) {
      result.fontSize = parsed.value;
    }
  }

  const newWindow = pick(cliOverrides["new-window"], "new-window");
  const newTab = pick(cliOverrides["new-tab"], "new-tab");
  const fullscreen = pick(cliOverrides.fullscreen, "fullscreen");
  const maximize = pick(cliOverrides.maximize, "maximize");
  const float = pick(cliOverrides.float, "float");
  if (newWindow !== undefined) result.newWindow = newWindow === "true";
  if (newTab !== undefined) result.newTab = newTab === "true";
  if (fullscreen !== undefined) result.fullscreen = fullscreen === "true";
  if (maximize !== undefined) result.maximize = maximize === "true";
  if (float !== undefined) result.float = float === "true";

  return result;
}

/**
 * `summonFileContent` is `readTrustedSummonFile`'s result: the `.summon` content that passed the trust check, read once
 * (TOCTOU prevention, BE-B2 #357; SE-M1). The file is never read here, so an untrusted `.summon` is never parsed.
 */
export function resolveConfig(targetDir: string, cliOverrides: CLIOverrides, summonFileContent: string | undefined): ResolvedConfig {
  const projectConfigPath = join(targetDir, ".summon");
  const skipProjectConfig = cliOverrides["no-project-config"] === "true";
  const project = skipProjectConfig || summonFileContent === undefined
    ? new Map<string, string>()
    : readKVFromString(summonFileContent);
  if (project.size > 0) {
    console.log(`Using project config: ${projectConfigPath}`);
  }
  const machineConfig = listConfig();

  const layoutKey = cliOverrides.layout ?? project.get("layout") ?? machineConfig.get("layout");
  const { base, treeLayout } = resolveLayoutBase(layoutKey);
  const opts = layerConfigValues(base, cliOverrides, project, machineConfig);

  const starshipPreset = pickConfigValue(cliOverrides["starship-preset"], "starship-preset", project, machineConfig);
  const onStart = pickConfigValue(cliOverrides["on-start"], "on-start", project, machineConfig);
  const onStop = pickConfigValue(undefined, "on-stop", project, machineConfig);
  const envVars = collectEnvVars(machineConfig, project, cliOverrides.env);

  // Merge per-pane cwds from project config into treeLayout (project overrides layout defaults)
  let mergedTreeLayout = treeLayout;
  if (mergedTreeLayout) {
    const projectCwds = extractPaneCwds(project);
    if (projectCwds.size > 0) {
      // BE-M2 (#593): validate cwd containment at ingestion so that a malicious .summon
      // file cannot inject an out-of-project path before resolveTreeCommands runs.
      for (const [_paneName, cwd] of projectCwds) {
        assertPaneCwdContained(targetDir, cwd);
      }
      const merged = new Map(mergedTreeLayout.paneCwds ?? []);
      for (const [k, v] of projectCwds) merged.set(k, v);
      mergedTreeLayout = { ...mergedTreeLayout, paneCwds: merged };
    }
  }

  return { opts, projectOverrides: project, machineConfig, starshipPreset, onStart, onStop, envVars, treeLayout: mergedTreeLayout };
}

/**
 * Read `.summon` once and verify that exact content is trusted (BE-B1, BE-B2 #357, SE-H1, SE-M1), so the bytes
 * hashed are the bytes parsed: pass the result to `resolveConfig`. Returns undefined with `--no-project-config`
 * (nothing is read) and "" when there is no file. Throws SummonError for an untrusted file.
 */
export function readTrustedSummonFile(targetDir: string, cliOverrides: CLIOverrides): string | undefined {
  if (cliOverrides["no-project-config"] === "true") return undefined;
  const summonFilePath = join(targetDir, ".summon");
  let content: string | undefined;
  try {
    content = readFileSync(summonFilePath, "utf-8");
  } catch {
    // No file (ENOENT), or one that cannot be read: the check below is the one for a directory without content.
    content = undefined;
  }
  if (content !== undefined) assertTrustedContent(targetDir, content);
  else assertTrusted(targetDir);
  // No file at check time is an empty project config, never a later read of whatever appears meanwhile.
  return content ?? "";
}
