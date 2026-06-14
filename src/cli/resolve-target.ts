// PE-H1 (#473): Leaf module with no launcher.ts dependency.
// Extracted from commands/project.ts so that index.ts can import resolveTargetDirectory
// without pulling in the full launch/AppleScript graph.
import { resolve } from "node:path";
import { homedir } from "node:os";
import { getProject } from "../config.js";
import { fail, err } from "../ui/output.js";

export function expandHome(path: string): string {
  return resolve(path.replace(/^~/, homedir()));
}

export function resolveTargetDirectory(target: string): string {
  if (target === "." || target === "..") {
    return resolve(target);
  }
  if (target.startsWith("/") || target.startsWith("~")) {
    return expandHome(target);
  }
  if (target.startsWith("./") || target.startsWith("../") || target.includes("/")) {
    return resolve(target);
  }

  const projectPath = getProject(target);
  if (!projectPath) {
    fail(`"${target}" is not a known command or registered project. Try: summon --help`);
    err(`To register as a project: summon add ${target} /path/to/project`);
    err("Or see available:         summon list");
    process.exit(1);
  }

  return projectPath;
}
