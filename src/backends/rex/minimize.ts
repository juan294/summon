import { REX_PROCESS_GRACE_MS, REX_READ_TIMEOUT_MS } from "./cli.js";
import type { RexCli } from "./cli.js";
import { blockLayers } from "./status.js";
import { asRecord, isKindId } from "./types.js";
import type { RexFailure } from "./types.js";
import { getErrorMessage } from "../../utils.js";

/**
 * Rex background panes (plan D1, D2, D5, D6): after `session.create` (which cannot create a floating layer) each
 * background pane is floated out of the tiled layout and its layer minimized. Presentation only: nothing here fails a
 * launch, and every pane that could not be minimized is named in a notice and left as it is.
 */

export interface MinimizeTarget {
  name: string;
  blockId: string;
}

export interface MinimizeResult {
  /** Panes now in a minimized floating layer, in the order given. */
  minimized: string[];
  /** One sentence per pane (or group of panes) that stays in the layout or needs the user, never an error. */
  notices: string[];
}

export interface MinimizeOptions {
  /** Skip a target whose block is not in the tiled layout: adoption leaves a block the user already floated or restored alone (D9). */
  onlyTiled?: boolean;
  /** The clock of the pass budget (tests). */
  now?: () => number;
}

/** Each presentation call is bounded: the pass runs under the launch lock (see `LAUNCH_LOCK_STALE_MS`). */
const MINIMIZE_TIMEOUT_MS = 5000;
/** The whole pass is bounded too: a server that answers every call near its timeout cannot stretch it with the number of panes. */
const MINIMIZE_BUDGET_MS = 30_000;

const CALL_MS = MINIMIZE_TIMEOUT_MS + REX_PROCESS_GRACE_MS;
const VIEW_MS = REX_READ_TIMEOUT_MS + REX_PROCESS_GRACE_MS;
/**
 * The longest the pass can hold the launch lock: the capability check, the pre-read of an `onlyTiled` pass, the budget,
 * and one last pane that outlasts it (a float, its recovery read, the minimize, its recovery read). The lock's stale
 * bound (`LAUNCH_LOCK_STALE_MS`) must stay above this plus the rest of a launch (`minimize.test.ts`).
 */
export const MINIMIZE_WORST_CASE_MS = CALL_MS + VIEW_MS + MINIMIZE_BUDGET_MS + 2 * (CALL_MS + VIEW_MS);

/** `session.float_block` bounds of the `index`-th background pane: the lower right of the window, cascaded and wrapped every six, always inside it. */
export function floatBounds(index: number): [number, number, number, number] {
  const offset = Math.round((0.5 - 0.04 * (index % 6)) * 100) / 100;
  return [offset, offset, 0.48, 0.46];
}

const stay = (names: readonly string[]): string => (names.length === 1 ? `${names[0]} stays` : `${names.join(", ")} stay`);
const staysInLayout = (names: readonly string[]): string => `${stay(names)} in the layout as ${names.length === 1 ? "a normal split" : "normal splits"}`;
const paneStays = (name: string, why: string): string => `pane ${name} stays in the layout as a normal split (${why})`;
const floatsOnly = (name: string, why: string): string => `pane ${name} floats over the layout but could not be minimized (${why}); minimize it in Rex`;
const paneMayFloat = (name: string): string => `pane ${name} may float over the layout (Rex stopped answering); check it in Rex`;

/** A failure that says Rex did not answer, as opposed to Rex answering with an error. */
const unanswered = (failure: RexFailure): boolean => failure.kind === "timeout" || failure.kind === "unreachable" || failure.kind === "signal";

type MinimizeStep =
  | { kind: "minimized" }
  | { kind: "left"; notice: string }
  /** Rex is not answering (the recovery read failed). `inDoubt`: the pane may already float. */
  | { kind: "stopped"; inDoubt: boolean };

function minimizeOne(cli: RexCli, sessionId: string, target: MinimizeTarget, index: number): MinimizeStep {
  const { name } = target;
  const floated = cli.call("block-float", ["api", "call", "session.float_block", "-"], {
    input: JSON.stringify({ session_id: sessionId, block_id: target.blockId, bounds: floatBounds(index) }),
    timeoutMs: MINIMIZE_TIMEOUT_MS,
  });
  let layerId: string | undefined;
  let reason = "";
  if (floated.ok) {
    const answered = asRecord(floated.json)?.["layer_id"];
    if (isKindId(answered, "layer")) layerId = answered;
    else reason = "Rex did not return a layer id";
  } else {
    reason = floated.reason;
  }
  if (!layerId) {
    // The view is the truth, not the answer (D6): a lost answer may still have floated the block.
    const seen = blockLayers(cli, sessionId);
    if (!seen.ok) {
      // The float call may have gone through (its answer was lost or unreadable): the pane may already float.
      const inDoubt = floated.ok || floated.outcome === "unknown";
      if (inDoubt || unanswered(seen)) return { kind: "stopped", inDoubt };
      // Rex answered the float with an error that left the block where it was, and answered the read with something unreadable: this pane stays, the pass goes on.
      return { kind: "left", notice: paneStays(name, reason) };
    }
    const info = seen.layers.get(target.blockId);
    if (!info) return { kind: "left", notice: paneStays(name, "its block is not in the session") };
    if (info.tiled) return { kind: "left", notice: paneStays(name, reason) };
    if (info.minimized) return { kind: "minimized" };
    // The id comes from the view (not from the float answer), so it is checked before it is sent back to Rex.
    if (!isKindId(info.layerId, "layer")) return { kind: "left", notice: floatsOnly(name, "Rex returned an unreadable layer id") };
    layerId = info.layerId;
  }
  const set = cli.call("layer-state", ["api", "call", "session.set_layer_state", "-"], {
    input: JSON.stringify({ session_id: sessionId, layer_id: layerId, state: "minimized" }),
    timeoutMs: MINIMIZE_TIMEOUT_MS,
  });
  if (set.ok) return { kind: "minimized" };
  const seen = blockLayers(cli, sessionId);
  const left: MinimizeStep = { kind: "left", notice: floatsOnly(name, set.reason) };
  if (!seen.ok) return set.outcome === "unknown" || unanswered(seen) ? { kind: "stopped", inDoubt: true } : left;
  return seen.layers.get(target.blockId)?.minimized ? { kind: "minimized" } : left;
}

function minimizePass(cli: RexCli, sessionId: string, targets: readonly MinimizeTarget[], options: MinimizeOptions, result: MinimizeResult): void {
  const now = options.now ?? Date.now;
  const deadline = now() + MINIMIZE_BUDGET_MS;
  const names = targets.map((t) => t.name);
  const unavailable = (reason: string): string => `could not check whether Rex can minimize floating panes (${reason}); ${staysInLayout(names)}`;

  const described = cli.call("api-describe", ["api", "describe", "session.set_layer_state"], { timeoutMs: MINIMIZE_TIMEOUT_MS });
  if (!described.ok) {
    result.notices.push(described.kind === "not-found"
      ? `this Rex build cannot minimize floating panes (session.set_layer_state is missing); ${stay(names)} in the layout. Update Rex to use background panes.`
      : unavailable(described.reason));
    return;
  }

  // The index is the pane's place in the list given (before `onlyTiled` drops any), so a pane keeps its cascade slot whether or not the filter skipped an earlier one.
  let wanted = targets.map((target, index) => ({ target, index }));
  if (options.onlyTiled) {
    const seen = blockLayers(cli, sessionId);
    if (!seen.ok) {
      result.notices.push(unavailable(seen.reason));
      return;
    }
    wanted = wanted.filter(({ target }) => seen.layers.get(target.blockId)?.tiled === true);
  }

  for (let i = 0; i < wanted.length; i++) {
    if (i > 0 && now() > deadline) {
      result.notices.push(`Rex is answering slowly; ${staysInLayout(wanted.slice(i).map((w) => w.target.name))}`);
      break;
    }
    const { target, index } = wanted[i]!;
    const step = minimizeOne(cli, sessionId, target, index);
    if (step.kind === "minimized") {
      result.minimized.push(target.name);
    } else if (step.kind === "left") {
      result.notices.push(step.notice);
    } else {
      if (step.inDoubt) result.notices.push(paneMayFloat(target.name));
      const rest = [...(step.inDoubt ? [] : [target.name]), ...wanted.slice(i + 1).map((w) => w.target.name)];
      if (rest.length > 0) result.notices.push(`Rex stopped answering; ${staysInLayout(rest)}`);
      break;
    }
  }
}

/**
 * Float each target out of the tiled layout and minimize its layer (Rex only; D1). It never throws and the launch does
 * not depend on it. The first unanswered call ends the pass and a 30 s budget ends it after a slow one, which bounds the
 * time under the launch lock (`MINIMIZE_WORST_CASE_MS`).
 */
export function minimizePanes(cli: RexCli, sessionId: string, targets: readonly MinimizeTarget[], options: MinimizeOptions = {}): MinimizeResult {
  const result: MinimizeResult = { minimized: [], notices: [] };
  if (targets.length === 0) return result;
  try {
    minimizePass(cli, sessionId, targets, options, result);
  } catch (error) {
    // Presentation only (D5): a defect here must not fail a launch whose session and manifest already exist. The state of
    // the panes not yet minimized is not known (one may float, one may already have a notice), so the notice claims none.
    result.notices.push(`could not minimize background panes (${getErrorMessage(error)}); check ${targets.map((t) => t.name).filter((name) => !result.minimized.includes(name)).join(", ")} in Rex`);
  }
  return result;
}
