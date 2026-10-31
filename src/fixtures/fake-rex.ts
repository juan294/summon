import { chmodSync, writeFileSync } from "node:fs";

/**
 * Write an executable fake `rex` at `file`: a Node script (`body`, CommonJS) run by this test process's node. Each
 * suite keeps its own body: the hermetic suite simulates a server, others answer one or two operations.
 */
export function writeFakeRex(file: string, body: string): void {
  writeFileSync(file, `#!${process.execPath}\n${body}`);
  chmodSync(file, 0o755);
}
