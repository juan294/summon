/**
 * setup-gallery.ts — Template gallery data for the setup wizard.
 *
 * Contains the preset layout descriptors and grid template definitions
 * used by the visual layout builder. Extracted from setup.ts (AR-S2 #317).
 */

// ---------------------------------------------------------------------------
// Preset layout descriptors (named layouts with diagram previews)
// ---------------------------------------------------------------------------

export const LAYOUT_INFO: Record<string, { desc: string; diagram: string }> = {
  minimal: {
    desc: "Single editor + sidebar",
    diagram: [
      "  ┌────────┬──────┐",
      "  │ editor │ side │",
      "  └────────┴──────┘",
    ].join("\n"),
  },
  pair: {
    desc: "Two editors + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │        │ editor │      │",
      "  │ editor ├────────┤ side │",
      "  │        │ shell  │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  full: {
    desc: "Three editors + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ editor │ side │",
      "  ├────────┼────────┤      │",
      "  │ editor │ shell  │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  cli: {
    desc: "Single editor + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │ editor │ shell  │ side │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
  btop: {
    desc: "Editor + system monitor + sidebar + shell",
    diagram: [
      "  ┌────────┬────────┬──────┐",
      "  │        │  btop  │      │",
      "  │ editor ├────────┤ side │",
      "  │        │ shell  │      │",
      "  └────────┴────────┴──────┘",
    ].join("\n"),
  },
};

// ---------------------------------------------------------------------------
// Grid template definitions for the visual layout builder
// ---------------------------------------------------------------------------

export interface GridTemplate {
  label: string;       // display name, e.g., "2 + 1"
  columns: number[];   // pane count per column (sidebar always appended)
}

export const GRID_TEMPLATES: readonly GridTemplate[] = [
  { label: "1 + 1",     columns: [1, 1] },
  { label: "2 + 1",     columns: [2, 1] },
  { label: "1 + 1 + 1", columns: [1, 1, 1] },
  { label: "1 + 2",     columns: [1, 2] },
  { label: "1 + 2 + 1", columns: [1, 2, 1] },
  { label: "2 + 2",     columns: [2, 2] },
  { label: "2 + 1 + 1", columns: [2, 1, 1] },
];
