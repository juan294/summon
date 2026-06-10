import { supportsColor } from "../utils.js";
import { getDisplayWidth } from "./layout-preview.js";

function wrap(code: string, s: string): string {
  return supportsColor() ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export function bold(s: string): string {
  return wrap("1", s);
}

export function dim(s: string): string {
  return wrap("2", s);
}

export function green(s: string): string {
  return wrap("32", s);
}

export function red(s: string): string {
  return wrap("31", s);
}

export function yellow(s: string): string {
  return wrap("33", s);
}

export function cyan(s: string): string {
  return wrap("36", s);
}

export function invert(s: string): string {
  return wrap("7", s);
}

export function magenta(s: string): string {
  return wrap("35", s);
}

export function brightCyan(s: string): string {
  return wrap("96", s);
}

/** @internal — exported for testing only */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function trueColorFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** @internal — exported for testing only */
export function colorSwatch(colors: string[]): string {
  if (!supportsColor() || process.env.COLORTERM !== "truecolor" && process.env.COLORTERM !== "24bit") return "";
  return colors.map((hex) => `${trueColorFg(hex)}██\x1b[0m`).join("");
}

/**
 * Truncate a string to at most `width` display columns, appending an ellipsis if truncated.
 * Wide characters (CJK, emoji) count as 2 columns; all others count as 1.
 * The returned string always fits within `width` display columns.
 */
export function truncateLine(s: string, width: number): string {
  if (width <= 0) return "";
  if (getDisplayWidth(s) <= width) return s;
  // Walk codepoints, accumulating display width; stop when adding next char would exceed (width - 1)
  const ellipsisWidth = 1; // "…" is 1 display column
  const budget = width - ellipsisWidth;
  let accWidth = 0;
  let i = 0;
  let cutAt = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    const step = cp > 0xffff ? 2 : 1;
    const charWidth = isWideCodePoint(cp) ? 2 : 1;
    if (accWidth + charWidth > budget) break;
    accWidth += charWidth;
    cutAt = i + step;
    i += step;
  }
  return s.slice(0, cutAt) + "…";
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303f) ||
    (cp >= 0x3040 && cp <= 0x33bf) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xabff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x1f300 && cp <= 0x1ffff)
  );
}
