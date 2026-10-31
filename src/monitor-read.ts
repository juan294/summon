/**
 * monitor-read.ts -- the child side of the monitor's status read (PE-H1).
 *
 * A leaf module: the CLI entry imports the hidden flag from here without loading the status code,
 * which the child imports only when it reads. The TUI lives in monitor.ts.
 */

/**
 * Hidden argv: the monitor starts this same CLI with it to read the statuses in a child process.
 * A Rex read spawns `rex` synchronously (up to 10 s per call), so it never runs on the TUI's thread.
 */
export const MONITOR_READ_ARG = "--internal-monitor-read";

/** The `rex` binary the monitor resolved once, handed to each child read so the child does not look it up again. */
export const MONITOR_REX_BINARY_ENV = "SUMMON_MONITOR_REX_BINARY";

/** What the monitor reads: every row, with the Rex program status, reconciling as every status read does. */
export const MONITOR_READ_OPTIONS = { programStatus: true, reconcile: true } as const;

/** The child side of MONITOR_READ_ARG: one status read, as JSON on stdout. */
export async function writeMonitorRead(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { readAllStatuses, seedRexBinaryPath } = await import("./status.js");
  const rexBinary = env[MONITOR_REX_BINARY_ENV];
  if (rexBinary) seedRexBinaryPath(rexBinary);
  process.stdout.write(JSON.stringify(readAllStatuses(MONITOR_READ_OPTIONS)));
}
