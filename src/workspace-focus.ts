/**
 * Focus for a recorded workspace (AR-M2, moved from launcher.ts): `focus` and the `open` and monitor focus paths use
 * it without loading the launch path. Never launches. The record's own backend focuses it (AR-M1): Ghostty through
 * the exact native identity, Rex through the shared pre-flight (plan P10) and the caller's app (P7).
 */
import { readStatus } from "./status.js";
import { workspaceBackendFor } from "./backends/workspace.js";
import type { FocusResult } from "./backends/port.js";
import { PROJECT_NAME_RE } from "./validation.js";

/** Focus only a recorded exact identity. Legacy/stale records never launch implicitly. */
export function focusWorkspace(projectName: string, paneName?: string): FocusResult {
  const status = PROJECT_NAME_RE.test(projectName) ? readStatus(projectName, { reconcile: true }) : null;
  return workspaceBackendFor(status?.backend).focus(projectName, status, paneName);
}
