import { dim } from "./ansi.js";

/**
 * Returns the display width of a string in a fixed-width terminal font.
 * CJK characters and emoji (wide characters) count as 2 columns; all others count as 1.
 * Handles multi-codepoint characters via codePointAt iteration.
 *
 * Wide Unicode ranges: CJK Radicals / Hangul / Hiragana / Katakana / CJK Unified /
 * Yi / Hangul Syllables / CJK Compatibility Ideographs / CJK Compatibility Forms /
 * Halfwidth/Fullwidth Forms / Emoji & Misc Symbols (U+1F300+).
 *
 * @internal — exported for testing only
 */
export function getDisplayWidth(s: string): number {
  let width = 0;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    // Advance by surrogate pair (code points > 0xFFFF occupy 2 UTF-16 code units)
    i += cp > 0xffff ? 2 : 1;
    if (isWideCodePoint(cp)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303f) ||   // CJK Radicals Supplement … CJK Symbols
    (cp >= 0x3040 && cp <= 0x33bf) ||   // Hiragana, Katakana, Bopomofo, Hangul Compat, Kanbun, Bopomofo Ext, CJK Unified Ext
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK Unified Ideographs Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xabff) ||   // Yi Syllables, Yi Radicals, Lisu, Vai, ...
    (cp >= 0xac00 && cp <= 0xd7af) ||   // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK Compatibility Ideographs
    (cp >= 0xfe10 && cp <= 0xfe6f) ||   // CJK Compatibility Forms, Small Form Variants
    (cp >= 0xff00 && cp <= 0xffef) ||   // Halfwidth and Fullwidth Forms
    (cp >= 0x1f300 && cp <= 0x1ffff)    // Emoji, Misc Symbols, etc.
  );
}

const BOX = {
  topLeft:     "\u250c",
  topRight:    "\u2510",
  bottomLeft:  "\u2514",
  bottomRight: "\u2518",
  horizontal:  "\u2500",
  vertical:    "\u2502",
  teeDown:     "\u252c",
  teeUp:       "\u2534",
  teeRight:    "\u251c",
  teeLeft:     "\u2524",
  cross:       "\u253c",
} as const;

function boxTopBorder(colCount: number, colWidth: number): string {
  const segment = BOX.horizontal.repeat(colWidth);
  const parts: string[] = [];
  for (let c = 0; c < colCount; c++) parts.push(segment);
  return BOX.topLeft + parts.join(BOX.teeDown) + BOX.topRight;
}

function boxBottomBorder(colCount: number, colWidth: number): string {
  const segment = BOX.horizontal.repeat(colWidth);
  const parts: string[] = [];
  for (let c = 0; c < colCount; c++) parts.push(segment);
  return BOX.bottomLeft + parts.join(BOX.teeUp) + BOX.bottomRight;
}

function boxRowSeparator(
  colCount: number,
  colWidth: number,
  hasSplitAt: (c: number) => boolean,
): string {
  let sep = "";
  for (let c = 0; c < colCount; c++) {
    const hasSplit = hasSplitAt(c);
    if (c === 0) {
      sep += hasSplit ? BOX.teeRight : BOX.vertical;
    } else {
      const prevSplit = hasSplitAt(c - 1);
      if (prevSplit && hasSplit) sep += BOX.cross;
      else if (prevSplit) sep += BOX.teeLeft;
      else if (hasSplit) sep += BOX.teeRight;
      else sep += BOX.vertical;
    }
    sep += hasSplit ? BOX.horizontal.repeat(colWidth) : " ".repeat(colWidth);
  }
  const lastSplit = hasSplitAt(colCount - 1);
  sep += lastSplit ? BOX.teeLeft : BOX.vertical;
  return sep;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** @internal — exported for testing only */
export function visibleLength(s: string): number {
  let stripped = 0;
  ANSI_RE.lastIndex = 0;
  let match;
  while ((match = ANSI_RE.exec(s)) !== null) {
    stripped += match[0].length;
  }
  return s.length - stripped;
}

/** @internal — exported for testing only */
export function centerLabel(text: string, width: number): string {
  const maxLen = width - 2;
  const vis = visibleLength(text);
  const truncated = vis > maxLen;
  const label = truncated ? text.slice(0, maxLen - 1) + "\u2026" : text;
  const labelVis = truncated ? maxLen : vis;
  const leftPad = Math.floor((width - labelVis) / 2);
  const rightPad = width - labelVis - leftPad;
  const display = text === "?" ? dim(label) : label;
  return " ".repeat(leftPad) + display + " ".repeat(rightPad);
}

export function renderLayoutPreview(
  grid: string[][],
  maxWidth = 80,
): string {
  const COL_WIDTH = 14;
  const PANE_HEIGHT = 3;
  const colCount = grid.length;
  const maxRows = Math.max(...grid.map((col) => col.length));

  const clamp = (line: string): string =>
    maxWidth > 0 && line.length > maxWidth ? line.slice(0, maxWidth) : line;

  const lines: string[] = [];
  lines.push(clamp(boxTopBorder(colCount, COL_WIDTH)));

  for (let row = 0; row < maxRows; row++) {
    for (let lineInPane = 0; lineInPane < PANE_HEIGHT; lineInPane++) {
      let rowStr = "";
      for (let c = 0; c < colCount; c++) {
        const col = grid[c]!;
        const cmd = col[row] ?? "";
        rowStr += BOX.vertical;
        if (lineInPane === Math.floor(PANE_HEIGHT / 2) && cmd) {
          rowStr += centerLabel(cmd, COL_WIDTH);
        } else {
          rowStr += " ".repeat(COL_WIDTH);
        }
      }
      rowStr += BOX.vertical;
      lines.push(clamp(rowStr));
    }

    if (row < maxRows - 1) {
      lines.push(clamp(boxRowSeparator(colCount, COL_WIDTH, (c) => row + 1 < grid[c]!.length)));
    }
  }

  lines.push(clamp(boxBottomBorder(colCount, COL_WIDTH)));
  return lines.join("\n");
}

/** @internal — exported for testing only */
export function renderMiniPreview(columns: number[]): string[] {
  const COL_W = 5;
  const colCount = columns.length;
  const maxRows = Math.max(...columns);
  const lines: string[] = [];

  lines.push(boxTopBorder(colCount, COL_W));

  for (let row = 0; row < maxRows; row++) {
    let rowStr = "";
    for (let c = 0; c < colCount; c++) {
      rowStr += BOX.vertical;
      rowStr += " ".repeat(COL_W);
    }
    rowStr += BOX.vertical;
    lines.push(rowStr);

    if (row < maxRows - 1) {
      lines.push(boxRowSeparator(colCount, COL_W, (c) => row + 1 < columns[c]!));
    }
  }

  lines.push(boxBottomBorder(colCount, COL_W));
  return lines;
}

interface TemplatePreview {
  label: string;
  columns: number[];
}

/** @internal — exported for testing only */
export function renderTemplateGallery(
  templates: readonly TemplatePreview[],
  termWidth: number,
): string {
  if (templates.length === 0) return "";

  const previews = templates.map((t) => renderMiniPreview(t.columns));
  const previewWidth = previews[0]!.length > 0 ? previews[0]![0]!.length : 10;
  const prefixWidth = 4;
  const gapWidth = 5;
  const itemWidth = prefixWidth + previewWidth + gapWidth;
  const perRow = Math.max(1, Math.min(3, Math.floor(termWidth / itemWidth)));

  const outputLines: string[] = [];

  for (let rowStart = 0; rowStart < templates.length; rowStart += perRow) {
    const rowEnd = Math.min(rowStart + perRow, templates.length);
    const rowTemplates = templates.slice(rowStart, rowEnd);
    const rowPreviews = previews.slice(rowStart, rowEnd);
    const maxHeight = Math.max(...rowPreviews.map((p) => p.length));

    for (let line = 0; line < maxHeight; line++) {
      let rowStr = "";
      for (let i = 0; i < rowTemplates.length; i++) {
        const idx = rowStart + i;
        const preview = rowPreviews[i]!;
        const prefix = line === 0 ? `${idx + 1})  ` : "    ";
        const content = line < preview.length ? preview[line]! : " ".repeat(previewWidth);
        rowStr += prefix + content;
        if (i < rowTemplates.length - 1) {
          rowStr += " ".repeat(gapWidth);
        }
      }
      outputLines.push(rowStr);
    }

    let labelStr = "";
    for (let i = 0; i < rowTemplates.length; i++) {
      const t = rowTemplates[i]!;
      const label = t.label.padEnd(previewWidth);
      labelStr += "    " + label;
      if (i < rowTemplates.length - 1) {
        labelStr += " ".repeat(gapWidth);
      }
    }
    outputLines.push(labelStr);
    outputLines.push("");
  }

  outputLines.push(`${templates.length + 1})  Build from scratch`);
  return outputLines.join("\n");
}
