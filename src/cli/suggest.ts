// Phase 6 Unit A (D7): "did you mean" suggestions for a mistyped project name.
// Pure: the caller supplies the registered names and a lazy launch-recency lookup
// (name -> epoch ms of the last recorded launch), consulted only for names that match.
import { editDistance } from "../edit-distance.js";

/** A suggested launch target: a registered project, or a subcommand (UX-M3) printed as `summon <name>`. */
export interface Suggestion {
  name: string;
  command: boolean;
}

/** Most suggestions printed on one line. */
export const MAX_SUGGESTIONS = 3;
/** Largest edit distance that still counts as a near miss. */
const MAX_EDIT_DISTANCE = 2;
/** Names shorter than this never match by edit distance (too many false positives). */
const MIN_EDIT_DISTANCE_NAME_LENGTH = 4;

export type LaunchRecency = (name: string) => number | undefined;

/**
 * Suggest registered names close to `target`, best first, at most MAX_SUGGESTIONS.
 * Tiers: exact prefix, case-insensitive prefix, subsequence (fzf-style), then
 * bounded Damerau-Levenshtein distance for names of four or more characters.
 * Inside a tier the most recently launched name comes first, then alphabetical.
 * A one-character target gets no suggestions; an exact match is never suggested.
 */
export function suggestProjects(target: string, names: readonly string[], recency: LaunchRecency): string[] {
  if (target.length < 2) return [];
  const lower = target.toLowerCase();
  const matches: Array<{ name: string; tier: number }> = [];
  for (const name of names) {
    if (name === target) continue;
    const tier = matchTier(target, lower, name);
    if (tier !== null) matches.push({ name, tier });
  }
  const launchedAt = new Map<string, number>();
  const recencyOf = (name: string): number => {
    let at = launchedAt.get(name);
    if (at === undefined) launchedAt.set(name, (at = recency(name) ?? 0));
    return at;
  };
  return matches
    .sort((a, b) => a.tier - b.tier || recencyOf(b.name) - recencyOf(a.name) || a.name.localeCompare(b.name, "en"))
    .slice(0, MAX_SUGGESTIONS)
    .map((m) => m.name);
}

/**
 * Suggest subcommands and registered projects close to `target` in one ranking (UX-M3). A name that is
 * both is the command (the dispatch registry wins), and a command has no launch recency. A command is
 * a candidate only for a close match (a prefix, or one edit away): the looser tiers would turn
 * `summon docs` into `summon focus`.
 */
export function suggestTargets(target: string, projects: readonly string[], commands: readonly string[], recency: LaunchRecency): Suggestion[] {
  const commandSet = new Set(commands);
  const lower = target.toLowerCase();
  const closeCommands = [...commandSet].filter((name) => name.startsWith(lower) || editDistance(lower, name) <= 1);
  const names = [...closeCommands, ...projects.filter((name) => !commandSet.has(name))];
  return suggestProjects(target, names, (name) => (commandSet.has(name) ? undefined : recency(name)))
    .map((name) => ({ name, command: commandSet.has(name) }));
}

/** The single "Did you mean" line: commands as `summon <name>`, projects by their bare name. */
export function didYouMean(suggestions: readonly Suggestion[]): string {
  return `Did you mean: ${suggestions.map((s) => (s.command ? `summon ${s.name}` : s.name)).join(", ")}?`;
}

function matchTier(target: string, lowerTarget: string, name: string): number | null {
  if (name.startsWith(target)) return 0;
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith(lowerTarget)) return 1;
  if (isSubsequence(lowerTarget, lowerName)) return 2;
  if (name.length >= MIN_EDIT_DISTANCE_NAME_LENGTH && Math.abs(name.length - target.length) <= MAX_EDIT_DISTANCE
    && editDistance(lowerTarget, lowerName) <= MAX_EDIT_DISTANCE) return 3;
  return null;
}

/** True when every character of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const ch of needle) {
    at = haystack.indexOf(ch, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}
