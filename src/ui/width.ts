/**
 * Low-level terminal display-width primitives.
 *
 * Kept as a leaf module (no imports from other ui/ files) to break the
 * circular dependency between ansi.ts and layout-preview.ts (AR-M2 #589).
 *
 * Rule: this file must only import from node:* or other stdlib — never from
 * sibling ui/ files or project modules.
 */

/**
 * Returns the display width of a code point in a fixed-width terminal font.
 * Wide characters (CJK, emoji, fullwidth) occupy 2 columns; all others occupy 1.
 *
 * Wide Unicode ranges:
 *   Hangul Jamo (1100–115F) · CJK Radicals/Symbols (2E80–303F) ·
 *   Hiragana/Katakana/Bopomofo (3040–33BF) · CJK Extension A (3400–4DBF) ·
 *   CJK Unified Ideographs (4E00–9FFF) · Yi/Lisu/Vai (A000–ABFF) ·
 *   Hangul Syllables (AC00–D7AF) · CJK Compat Ideographs (F900–FAFF) ·
 *   CJK Compat Forms/Small Forms (FE10–FE6F) · Halfwidth/Fullwidth (FF00–FFEF) ·
 *   Emoji & Misc Symbols (1F300–1FFFF)
 */
export function isWideCodePoint(cp: number): boolean {
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

/**
 * Returns the display width of a string in a fixed-width terminal font.
 * CJK characters and emoji (wide characters) count as 2 columns; all others count as 1.
 * Handles multi-codepoint characters via codePointAt iteration.
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

/**
 * Truncate a string to at most `maxLen` display columns, appending "…" if truncated.
 * Wide characters (CJK, emoji) count as 2 display columns; all others count as 1.
 * The returned string always fits within `maxLen` display columns.
 *
 * This is the single canonical implementation shared by monitor.ts and ui/ansi.ts.
 */
export function truncate(str: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (getDisplayWidth(str) <= maxLen) return str;
  // Reserve 1 column for the ellipsis "…"
  const budget = maxLen - 1;
  let accWidth = 0;
  let i = 0;
  let cutAt = 0;
  while (i < str.length) {
    const cp = str.codePointAt(i);
    if (cp === undefined) break;
    const step = cp > 0xffff ? 2 : 1;
    const charWidth = isWideCodePoint(cp) ? 2 : 1;
    if (accWidth + charWidth > budget) break;
    accWidth += charWidth;
    cutAt = i + step;
    i += step;
  }
  return str.slice(0, cutAt) + "…";
}
