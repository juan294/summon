/**
 * Shared validation utilities for CLI argument parsing.
 *
 * Extracts the common `parseInt + isNaN + range check` pattern
 * into a reusable function.
 */

export type ParseIntResult = {
  ok: true;
  value: number;
} | {
  ok: false;
}

/**
 * Parse a string as an integer and validate it falls within [min, max].
 * Returns `{ ok: true, value }` on success, `{ ok: false }` on failure
 * (NaN, out of range, etc.).
 */
export function parseIntInRange(
  raw: string,
  min: number,
  max: number = Number.MAX_SAFE_INTEGER,
): ParseIntResult {
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}
