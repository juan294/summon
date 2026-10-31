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

/** Process-controlled text for terminal output: controls and bidi overrides become `\uNNNN`. */
export function escapeControlChars(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex -- display process text without terminal control effects
    /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
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
  // eslint-disable-next-line no-control-regex -- user-authored titles cannot contain terminal or bidi controls
  if (/[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/.test(text))
    return "Title cannot contain control or bidi override/isolate characters.";
  return null;
}
