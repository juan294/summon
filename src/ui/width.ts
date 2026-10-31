/**
 * Low-level terminal display-width primitives.
 *
 * Kept as a leaf module (no imports from other ui/ files) to break the
 * circular dependency between ansi.ts and layout-preview.ts (AR-M2 #589).
 *
 * Rule: this file must only import from node:* or other stdlib — never from
 * sibling ui/ files or project modules.
 */

/** Emoji that terminals draw 2 columns wide by default (Unicode Emoji_Presentation). */
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
/** An emoji base followed by VS16 asks for the 2-column emoji form (for example U+2764 U+FE0F). */
const EMOJI_VS16 = /\p{Emoji}\uFE0F/u;
/** Combining marks, format characters (ZWJ, ZWSP, bidi marks), variation selectors and Hangul medial/final Jamo. */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\u1160-\u11FF]$/u;
/** Printable ASCII only: every character is 1 column, so no segmentation is needed. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** Created on first non-ASCII text: constructing it costs several ms, which every command would pay at import. */
let segmenter: Intl.Segmenter | undefined;
function graphemes(s: string): Intl.Segments {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return segmenter.segment(s);
}

/**
 * Returns true for a code point that occupies 2 columns in a fixed-width terminal font.
 *
 * East Asian Wide ranges:
 *   Hangul Jamo (1100–115F) · CJK Radicals/Symbols (2E80–303F) ·
 *   Hiragana/Katakana/Bopomofo (3040–33BF) · CJK Extension A (3400–4DBF) ·
 *   CJK Unified Ideographs (4E00–9FFF) · Yi/Lisu/Vai (A000–ABFF) ·
 *   Hangul Syllables (AC00–D7AF) · CJK Compat Ideographs (F900–FAFF) ·
 *   CJK Compat Forms/Small Forms (FE10–FE6F) · Halfwidth/Fullwidth (FF00–FFEF) ·
 *   CJK Extension B and later (20000–3FFFD)
 * plus every Emoji_Presentation code point (U+2728, U+2705, U+231A, U+1F680, ...).
 * Text-presentation symbols (U+26A0, U+2713, U+2764) stay 1 column.
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
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    (cp >= 0x2300 && EMOJI_PRESENTATION.test(String.fromCodePoint(cp)))
  );
}

/**
 * Columns of one grapheme cluster: 2 when any code point is wide or it is a VS16 emoji,
 * 0 when every code point is zero-width (a lone combining mark), else 1.
 */
function graphemeWidth(cluster: string): number {
  if (EMOJI_VS16.test(cluster)) return 2;
  let width = 0;
  for (const ch of cluster) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isWideCodePoint(cp)) return 2;
    if (!ZERO_WIDTH.test(ch)) width = 1;
  }
  return width;
}

/**
 * Returns the display width of a string in a fixed-width terminal font, one grapheme at a time:
 * CJK and emoji count 2 columns, combining marks, ZWJ and variation selectors 0, all others 1.
 * A ZWJ sequence or a flag is one grapheme, so it counts 2.
 */
export function getDisplayWidth(s: string): number {
  if (PRINTABLE_ASCII.test(s)) return s.length;
  let width = 0;
  for (const { segment } of graphemes(s)) width += graphemeWidth(segment);
  return width;
}

/**
 * Truncate a string to at most `maxLen` display columns, appending "…" if truncated.
 * Widths follow getDisplayWidth, and the cut never falls inside a grapheme.
 * The returned string always fits within `maxLen` display columns.
 *
 * This is the single canonical implementation shared by monitor.ts and ui/ansi.ts.
 */
export function truncate(str: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (getDisplayWidth(str) <= maxLen) return str;
  if (PRINTABLE_ASCII.test(str)) return str.slice(0, maxLen - 1) + "…";
  // Reserve 1 column for the ellipsis "…"
  const budget = maxLen - 1;
  let accWidth = 0;
  let cutAt = 0;
  for (const { segment, index } of graphemes(str)) {
    accWidth += graphemeWidth(segment);
    if (accWidth > budget) break;
    cutAt = index + segment.length;
  }
  return str.slice(0, cutAt) + "…";
}
