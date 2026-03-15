/**
 * Shared validation utilities for CLI argument parsing.
 *
 * Extracts the common `parseInt + isNaN + range check` pattern
 * into a reusable function.
 */

type ParseIntResult = {
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
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed <= 0) {
    console.error(`Error: --${flagName} must be a positive number, got "${value}".`);
    console.error("Run 'summon --help' for usage information.");
    process.exit(1);
  }
  return parsed;
}
