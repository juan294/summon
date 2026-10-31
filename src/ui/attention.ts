/**
 * attention.ts -- the D1 stderr watch (AR-M1, moved from backends/rex/launcher-tab.ts): whether a launch printed
 * anything the user must read. The Rex launcher-tab close reads it; a command that runs a child with inherited stdio
 * (the on-start hook, an installer) marks it. Without a started watch nothing is recorded.
 */
import { writingRoutine } from "./output.js";

let watching = false;
let attention = false;

/** @internal test hook */
export function resetAttentionForTests(): void {
  watching = false;
  attention = false;
}

/**
 * QA-M3: flag the watch for output it cannot see: a child that inherited stdio (the on-start hook, an installer) writes
 * to the terminal directly, so the tab stays for the user to read it. Without a watch (Ghostty, Rex from another terminal)
 * nothing changes.
 */
export function markAttention(): void {
  if (watching) attention = true;
}

/** Whether anything other than output marked routine reached stderr since the watch started. */
export function needsAttention(): boolean {
  return attention;
}

/**
 * Watch stderr from the start of a Rex launch made inside Rex: a note, a warning, an error or a skipped project
 * keeps the launcher tab open, so nothing the user must read disappears with it. Unknown output keeps the tab.
 */
export function watchForAttention(stream: NodeJS.WriteStream = process.stderr): void {
  if (watching) return;
  watching = true;
  const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    // D1: a write its source marked routine (note/err with `{ routine: true }`) and blank output pass; anything else is for the user.
    if (!writingRoutine() && text.trim() !== "") attention = true;
    return write(chunk, ...rest);
  }) as NodeJS.WriteStream["write"];
}
