/**
 * trust.ts — workspace trust management (stub for WU-1 integration).
 *
 * The full implementation is provided by the WU-1 parallel work stream.
 * This stub ensures the trust subcommand wiring in index.ts type-checks
 * before WU-1's implementation is merged.
 */

/**
 * Mark a project directory as trusted so summon can operate on it.
 * Full implementation provided by WU-1.
 */
export function trustProject(dir: string): void {
  console.error(`Error: 'summon trust' is not yet available. Directory: ${dir}`);
  process.exit(1);
}
