/**
 * The two backend ports (AR-M1). Generic modules dispatch through them; what differs between Ghostty and Rex lives
 * under src/backends/.
 *
 * - `TerminalBackend` (launch side): chosen once per launch from the detected `LaunchContext`
 *   (`createTerminalBackend`, backends/select.ts).
 * - `WorkspaceBackend` (record side): chosen from a status record's stored `backend` field
 *   (`workspaceBackendFor`, backends/workspace.ts); absent means Ghostty. A status read uses only its read half,
 *   `RecordReader` (`recordReaderFor`, backends/read.ts), which loads none of the commands.
 *
 * Types only: importing this module loads no backend.
 */
import type { LayoutOptions } from "../layout.js";
import type { PlannedLayout } from "../tree.js";
import type { BackendId } from "../backend-detect.js";
import type { CLIOverrides } from "../config-resolve.js";
import type { NativeMetadata } from "./ghostty/pane-inventory.js";
import type { RexIdentity } from "./rex/types.js";
import type { WorkspaceStatus } from "../status-record.js";
import type { ReadOptions, ResolvedStatus } from "../status.js";

/** Why a workspace command could not act on a recorded workspace (either backend). */
export interface NativeFailure {
  kind: "unavailable" | "failed";
  code: "permission" | "timeout" | "missing" | "unavailable";
  reason: string;
}

/** `summon focus`: the pane focused (a Ghostty terminal id or a Rex block id), or why not. */
export type FocusResult =
  { kind: "focused"; terminalId: string } | NativeFailure;

/** `summon title`: read, set or reset a title override. */
export type TitleOperation =
  { kind: "read" } | { kind: "set"; text: string } | { kind: "reset" };
export type TitleScope = "tab" | "pane";
export type TitleResult =
  | { kind: "title"; terminalId: string; scope: TitleScope; override: string }
  | NativeFailure;

/** Everything a backend needs after the launcher has taken the dry-run branch. */
export interface BackendLaunchContext {
  targetDir: string;
  /** User env vars (already filtered); undefined when there are none. */
  envVars: Record<string, string> | undefined;
  projectName: string;
  onStop: string | undefined;
  launchId: string;
  /** Preset name or "custom"; recorded in the status record and the Rex manifest. */
  layoutLabel: string;
  /** Resolve a configured command to its binary, installing on request. */
  ensureAndResolve: (cmd: string, key: string) => Promise<string>;
  /** Starship preset config path, or null when none applies. */
  resolveStarship: () => string | null;
}

/** Exact identity a backend captured, tagged with its backend: Ghostty's native metadata or the Rex identity, if any. */
export type BackendLaunchResult =
  | { backend: "ghostty"; native?: NativeMetadata }
  | { backend: "rex"; rex?: RexIdentity };

/** What a backend decides before a launch creates anything: go on, show the running workspace instead (P2), or refuse (exit 2). */
export type LaunchDecision = { kind: "proceed" } | { kind: "switched" } | { kind: "refused"; reason: string };

/** The launch options a backend may adjust or comment on, after the nested-workspace check. */
export interface LaunchOptionsInput {
  opts: Partial<LayoutOptions>;
  overrides: CLIOverrides;
  projectConfig: Map<string, string>;
  machineConfig: Map<string, string>;
  dryRun: boolean;
}

/** What a backend's dry run prints: the body after the headers, and notes for stderr. */
export interface DryRunRender {
  body: string;
  notes: string[];
}

/** Launch side: a backend launches a planned layout and returns the exact identity it captured, if any. */
export interface TerminalBackend {
  readonly id: BackendId;
  /** A launch splits the caller's window, so one made inside a workspace nests (Ghostty); otherwise it never touches the caller's pane. */
  readonly splitsCallerWindow: boolean;
  /** `summon session`: each project after the first opens as a new tab of the first one's window (Ghostty). */
  readonly opensSessionTabs: boolean;
  /** Real launches only, after detection and before the wizard, the pane probe and on-start: may switch or refuse (Rex P13, P2). */
  beforeLaunch?(project: string): LaunchDecision;
  /** After the nested-workspace check: adjust or comment on the launch options. */
  applyLaunchOptions(input: LaunchOptionsInput): void;
  /**
   * Real launches only, after every prompt and on-start: run `create` (the backend launch and the status publication)
   * exclusively per project (BE-L1). Without it `create` runs as is. Under its lock a backend may find that another
   * launch published meanwhile and switch to that workspace (or refuse) instead of calling `create`.
   */
  exclusiveLaunch?(project: string, create: () => Promise<void>): Promise<LaunchDecision>;
  /** Launch a planned layout of either kind. */
  launch(layout: PlannedLayout, ctx: BackendLaunchContext): Promise<BackendLaunchResult>;
  /** What a dry run prints for this backend (no terminal command runs). */
  dryRun(layout: PlannedLayout, ctx: BackendLaunchContext, starshipConfigPath: string | null, headerLines: string[]): DryRunRender;
  /** D1: start watching for output the user must read (Rex inside Rex); a later `afterSuccess` reads it. */
  watchOutput?(): void;
  /** D1: after a successful launch or switch (Rex inside Rex: close the launcher tab on a clean exit). */
  afterSuccess?(): void;
  /** `summon session` with several projects: show the first one again at the end (Rex P11). */
  showAgain?(project: string): void;
}

/** Per-read state a record backend may keep (Rex: one listing per server, one adoption per project). */
export interface StatusRead {
  readonly options: ReadOptions;
  /** This backend's per-read state, created on first use. */
  scratch<T>(id: BackendId, create: () => T): T;
  /** Resolve a record that another launch published meanwhile, through its own backend. */
  resolveRecord(project: string, record: WorkspaceStatus, notices: string[]): ResolvedStatus;
}

/** Record side, read half: what a status read does with a record of this backend (`recordReaderFor`, backends/read.ts). */
export interface RecordReader {
  /** The record's state (P10). `notices` are carried from an earlier step of the same read. */
  resolve(project: string, record: WorkspaceStatus, read: StatusRead, notices?: string[]): ResolvedStatus;
  /** Launches with a manifest but no record (P13): one adoption attempt when the read reconciles; `attempted` is false when it could not run. */
  adoptUnrecorded?(project: string, read: StatusRead): { attempted: boolean; notices: string[] };
}

/** Record side, commands: what Summon does with a recorded workspace of this backend. */
export interface WorkspaceBackend {
  readonly id: BackendId;
  /** Focus a recorded workspace or one of its panes; `status` is null when nothing is recorded. */
  focus(project: string, status: ResolvedStatus | null, pane?: string): FocusResult;
  /** `summon inspect`: print the workspace (JSON or text) and exit 2 when it is unavailable. */
  inspect(project: string, status: ResolvedStatus | null, json: boolean): void;
  /** `summon title`: read, set or reset a tab or pane title. */
  title(project: string, status: ResolvedStatus | null, scope: TitleScope, operation: TitleOperation, pane?: string): TitleResult;
  /** A launch on another backend replaces this record: the line to print when this workspace keeps running (plan §6). */
  stillRunningNotice?(project: string, record: WorkspaceStatus): string | undefined;
  /** `summon clean <project>` (P17): close the recorded workspace when it is empty; `sweptNote` reports the stale launch files already removed. */
  close(project: string, record: WorkspaceStatus, sweptNote: string): void;
  /** `summon clean`: remove this backend's stale files of launches other than `current`; returns how many launches it cleared. */
  sweepLaunches?(project: string, current: string | undefined): number;
  /** `summon clean --orphans`, first: what the review needs (Rex: its CLI, else exit 2). */
  prepareReview?(): void;
  /** `--orphans`, after the older-record check: late adoption before the review (Rex P13). */
  adoptBeforeReview?(project: string): void;
  /** `--orphans`: review every earlier launch of this backend except `current`, one printed line each; returns how many it reported. */
  reviewLaunches?(project: string, current: string | null): number;
}
