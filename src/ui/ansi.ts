import { supportsColor } from "../utils.js";
import { truncate } from "./width.js";

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

/** Convert an 8-bit RGB channel value (0–255) to the nearest index in the 0–5 cube axis. */
function rgbTo6(v: number): number {
  return Math.round((v / 255) * 5);
}

/** Approximate an RGB color as a 256-color palette index (16–231 color cube). */
function rgbTo256(r: number, g: number, b: number): number {
  return 16 + 36 * rgbTo6(r) + 6 * rgbTo6(g) + rgbTo6(b);
}

/** @internal — exported for testing only */
export function colorSwatch(colors: string[]): string {
  if (!supportsColor()) return "";
  const isTrueColor = process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit";
  if (isTrueColor) {
    return colors.map((hex) => `${trueColorFg(hex)}██\x1b[0m`).join("");
  }
  // 256-color fallback: approximate each hex color in the 6×6×6 color cube
  return colors.map((hex) => {
    const [r, g, b] = hexToRgb(hex);
    const idx = rgbTo256(r, g, b);
    return `\x1b[38;5;${idx}m▉\x1b[0m`;
  }).join("");
}

/**
 * Truncate a string to at most `width` display columns, appending an ellipsis if truncated.
 * Wide characters (CJK, emoji) count as 2 columns; all others count as 1.
 * The returned string always fits within `width` display columns.
 *
 * Delegates to the shared `truncate` implementation in ui/width.ts (#578).
 */
export function truncateLine(s: string, width: number): string {
  return truncate(s, width);
}
