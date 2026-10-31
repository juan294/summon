// PE-H1 (#473): Leaf module with no launcher.ts dependency.
// Extracted from commands/project.ts so that index.ts can import resolveTargetDirectory
// without pulling in the full launch/AppleScript graph.
import { resolve } from "node:path";
import { homedir } from "node:os";
import { listProjects } from "../config.js";
import { readStatusRecord } from "../status-record.js";
import { fail, err } from "../ui/output.js";
import { didYouMean, suggestProjects, suggestTargets } from "./suggest.js";

export function expandHome(path: string): string {
  return resolve(path.replace(/^~/, homedir()));
}

/**
 * Resolve a launch target. `commands` are the dispatch registry's subcommand names: a target that
 * is none of them and no registered project gets them as suggestions too (UX-M3).
 */
export function resolveTargetDirectory(target: string, commands: readonly string[] = []): string {
  if (target === "." || target === "..") {
    return resolve(target);
  }
  if (target.startsWith("/") || target.startsWith("~")) {
    return expandHome(target);
  }
  if (target.startsWith("./") || target.startsWith("../") || target.includes("/")) {
    return resolve(target);
  }

  const projects = listProjects();
  const projectPath = projects.get(target);
  if (!projectPath) {
    const suggestions = suggestTargets(target, [...projects.keys()], commands, lastLaunchAt);
    fail(`"${target}" is not a known command or registered project. Try: summon --help`);
    if (suggestions.length > 0) err(didYouMean(suggestions));
    // A mistyped command is not a project to register.
    const commandFirst = suggestions[0]?.command === true;
    if (!commandFirst) err(`To register as a project: summon add ${target} /path/to/project`);
    if (!suggestions.some((s) => s.command && s.name === "list")) {
      err(commandFirst ? "Or see available: summon list" : "Or see available:         summon list");
    }
    process.exit(1);
  }

  return projectPath;
}

/**
 * Registered names close to a mistyped `target`, best first (D7). Recency comes from the
 * status record JSON of the matching names only: no liveness, no Rex probes, no adoption.
 */
export function projectSuggestions(target: string, names: Iterable<string> = listProjects().keys()): string[] {
  return suggestProjects(target, [...names], lastLaunchAt);
}

/**
 * UX-M3: after an error naming a project that is not registered, the closest registered names (stderr).
 * `named` labels the line with the target, for an error that lists several unknown names.
 */
export function printProjectSuggestions(target: string, named = false): void {
  const names = [...listProjects().keys()];
  if (names.includes(target)) return;
  const suggestions = projectSuggestions(target, names);
  if (suggestions.length === 0) return;
  const list = suggestions.join(", ");
  err(named ? `For ${target}, did you mean: ${list}?` : `Did you mean: ${list}?`);
}

function lastLaunchAt(name: string): number | undefined {
  const record = readStatusRecord(name);
  if (!record) return undefined;
  const at = Date.parse(record.startedAt);
  return Number.isFinite(at) ? at : undefined;
}
