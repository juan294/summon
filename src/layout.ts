export interface LayoutOptions {
  editor: string;
  editorPanes: number;
  editorSize: number;
  sidebarCommand: string;
  server: string;
  secondaryEditor: string;
}

const DEFAULT_OPTIONS: LayoutOptions = {
  editor: "claude",
  editorPanes: 3,
  editorSize: 75,
  sidebarCommand: "lazygit",
  server: "true",
  secondaryEditor: "",
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

export type PresetName = "minimal" | "full" | "pair" | "cli" | "mtop";

const PRESETS: Record<PresetName, Partial<LayoutOptions>> = {
  minimal: { editorPanes: 1, server: "false" },
  full: { editorPanes: 3, server: "true" },
  pair: { editorPanes: 2, server: "true" },
  cli: { editorPanes: 1, server: "npm login" },
  mtop: { editorPanes: 2, server: "true", secondaryEditor: "mtop" },
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
  };
}
