/**
 * Text safety shared by both backends (AR-L1): bounded control-free text for names and labels, process-controlled
 * text escaped for terminal output, and user-authored titles.
 */
import { CONTROL_CHARS_RE } from "../utils.js";

/** Bounded, control-free text for names and labels that end up in native selectors or titles. */
export const MAX_TEXT_LENGTH = 256;
export function isPlainText(value: unknown, options: { allowEmpty?: boolean } = {}): value is string {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || CONTROL_CHARS_RE.test(value)) return false;
  return options.allowEmpty === true || value.length > 0;
}

/**
 * The class body of the characters that drive or reorder a terminal: C0, DEL and C1 controls, bidi overrides and
 * isolates. Written with `\u` escapes; raw bidi characters never appear in source.
 */
const CONTROL_OR_BIDI_CLASS = "\\x00-\\x1f\\x7f-\\x9f\\u202a-\\u202e\\u2066-\\u2069";
const CONTROL_OR_BIDI_RE = new RegExp(`[${CONTROL_OR_BIDI_CLASS}]`);
const CONTROL_OR_BIDI_GLOBAL_RE = new RegExp(`[${CONTROL_OR_BIDI_CLASS}]`, "g");

/** One BMP character as the six printable characters `\uNNNN` (a `replace` callback). */
export function unicodeEscape(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/** Process-controlled text for terminal output: controls and bidi overrides become `\uNNNN`. */
export function escapeControlChars(text: string): string {
  return text.replace(CONTROL_OR_BIDI_GLOBAL_RE, unicodeEscape);
}

/** Plain text that also prints unchanged (no controls, no bidi overrides): server ids Summon shows. */
export function isDisplaySafe(value: unknown): value is string {
  return isPlainText(value) && escapeControlChars(value) === value;
}

/** Validation is shared by the CLI and native emitter; existing titles are read verbatim via JSON. */
export function validateTitleText(text: string): string | null {
  if (text.length === 0)
    return "Empty title is invalid; use --reset to clear the override.";
  if ([...text].length > 256)
    return "Title must be at most 256 Unicode codepoints.";
  // User-authored titles cannot contain terminal or bidi controls.
  if (CONTROL_OR_BIDI_RE.test(text))
    return "Title cannot contain control or bidi override/isolate characters.";
  return null;
}
