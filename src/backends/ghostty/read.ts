/**
 * The Ghostty half of a status read: the per-launch sidecars decide (a record with a launch id reads only its own
 * per-launch files, P12). Kept apart from the record commands (workspace.ts) so a status read loads no native
 * scripting.
 */
import { ghosttyLiveness, liveUptime } from "../../status-record.js";
import type { WorkspaceStatus } from "../../status-record.js";
import type { ResolvedStatus } from "../../status.js";
import type { StatusRead } from "../port.js";

export function resolveGhosttyStatus(projectName: string, record: WorkspaceStatus, _read: StatusRead, notices: string[] = []): ResolvedStatus {
  const state = ghosttyLiveness(projectName, record) === "active" ? "active" : "stopped";
  return {
    ...record,
    state,
    uptime: liveUptime(state, record.startedAt),
    ...(notices.length > 0 ? { notices } : {}),
  };
}
