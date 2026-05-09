/**
 * Shell and AppleScript escape primitives.
 *
 * INVARIANT: every outbound interpolation into a shell, AppleScript, or
 * osascript context must route through one of these helpers. Direct
 * template-literal interpolation of an untrusted or caller-supplied value
 * is a bug. The structural test in shell-escape.lint.test.ts enforces this
 * at CI time.
 */

/** Escape a value for embedding inside an AppleScript double-quoted string literal. */
export function escapeAppleScript(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** POSIX single-quote escaping: wrap in single quotes, escape embedded single quotes. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape a value for embedding inside a shell double-quoted string ("...").
 * Escapes \, ", $, and ` so the surrounding "..." context stays intact.
 */
export function shellDoubleQuote(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}
