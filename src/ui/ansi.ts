import { supportsColor } from "../utils.js";

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
 * Truncate a string to at most `width` characters, appending an ellipsis if truncated.
 * The returned string is always <= width characters (by codepoint count).
 */
export function truncateLine(s: string, width: number): string {
  if (width <= 0) return "";
  if (s.length <= width) return s;
  return s.slice(0, width - 1) + "…";
}
