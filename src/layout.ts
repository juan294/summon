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
  server: string;
  secondaryEditor: string;
  autoResize: boolean;
}

const DEFAULT_OPTIONS: LayoutOptions = {
  editor: "claude",
  editorPanes: PANES_DEFAULT,
  editorSize: EDITOR_SIZE_DEFAULT,
  sidebarCommand: "lazygit",
  server: "true",
  secondaryEditor: "",
  autoResize: true,
};

export interface LayoutPlan {
  editorSize: number;
  sidebarSize: number;
  leftColumnCount: number;
  rightColumnEditorCount: number;
  editor: string;
  sidebarCommand: string;
  hasServer: boolean;
  serverCommand: string | null;
  secondaryEditor: string | null;
  autoResize: boolean;
}

function parseServer(value: string): { hasServer: boolean; serverCommand: string | null } {
  if (value === "false" || value === "") {
    return { hasServer: false, serverCommand: null };
  }
  if (value === "true") {
    return { hasServer: true, serverCommand: null };
  }
  return { hasServer: true, serverCommand: value };
}

type PresetName = "minimal" | "full" | "pair" | "cli" | "btop";

const PRESETS: Record<PresetName, Partial<LayoutOptions>> = {
  minimal: { editorPanes: 1, server: "false" },
  full: { editorPanes: 3, server: "true" },
  pair: { editorPanes: 2, server: "true" },
  cli: { editorPanes: 1, server: "true" },
  btop: { editorPanes: 2, server: "true", secondaryEditor: "btop" },
};

export function isPresetName(value: string): value is PresetName {
  return value in PRESETS;
}

export function getPreset(name: PresetName): Partial<LayoutOptions> {
  return PRESETS[name];
}

export function planLayout(partial?: Partial<LayoutOptions>): LayoutPlan {
  const opts = { ...DEFAULT_OPTIONS, ...partial };
  const leftColumnCount = Math.ceil(opts.editorPanes / 2);
  const { hasServer, serverCommand } = parseServer(opts.server);
  return {
    editorSize: opts.editorSize,
    sidebarSize: 100 - opts.editorSize,
    leftColumnCount,
    rightColumnEditorCount: opts.editorPanes - leftColumnCount,
    editor: opts.editor,
    sidebarCommand: opts.sidebarCommand,
    hasServer,
    serverCommand,
    secondaryEditor: opts.secondaryEditor || null,
    autoResize: opts.autoResize,
  };
}
