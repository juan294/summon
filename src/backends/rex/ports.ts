/**
 * Live ports of a Rex workspace: the terminal `ports` method (API revision 16 and later) on every terminal block
 * of the session, read side by side through `runRexAsync` within one command's `LiveBudget`. Read-only: nothing
 * is written or cached past the command (plan 2026-11-19-rex-live-ports).
 */
import { runPool, IO_CONCURRENCY } from "../../utils.js";
import type { LiveBudget, LivePort, LivePortsResult } from "../port.js";
import { rawResult, runRexAsync } from "./cli.js";
import type { RunRexAsyncOptions } from "./cli.js";
import { classifyRexFailure } from "./errors.js";
import { asRecord } from "./types.js";
import type { RexBlockIdentity, RexOp, RexResult } from "./types.js";
import { PORTS_METHOD, PORTS_CALL_TIMEOUT_MS, PORTS_UNSUPPORTED, PORTS_TIMED_OUT, NO_PORTS_METHOD_RE, parsePortsReply } from "./ports-reply.js";
import type { ParsedPorts } from "./ports-reply.js";

export { PANE_PORTS_UNSUPPORTED, PORTS_METHOD, PORTS_CALL_TIMEOUT_MS, PORTS_UNSUPPORTED, PORTS_TIMED_OUT, NO_PORTS_METHOD_RE, parsePortsReply } from "./ports-reply.js";
export type { ReplyPort, ParsedPorts } from "./ports-reply.js";

/** The process boundary of a live read, injectable for tests (`runRexAsync` by default). */
export type RexAsyncRunner = (op: RexOp, argv: readonly string[], opts: RunRexAsyncOptions) => Promise<RexResult>;

export interface LiveTarget {
  binary: string;
  server: string;
  sessionId: string;
  /** The record's pane-to-block mapping. */
  blocks: readonly RexBlockIdentity[];
}

type Capability = { kind: "yes" } | { kind: "no" } | { kind: "failed"; reason: string };

/** A call that settles by the deadline even when its runner ignores the signal (it then reads as a timeout). */
function bounded(op: RexOp, argv: readonly string[], target: LiveTarget, budget: LiveBudget, run: RexAsyncRunner): Promise<RexResult> {
  const timedOut = (): RexResult => classifyRexFailure(op, rawResult({ timedOut: true }));
  return budget.withSlot(async () => {
    // Queue time counts against the same command deadline. Never start a process for an expired call.
    if (budget.expired()) return timedOut();
    let onAbort: () => void = () => {};
    const deadline = new Promise<RexResult>((resolve) => {
      onAbort = () => resolve(timedOut());
      budget.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([run(op, argv, options(target, budget)), deadline]);
    } finally {
      budget.signal.removeEventListener("abort", onAbort);
    }
  });
}

function capabilityOf(target: LiveTarget, budget: LiveBudget, run: RexAsyncRunner): Promise<Capability> {
  return budget.scratch(`rex-ports:${target.binary}\n${target.server}`, async (): Promise<Capability> => {
    const described = await bounded("api-describe", ["api", "describe", PORTS_METHOD], target, budget, run);
    if (described.ok) return { kind: "yes" };
    return described.kind === "not-found" ? { kind: "no" } : { kind: "failed", reason: describedReason(described, budget) };
  });
}

function options(target: LiveTarget, budget: LiveBudget): RunRexAsyncOptions {
  return { binary: target.binary, server: target.server, timeoutMs: PORTS_CALL_TIMEOUT_MS, autostart: false, signal: budget.signal };
}

/** A call the deadline ended reads as "timed out", not as Rex's own message. */
function describedReason(result: Extract<RexResult, { ok: false }>, budget: LiveBudget): string {
  return budget.signal.aborted ? PORTS_TIMED_OUT : result.reason;
}

interface SessionBlock {
  blockId: string;
  label: string | null;
}

/** Terminal blocks of `block ls --json` (a block of another flavor has no `ports`); undefined when unreadable. */
function terminalBlocks(json: unknown): SessionBlock[] | undefined {
  const raw = asRecord(json)?.["blocks"];
  if (!Array.isArray(raw)) return undefined;
  const blocks: SessionBlock[] = [];
  for (const item of raw as unknown[]) {
    const block = asRecord(item);
    if (typeof block?.["block_id"] !== "string") continue;
    const flavor = block["flavor"];
    if (typeof flavor === "string" && !flavor.startsWith("com.superlogical.terminal")) continue;
    blocks.push({ blockId: block["block_id"], label: typeof block["label"] === "string" && block["label"] !== "" ? block["label"] : null });
  }
  return blocks;
}

function unavailable(reason: string): LivePortsResult {
  return { status: "unavailable", ports: [], reason };
}

/**
 * Every terminal block of the workspace's session, recorded or not: one `api describe` per server and command,
 * one `block ls`, then one `ports` call per block (at most IO_CONCURRENCY at a time). One pane that does not
 * answer makes the result partial; the deadline ends every read still running.
 */
export async function readLivePorts(target: LiveTarget, budget: LiveBudget, run: RexAsyncRunner = runRexAsync): Promise<LivePortsResult> {
  if (budget.expired()) return unavailable(PORTS_TIMED_OUT);
  const capability = await capabilityOf(target, budget, run);
  if (capability.kind === "no") return { status: "unsupported", ports: [], reason: PORTS_UNSUPPORTED };
  if (capability.kind === "failed") return unavailable(capability.reason);
  if (budget.expired()) return unavailable(PORTS_TIMED_OUT);

  const listed = await bounded("block-ls", ["block", "ls", "-s", target.sessionId, "--json"], target, budget, run);
  if (!listed.ok) return unavailable(describedReason(listed, budget));
  const blocks = terminalBlocks(listed.json);
  if (!blocks) return unavailable("unreadable block list");

  const names = new Map(target.blocks.map((b) => [b.blockId, b.name]));
  const replies = await runPool(blocks, IO_CONCURRENCY, async (block) => {
    const pane = names.get(block.blockId) ?? block.label ?? "unrecorded pane";
    if (budget.expired()) return { pane, recorded: names.has(block.blockId), failed: PORTS_TIMED_OUT };
    const answer = await bounded("block-call", ["block", "call", "-s", target.sessionId, "-b", block.blockId, "ports"], target, budget, run);
    if (!answer.ok) {
      if (NO_PORTS_METHOD_RE.test(answer.reason)) return { pane, recorded: names.has(block.blockId), noMethod: true, parsed: { status: "unsupported", ports: [] } as ParsedPorts };
      return { pane, recorded: names.has(block.blockId), failed: describedReason(answer, budget) };
    }
    return { pane, recorded: names.has(block.blockId), parsed: parsePortsReply(answer.json) };
  });

  const ports: LivePort[] = [];
  const reasons = new Set<string>();
  let read = 0;
  let unsupported = 0;
  let noMethod = 0;
  for (const reply of replies) {
    if ("failed" in reply) {
      reasons.add(reply.failed === PORTS_TIMED_OUT ? PORTS_TIMED_OUT : `pane ${reply.pane} did not answer (${reply.failed})`);
      continue;
    }
    if (reply.parsed.status === "unsupported") {
      unsupported++;
      if ("noMethod" in reply) noMethod++;
      continue;
    }
    read++;
    if (reply.parsed.reason) reasons.add(reply.parsed.reason);
    for (const port of reply.parsed.ports) ports.push({ ...port, pane: reply.pane, recorded: reply.recorded });
  }
  ports.sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
  if (read === 0 && unsupported > 0 && noMethod === unsupported && reasons.size === 0) return { status: "unsupported", ports: [], reason: PORTS_UNSUPPORTED };
  if (unsupported > 0) reasons.add(`${unsupported} terminal pane${unsupported === 1 ? " does" : "s do"} not support live ports`);
  if (read === 0 && reasons.size > 0) return unavailable([...reasons].join("; "));
  return { status: reasons.size > 0 ? "partial" : "ok", ports, ...(reasons.size > 0 ? { reason: [...reasons].join("; ") } : {}) };
}
