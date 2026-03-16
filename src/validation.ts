/**
 * Shared validation utilities for CLI argument parsing.
 *
 * Extracts the common `parseInt + isNaN + range check` pattern
 * into a reusable function.
 */

type ParseResult = {
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
): ParseResult {
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

/**
 * Parse a string as a float and validate it is positive (> 0).
 * Returns `{ ok: true, value }` on success, `{ ok: false }` on failure
 * (NaN, zero, negative, etc.).
 */
export function parsePositiveFloat(raw: string): ParseResult {
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

/**
 * Validate a numeric CLI flag at parse time.
 * Exits with a standardized error if invalid.
 * Returns the parsed value on success.
 */
export function validateIntFlag(
  flagName: string,
  value: string,
  min: number,
  max?: number,
): number {
  const result = parseIntInRange(value, min, max);
  if (!result.ok) {
    const rangeDesc = max !== undefined
      ? `an integer between ${min}-${max}`
      : "a positive integer";
    console.error(`Error: --${flagName} must be ${rangeDesc}, got "${value}".`);
    console.error("Run 'summon --help' for usage information.");
    process.exit(1);
  }
  return result.value;
}

/**
 * Validate a positive float CLI flag at parse time.
 * Exits with a standardized error if invalid.
 * Returns the parsed value on success.
 */
export function validateFloatFlag(
  flagName: string,
  value: string,
): number {
  const result = parsePositiveFloat(value);
  if (!result.ok) {
    console.error(`Error: --${flagName} must be a positive number, got "${value}".`);
    console.error("Run 'summon --help' for usage information.");
    process.exit(1);
  }
  return result.value;
}
