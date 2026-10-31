/**
 * The record-side backend for a stored `backend` field (AR-M1): the one place that maps a status record to its
 * `WorkspaceBackend`. The status reader, `focus`, `inspect`, `title`, `clean` and the launcher's note about another
 * backend's live workspace dispatch through it. A record without the field is Ghostty.
 */
import type { BackendId } from "../backend.js";
import { GhosttyWorkspace } from "./ghostty/workspace.js";
import type { WorkspaceBackend } from "./port.js";
import { RexWorkspace } from "./rex/workspace.js";

/** Every record backend, in the order `summon clean --orphans` reviews them. */
const WORKSPACE_BACKENDS: readonly WorkspaceBackend[] = [GhosttyWorkspace, RexWorkspace];

export function workspaceBackendFor(backend: BackendId | undefined): WorkspaceBackend {
  return backend === "rex" ? RexWorkspace : GhosttyWorkspace;
}

export function allWorkspaceBackends(): readonly WorkspaceBackend[] {
  return WORKSPACE_BACKENDS;
}
