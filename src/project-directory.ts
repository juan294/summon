import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { escapeControlChars } from "./ui/sanitize.js";

/** Existing symlinks may name the same checkout. An unreadable, different path cannot establish that identity. */
export function sameProjectDirectory(left: string, right: string): boolean {
  if (resolve(left) === resolve(right)) return true;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

export function workspaceDirectoryConflict(project: string, existing: string, requested: string): string {
  return `Workspace [${escapeControlChars(project)}] belongs to ${escapeControlChars(existing)}. Register ${escapeControlChars(requested)} under a different name with 'summon add <name> <path>'.`;
}
