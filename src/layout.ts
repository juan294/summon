/** Minimum number of editor panes. */
export const PANES_MIN = 1;

/** Default number of editor panes. */
export const PANES_DEFAULT = 2;

/** Minimum editor width percentage. */
export const EDITOR_SIZE_MIN = 1;

/** Maximum editor width percentage. */
export const EDITOR_SIZE_MAX = 99;

/** Default editor width percentage. */
export const EDITOR_SIZE_DEFAULT = 75;

export interface LayoutOptions {
  editor: string;
  editorPanes: number;
  editorSize: number;
  sidebarCommand: string;
  shell: string;
  secondaryEditor: string;
  autoResize: boolean;
  fontSize: number | null;
  newWindow: boolean;
  fullscreen: boolean;
  maximize: boolean;
  float: boolean;
}

const DEFAULT_OPTIONS: LayoutOptions = {
  editor: "claude",
  editorPanes: PANES_DEFAULT,
  editorSize: EDITOR_SIZE_DEFAULT,
  sidebarCommand: "lazygit",
  shell: "true",
  secondaryEditor: "",
  autoResize: true,
  fontSize: null,
  newWindow: false,
  fullscreen: false,
  maximize: false,
  float: false,
};

export interface LayoutPlan {
  editorSize: number;
  sidebarSize: number;
  leftColumnCount: number;
  rightColumnEditorCount: number;
  editor: string;
  sidebarCommand: string;
  hasShell: boolean;
  shellCommand: string | null;
  secondaryEditor: string | null;
  autoResize: boolean;
  fontSize: number | null;
  newWindow: boolean;
  fullscreen: boolean;
  maximize: boolean;
  float: boolean;
}

function parseShell(value: string): { hasShell: boolean; shellCommand: string | null } {
  if (value === "false" || value === "") {
    return { hasShell: false, shellCommand: null };
  }
  if (value === "true") {
    return { hasShell: true, shellCommand: null };
  }
  return { hasShell: true, shellCommand: value };
}

type PresetName = "minimal" | "full" | "pair" | "cli" | "btop";

const PRESETS: Record<PresetName, Partial<LayoutOptions>> = {
  minimal: { editorPanes: 1, shell: "false" },
  full: { editorPanes: 3, shell: "true" },
  pair: { editorPanes: 2, shell: "true" },
  cli: { editorPanes: 1, shell: "true" },
  btop: { editorPanes: 2, shell: "true", secondaryEditor: "btop" },
};

export function getPresetNames(): string[] {
  return Object.keys(PRESETS);
}

export function isPresetName(value: string): value is PresetName {
  return value in PRESETS;
}

export function getPreset(name: PresetName): Partial<LayoutOptions> {
  return PRESETS[name];
}

export function planLayout(partial?: Partial<LayoutOptions>): LayoutPlan {
  const opts = { ...DEFAULT_OPTIONS, ...partial };
  const leftColumnCount = Math.ceil(opts.editorPanes / 2);
  const { hasShell, shellCommand } = parseShell(opts.shell);
  return {
    editorSize: opts.editorSize,
    sidebarSize: 100 - opts.editorSize,
    leftColumnCount,
    rightColumnEditorCount: opts.editorPanes - leftColumnCount,
    editor: opts.editor,
    sidebarCommand: opts.sidebarCommand,
    hasShell,
    shellCommand,
    secondaryEditor: opts.secondaryEditor || null,
    autoResize: opts.autoResize,
    fontSize: opts.fontSize ?? null,
    newWindow: opts.newWindow,
    fullscreen: opts.fullscreen,
    maximize: opts.maximize,
    float: opts.float,
  };
}
