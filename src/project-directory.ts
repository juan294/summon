import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { escapeControlChars } from "./ui/sanitize.js";

/**
 * Existing symlinks may name the same checkout, and so may another letter case on a case-insensitive disk (realpath keeps
 * the case as typed there, so the device and inode decide). An unreadable, different path cannot establish that identity.
 */
export function sameProjectDirectory(left: string, right: string): boolean {
  if (resolve(left) === resolve(right)) return true;
  try {
    if (realpathSync(left) === realpathSync(right)) return true;
    const a = statSync(left, { bigint: true });
    const b = statSync(right, { bigint: true });
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

export function workspaceDirectoryConflict(project: string, existing: string, requested: string): string {
  return `Workspace [${escapeControlChars(project)}] belongs to ${escapeControlChars(existing)}. Register ${escapeControlChars(requested)} under a different name with 'summon add <name> <path>'.`;
}
