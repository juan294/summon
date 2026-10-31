/**
 * Rex reconciliation (AR-M3, moved from status.ts): the writing steps of a Rex status read. Late
 * adoption (P13), the pane-file refresh of a record with unverified panes (P13 next-read recovery)
 * and the end of a launch that ended outside Summon (P12: snapshot, `endedAt`, file removal under
 * the lock). The reader in status.ts runs them only for a read that asks to reconcile; `summon clean`
 * calls `endRexLaunch` directly.
 */
import { existsSync } from "node:fs";
import { getErrorMessage } from "../../utils.js";
import { launchArtifactFiles, launchFileList, readLaunchManifest } from "../../launch-identity.js";
import type { LaunchFileSet } from "../../launch-identity.js";
import { collectSnapshot, writeSnapshotFile } from "../../snapshot.js";
import { RecordWriteError, readStatusRecord, removeLaunchFileSet, unverifiedPanes, withOwnedRecord } from "../../status-record.js";
import type { WorkspaceStatus } from "../../status-record.js";
import { SESSION_GONE } from "./status.js";
import type { RexSessionState } from "./status.js";
import { adoptDeps, adoptOrphans, refreshPaneMapping } from "./launch.js";

/**
 * Where a reconciliation step leaves the generation being read: still its own record (re-read when
 * a step wrote it), or superseded by another launch's record that the reader resolves afresh.
 */
export type ReconcileStep = { kind: "current"; record: WorkspaceStatus } | { kind: "superseded"; record: WorkspaceStatus };

/** Late adoption (P13) for a project, at most once per read (`adopted` is the read's set). */
export function adoptOnce(projectName: string, binary: string, adopted: Set<string>): string[] {
  if (adopted.has(projectName)) return [];
  adopted.add(projectName);
  return adoptOrphans(projectName, adoptDeps(binary));
}

/**
 * P13 next-read recovery, before the state probe: a live or stopped generation with unverified panes
 * gets the blocks of pane files that arrived since (an ended generation never gains pane files).
 */
export function refreshUnverifiedPanes(projectName: string, record: WorkspaceStatus, notices: string[]): ReconcileStep {
  const gen = record.launchId;
  if (!gen || !record.rex || record.endedAt || unverifiedPanes(record) <= 0) return { kind: "current", record };
  const refreshed = refreshPaneMapping(record);
  notices.push(...refreshed.notices);
  if (!refreshed.changed) return { kind: "current", record };
  const latest = readStatusRecord(projectName) ?? record;
  return latest.launchId !== gen ? { kind: "superseded", record: latest } : { kind: "current", record: latest };
}

/**
 * After the state probe: a stopped launch of this generation whose panes are all verified is ended
 * (`endRexLaunch`) when it still needs it. With an unverified pane it is not ended here: one of the
 * session's remaining blocks may be that pane, and a later read with its file recovers it (P13).
 */
export function reconcileStoppedLaunch(projectName: string, record: WorkspaceStatus, state: Pick<RexSessionState, "state" | "reason">, unverified: number, notices: string[]): ReconcileStep {
  const gen = record.launchId;
  if (state.state !== "stopped" || !gen || unverified > 0) return { kind: "current", record };
  const confirmedGone = state.reason === SESSION_GONE;
  if (!needsReconciliation(record, () => removableLaunchFiles(projectName, record, gen, confirmedGone))) return { kind: "current", record };
  const notice = endRexLaunch(projectName, record, { confirmedGone });
  if (notice) notices.push(notice);
  const latest = readStatusRecord(projectName) ?? record;
  return latest.launchId !== gen ? { kind: "superseded", record: latest } : { kind: "current", record: latest };
}

// --- Reconciliation of ended Rex launches (plan P12, phase-5.md) ---

/** Step A (the snapshot) failed; the record write failure is `RecordWriteError`, anything else comes from the lock. */
class SnapshotStepFailure extends Error {}

/** The files the end-of-launch steps remove for this record: always the sidecars; the session files only once the session is confirmed gone. */
function removableLaunchFiles(project: string, record: WorkspaceStatus, launchId: string, confirmedGone: boolean): LaunchFileSet {
  const panes = readLaunchManifest(project, launchId)?.paneOrder ?? record.panes;
  const files = launchArtifactFiles(project, launchId, panes);
  return confirmedGone ? files : { liveness: files.liveness, panes: [] };
}

/** Rule 1 of the reconciliation: no `endedAt` yet, or `endedAt` with removable per-launch files left behind (the set is built only then). */
function needsReconciliation(record: WorkspaceStatus, files: () => LaunchFileSet): boolean {
  if (!record.launchId) return false;
  if (!record.endedAt) return true;
  return launchFileList(files()).some((file) => existsSync(file));
}

export interface EndLaunchOptions {
  /** The session is confirmed gone on the record's server: the manifest and pane files may go too. */
  confirmedGone: boolean;
  /** How the notice names the event (default: a workspace that ended outside Summon). */
  label?: string;
}

/**
 * Ordered, idempotent end-of-launch steps for the record's own generation: A snapshot (collected
 * before the lock, written inside it), B `endedAt` on the record, C removal of this launch's
 * files (`afterWrite`, still under the lock). The lock excludes other writers; the steps are not
 * all-or-nothing, so a later read completes whatever is left (`endedAt` present skips A and B;
 * `afterWrite` retries C). Returns the notice to show, if any. Shared by the reconciling readers (a
 * workspace that ended outside Summon) and `summon clean`.
 */
export function endRexLaunch(project: string, record: WorkspaceStatus, options: EndLaunchOptions): string | undefined {
  const gen = record.launchId;
  if (!gen) return undefined;
  const label = options.label ?? "workspace ended outside Summon";
  const files = removableLaunchFiles(project, record, gen, options.confirmedGone);
  const completed: string[] = [];
  const fileFailures: string[] = [];
  let snapshot: ReturnType<typeof collectSnapshot>;
  try {
    snapshot = record.endedAt ? null : collectSnapshot(project, record.directory, record.layout);
  } catch (error) {
    return `${label}; snapshot failed: ${getErrorMessage(error)}; will retry on the next read`;
  }
  try {
    const { outcome } = withOwnedRecord(
      project,
      { launchId: gen },
      (current) => {
        if (!current || current.endedAt) return null;
        try {
          if (snapshot) writeSnapshotFile(snapshot);
        } catch (error) {
          throw new SnapshotStepFailure(getErrorMessage(error));
        }
        completed.push(snapshot ? `snapshot saved ${snapshot.timestamp}` : "snapshot skipped (no git repository)");
        return { ...current, endedAt: new Date().toISOString() };
      },
      (_outcome, final) => {
        if (final?.endedAt) fileFailures.push(...removeLaunchFileSet(files).failures);
      },
    );
    if (outcome === "superseded") return undefined;
    const fileNote = fileFailures.length > 0 ? `${fileFailures.length} launch ${fileFailures.length === 1 ? "file" : "files"} of [${project}] ${outcome === "unchanged" ? "still " : ""}could not be removed: ${fileFailures[0]}; will retry` : undefined;
    if (outcome === "unchanged") return fileNote;
    return [label, ...completed, ...(fileNote ? [fileNote] : [])].join("; ");
  } catch (error) {
    const step = error instanceof SnapshotStepFailure ? "snapshot" : error instanceof RecordWriteError ? "record" : "lock";
    return [label, ...completed, `${step} failed: ${getErrorMessage(error)}`, "will retry on the next read"].join("; ");
  }
}
