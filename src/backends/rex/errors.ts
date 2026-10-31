import { rexOpTraits, isMutatingOp } from "./types.js";
import type { RexFailure, RexFailureKind, RexOp, RexOutcome, RexRawResult } from "./types.js";
import { escapeControlChars } from "../../pane-inventory.js";
import { truncate } from "../../ui/width.js";

/**
 * Rex failure classifier (plan D5, P14, §3 "Rex error classes").
 *
 * Inputs are the op, the process result and narrow text patterns; the fallback is an
 * explicit `unknown`. A mutating op whose failure the server did not explain has outcome
 * `unknown` (the request may have completed); exit 1 from `session-create` is `rolled-back`
 * only when the response carries a server error object or the CLI's `Error:` line quotes a
 * server error code.
 */

const MAX_REASON_LENGTH = 512;

/** Server error codes the CLI quotes on its `Error:` line. */
const SERVER_ERROR_LINE_RE = /^Error: .*\b(bad_request|not_found|conflict|session_not_found)\b/;
const AMBIGUOUS_RE = /matches more than one|ambiguous/;
const TIMED_OUT_RE = /timed out/;
const UNREACHABLE_RE = /connect|unreachable|server\.sock/;
/**
 * BE-L4: failures that prove the request never reached the server (refused connection, missing socket).
 * Only these leave a mutation with outcome `none`; a dropped or reset connection may follow a completed request.
 */
const PRE_SEND_RE = /refused|no such file or directory/i;

const HINTS: Partial<Record<RexFailureKind, string>> = {
  "missing-binary": "Open the Rex app once so it installs its CLI, or set REX_BIN_DIR.",
  unreachable: "Open the Rex app and retry, or run summon doctor.",
  invalid: "The Rex CLI rejected the command line; run summon doctor to check the installed Rex version.",
};

/** `"code: message"` (or `"code"`) from a server error object `{ error: { code, message? } }`. */
function parseServerError(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!value || typeof value !== "object") return;
  const error = (value as Record<string, unknown>)["error"];
  if (!error || typeof error !== "object") return;
  const { code, message } = error as Record<string, unknown>;
  if (typeof code !== "string") return;
  // SE-L2: server text is displayed; escape it and cap it like the stderr line.
  return displayReason(typeof message === "string" ? `${code}: ${message}` : code);
}

/** First stderr line, control characters escaped, capped; empty when there is none. */
function firstStderrLine(stderr: string): string {
  return displayReason(stderr.split(/\r?\n/, 1)[0] ?? "");
}

/** Text from rex shown to the user: control characters escaped, capped at MAX_REASON_LENGTH. */
function displayReason(text: string): string {
  return truncate(escapeControlChars(text), MAX_REASON_LENGTH);
}

function genericReason(raw: RexRawResult): string {
  if (raw.enoent) return "rex binary not found";
  if (raw.timedOut) return "rex did not answer in time";
  if (raw.malformed) return "rex returned a response Summon could not parse";
  if (raw.signal) return `rex was killed by ${raw.signal}`;
  if (raw.code !== null) return `rex exited with status ${raw.code}`;
  return "rex failed";
}

/** The server's rejection as display text: the error object, or the CLI's `Error:` line quoting a code. */
function serverErrorOf(raw: RexRawResult, stderrLine: string): string | undefined {
  return parseServerError(raw.stdout) ?? parseServerError(raw.stderr) ?? (SERVER_ERROR_LINE_RE.test(stderrLine) ? stderrLine : undefined);
}

export function classifyRexFailure(op: RexOp, raw: RexRawResult): RexFailure {
  const mutating = isMutatingOp(op);
  const unknownIfMutating: RexOutcome = mutating ? "unknown" : "none";
  const stderrLine = firstStderrLine(raw.stderr);
  const unreachableOutcome: RexOutcome = PRE_SEND_RE.test(stderrLine) ? "none" : unknownIfMutating;
  let kind: RexFailureKind;
  let outcome: RexOutcome;
  let reason = stderrLine || genericReason(raw);

  if (raw.enoent) {
    kind = "missing-binary";
    outcome = "none";
    reason = genericReason(raw);
  } else if (raw.malformed) {
    kind = "malformed";
    outcome = unknownIfMutating;
    reason = genericReason(raw);
  } else if (raw.timedOut) {
    kind = "timeout";
    outcome = unknownIfMutating;
  } else if (raw.signal) {
    kind = "signal";
    outcome = unknownIfMutating;
  } else if (raw.code === 4) {
    kind = "unreachable";
    outcome = unreachableOutcome;
  } else if (raw.code === 2) {
    kind = "invalid";
    outcome = "none";
  } else if (raw.code === 3) {
    kind = AMBIGUOUS_RE.test(stderrLine) ? "ambiguous" : "not-found";
    outcome = "none";
  } else if (raw.code === 1) {
    const serverError = serverErrorOf(raw, stderrLine);
    if (serverError) {
      kind = "rejected";
      outcome = rexOpTraits(op).rollsBackOnReject ? "rolled-back" : "none";
      reason = serverError;
    } else if (TIMED_OUT_RE.test(stderrLine)) {
      kind = "timeout";
      outcome = unknownIfMutating;
    } else if (UNREACHABLE_RE.test(stderrLine)) {
      kind = "unreachable";
      outcome = unreachableOutcome;
    } else {
      kind = "failed";
      outcome = unknownIfMutating;
    }
  } else {
    kind = "unknown";
    outcome = unknownIfMutating;
  }

  const hint = HINTS[kind];
  return { ok: false, op, kind, outcome, reason, ...(hint ? { hint } : {}), raw };
}
