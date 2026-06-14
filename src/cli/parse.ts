import { parseArgs } from "node:util";
import type { CLIOverrides } from "../launcher.js";
import { PANES_MIN, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX } from "../layout.js";
import { validateIntFlag, validateFloatFlag } from "../validation.js";
import { getErrorMessage, exitWithUsageHint } from "../utils.js";
import { fail, err } from "../ui/output.js";
import { validateLayoutOrExit } from "../commands/layout-support.js";

export type ParsedValues = {
  help?: boolean;
  version?: boolean;
  layout?: string;
  editor?: string;
  panes?: string;
  "editor-size"?: string;
  sidebar?: string;
  shell?: string;
  "auto-resize"?: boolean;
  "no-auto-resize"?: boolean;
  "clean"?: boolean;
  "no-clean"?: boolean;
  "starship-preset"?: string;
  env?: string[];
  "font-size"?: string;
  "on-start"?: string;
  "new-window"?: boolean;
  "new-tab"?: boolean;
  "no-project-config"?: boolean;
  fullscreen?: boolean;
  maximize?: boolean;
  float?: boolean;
  fix?: boolean;
  vim?: boolean;
  once?: boolean;
  "dry-run"?: boolean;
  all?: boolean;
  verbose?: boolean;
};

export type ParsedCli = {
  values: ParsedValues;
  positionals: string[];
  subcommand?: string;
  args: string[];
};

const parseOpts = {
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    layout: { type: "string", short: "l" },
    editor: { type: "string", short: "e" },
    panes: { type: "string", short: "p" },
    "editor-size": { type: "string" },
    sidebar: { type: "string", short: "s" },
    // UX-L3 (#337): --shell is tri-value: "true" = always wrap in shell, "false" = direct exec (no shell wrapper), any other string = treat as the shell pane command (auto-detect per command by default).
    shell: { type: "string" },
    "auto-resize": { type: "boolean" },
    "no-auto-resize": { type: "boolean" },
    "clean": { type: "boolean" },
    "no-clean": { type: "boolean" },
    "starship-preset": { type: "string" },
    env: { type: "string", multiple: true },
    "font-size": { type: "string" },
    "on-start": { type: "string" },
    "new-window": { type: "boolean" },
    "new-tab": { type: "boolean" },
    "no-project-config": { type: "boolean" },
    fullscreen: { type: "boolean" },
    maximize: { type: "boolean" },
    float: { type: "boolean" },
    fix: { type: "boolean" },
    vim: { type: "boolean" },
    once: { type: "boolean" },
    "dry-run": { type: "boolean", short: "n" },
    all: { type: "boolean" },
    verbose: { type: "boolean" },
  },
} as const;

function safeParse(args: string[]): { values: ParsedValues; positionals: string[] } {
  try {
    const parsed = parseArgs({ ...parseOpts, args });
    return {
      values: parsed.values as ParsedValues,
      positionals: parsed.positionals,
    };
  } catch (caught) {
    const msg = getErrorMessage(caught);
    // UX-M3 (#396): transform raw parseArgs "Unknown option" into actionable message
    const unknownMatch = msg.match(/Unknown option\s+'?(--[A-Za-z0-9-]+)/);
    if (unknownMatch?.[1]) {
      fail(`Unknown flag '${unknownMatch[1]}'. Run 'summon --help' to see available flags.`);
    } else {
      fail(msg);
      if (msg.includes("ambiguous")) {
        err("Tip: To pass a value starting with '-', use '--flag=-value' syntax.");
      }
    }
    exitWithUsageHint();
  }
}

export function parseCli(argv: string[]): ParsedCli {
  const { values, positionals } = safeParse(argv);

  if (values.panes !== undefined) {
    validateIntFlag("panes", values.panes, PANES_MIN);
  }

  if (values["editor-size"] !== undefined) {
    validateIntFlag("editor-size", values["editor-size"], EDITOR_SIZE_MIN, EDITOR_SIZE_MAX);
  }

  if (values.env) {
    for (const entry of values.env) {
      if (!entry.includes("=")) {
        exitWithUsageHint(`--env must be in KEY=VALUE format, got "${entry}".`);
      }
    }
  }

  if (values["font-size"] !== undefined) {
    validateFloatFlag("font-size", values["font-size"]);
  }

  if (values.layout !== undefined) {
    validateLayoutOrExit(values.layout, "--layout");
  }

  if (values["auto-resize"] && values["no-auto-resize"]) {
    exitWithUsageHint("--auto-resize and --no-auto-resize are mutually exclusive");
  }
  if (values["clean"] && values["no-clean"]) {
    exitWithUsageHint("--clean and --no-clean are mutually exclusive");
  }
  if (values["new-window"] && values["new-tab"]) {
    exitWithUsageHint("--new-window and --new-tab are mutually exclusive");
  }

  const [subcommand, ...args] = positionals;
  return { values, positionals, subcommand, args };
}

export function buildOverrides(values: ParsedValues): CLIOverrides {
  const overrides: CLIOverrides = {};
  if (values.layout !== undefined) overrides.layout = values.layout;
  if (values.editor !== undefined) overrides.editor = values.editor;
  if (values.panes !== undefined) overrides.panes = values.panes;
  if (values["editor-size"] !== undefined) overrides["editor-size"] = values["editor-size"];
  if (values.sidebar !== undefined) overrides.sidebar = values.sidebar;
  if (values.shell !== undefined) overrides.shell = values.shell;
  if (values["auto-resize"] !== undefined) overrides["auto-resize"] = "true";
  if (values["no-auto-resize"] !== undefined) overrides["auto-resize"] = "false";
  if (values["clean"] !== undefined) overrides.clean = "true";
  if (values["no-clean"] !== undefined) overrides.clean = "false";
  if (values["starship-preset"] !== undefined) overrides["starship-preset"] = values["starship-preset"];
  if (values.env !== undefined) overrides.env = values.env;
  if (values["font-size"] !== undefined) overrides["font-size"] = values["font-size"];
  if (values["on-start"] !== undefined) overrides["on-start"] = values["on-start"];
  if (values["new-window"] !== undefined) overrides["new-window"] = "true";
  if (values["new-tab"] !== undefined) overrides["new-tab"] = "true";
  if (values["no-project-config"] !== undefined) overrides["no-project-config"] = "true";
  if (values.fullscreen !== undefined) overrides.fullscreen = "true";
  if (values.maximize !== undefined) overrides.maximize = "true";
  if (values.float !== undefined) overrides.float = "true";
  if (values["dry-run"] !== undefined) overrides.dryRun = true;
  return overrides;
}
