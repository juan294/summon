import type { CommandContext } from "./types.js";
import { readStatus } from "../status.js";
import { readStatusRecord } from "../status-record.js";
import { focusWorkspace } from "../workspace-focus.js";
import { validateTitleText } from "../ui/sanitize.js";
import { projectArgOrExit } from "../validation.js";
import { escapeControlChars } from "../ui/sanitize.js";
import { workspaceBackendFor } from "../backends/workspace.js";
import { exitWithUsageHint } from "../utils.js";
import { fail } from "../ui/output.js";
import { printProjectSuggestions } from "../cli/resolve-target.js";

const projectArg = projectArgOrExit;
export async function handleFocusCommand({
  args,
}: CommandContext): Promise<void> {
  const project = projectArg(args, 2, "Usage: summon focus <project> [pane]");
  const result = focusWorkspace(project, args[1]);
  if (result.kind !== "focused") {
    fail(result.reason);
    // UX-M3: a name Summon has never launched may be a typo of a registered project.
    if (!readStatusRecord(project)) printProjectSuggestions(project);
    process.exit(2);
  }
  console.log(`Focused [${project}]${args[1] ? ` ${args[1]}` : ""}`);
}

/** `summon inspect`: the record's own backend prints it (Ghostty terminal ids, Rex block ids) and exits 2 when unavailable. */
export async function handleInspectCommand({
  args,
  values,
}: CommandContext): Promise<void> {
  const project = projectArg(
    args,
    1,
    "Usage: summon inspect <project> [--json]",
  );
  const status = readStatus(project, { reconcile: true });
  workspaceBackendFor(status?.backend).inspect(project, status, values.json === true);
}

export async function handleTitleCommand({
  args,
  values,
}: CommandContext): Promise<void> {
  const project = projectArg(
    args,
    2,
    "Usage: summon title <project> [pane] [--set <text> | --reset]",
  );
  if (values.set !== undefined && values.reset)
    exitWithUsageHint("--set and --reset are mutually exclusive.");
  if (values.set !== undefined) {
    const invalid = validateTitleText(values.set);
    if (invalid) exitWithUsageHint(invalid);
  }
  const operation =
    values.set !== undefined
      ? { kind: "set" as const, text: values.set }
      : values.reset
        ? { kind: "reset" as const }
        : { kind: "read" as const };
  const scope = args[1] === undefined ? "tab" : "pane";
  const status = readStatus(project, { reconcile: true });
  const result = workspaceBackendFor(status?.backend).title(project, status, scope, operation, args[1]);
  if (result.kind !== "title") {
    fail(result.reason);
    // UX-M3: nothing recorded, so the name may be a typo of a registered project.
    if (!status) printProjectSuggestions(project);
    process.exit(2);
  }
  console.log(
    result.override === ""
      ? "(no title override)"
      : escapeControlChars(result.override),
  );
}
