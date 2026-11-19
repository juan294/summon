/**
 * Live ports of a Rex workspace: the terminal `ports` method (API revision 16 and later) on every terminal block
 * of the session, read side by side through `runRexAsync` within one command's `LiveBudget`. Read-only: nothing
 * is written or cached past the command (plan 2026-11-19-rex-live-ports).
 */
import { basename } from "node:path";
import { runPool, IO_CONCURRENCY } from "../../utils.js";
import type { LiveBudget, LivePort, LivePortsResult, LivePortsStatus } from "../port.js";
import { rawResult, runRexAsync } from "./cli.js";
import type { RunRexAsyncOptions } from "./cli.js";
import { classifyRexFailure } from "./errors.js";
import { asRecord } from "./types.js";
import type { RexBlockIdentity, RexOp, RexResult } from "./types.js";

export const PORTS_METHOD = "com.superlogical.terminal.ports";
/** Rex's own `--timeout` for one `ports` call; a healthy server answers in about 25 ms (measured 2026-11-19). */
export const PORTS_CALL_TIMEOUT_MS = 2000;
export const PORTS_UNSUPPORTED = "this Rex server has no live ports (needs API 16 or later)";
export const PORTS_TIMED_OUT = "timed out";
const PARTIAL_PROCESSES = "some processes could not be read; a port may be missing";
const TRUNCATED = "more ports than one reply holds; some are not shown";
const UNREADABLE = "unreadable ports reply";
/** What a server without the method answers to `block call <block> ports` (preview.19, 2026-11-17). */
export const NO_PORTS_METHOD_RE = /has no method "ports"/;

/** One port as a reply gives it, before it is placed on a pane. */
export type ReplyPort = Omit<LivePort, "pane" | "recorded">;

export interface ParsedPorts {
  status: Exclude<LivePortsStatus, "unavailable">;
  ports: ReplyPort[];
  reason?: string;
}

function processLabel(entry: Record<string, unknown> | undefined): string | null {
  if (!entry) return null;
  for (const key of ["script", "argv0", "name"]) {
    const value = entry[key];
    if (typeof value === "string" && value !== "") return value.includes("/") ? basename(value) || value : value;
  }
  return null;
}

/**
 * One `block call ports` answer. The schema's rules: an unknown `status` is `partial`; an entry with a protocol
 * other than `tcp` is skipped; a missing `pid` means the holder is unknown (and the reply partial); a truncated
 * reply lists only some ports.
 */
export function parsePortsReply(json: unknown): ParsedPorts {
  const reply = asRecord(json);
  const rawPorts = reply?.["ports"];
  if (!reply || !Array.isArray(rawPorts)) return { status: "partial", ports: [], reason: UNREADABLE };
  const processes = new Map<number, Record<string, unknown>>();
  if (Array.isArray(reply["processes"])) {
    for (const item of reply["processes"] as unknown[]) {
      const entry = asRecord(item);
      if (entry && Number.isInteger(entry["pid"])) processes.set(entry["pid"] as number, entry);
    }
  }
  const reasons = new Set<string>();
  let status: ParsedPorts["status"] = reply["status"] === "ok" || reply["status"] === "unsupported" ? reply["status"] : "partial";
  if (status === "partial") reasons.add(PARTIAL_PROCESSES);
  const ports: ReplyPort[] = [];
  for (const item of rawPorts as unknown[]) {
    const entry = asRecord(item);
    const port = entry?.["port"];
    if (!entry || entry["protocol"] !== "tcp" || typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535 || typeof entry["address"] !== "string") continue;
    const pid = Number.isInteger(entry["pid"]) ? (entry["pid"] as number) : null;
    if (pid === null) {
      status = "partial";
      reasons.add(PARTIAL_PROCESSES);
    }
    ports.push({ port, address: entry["address"], process: pid === null ? null : processLabel(processes.get(pid)), pid });
  }
  if (reply["truncated"] === true) {
    status = "partial";
    reasons.add(TRUNCATED);
  }
  if (status === "unsupported") return { status, ports: [], reason: PORTS_UNSUPPORTED };
  return { status, ports, ...(reasons.size > 0 ? { reason: [...reasons].join("; ") } : {}) };
}

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
  if (budget.signal.aborted) return Promise.resolve(timedOut());
  let onAbort: () => void = () => {};
  const deadline = new Promise<RexResult>((resolve) => {
    onAbort = () => resolve(timedOut());
    budget.signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([run(op, argv, options(target, budget)), deadline]).finally(() => budget.signal.removeEventListener("abort", onAbort));
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
      if (NO_PORTS_METHOD_RE.test(answer.reason)) return { pane, recorded: names.has(block.blockId), parsed: { status: "unsupported", ports: [] } as ParsedPorts };
      return { pane, recorded: names.has(block.blockId), failed: describedReason(answer, budget) };
    }
    return { pane, recorded: names.has(block.blockId), parsed: parsePortsReply(answer.json) };
  });

  const ports: LivePort[] = [];
  const reasons = new Set<string>();
  let read = 0;
  let unsupported = 0;
  for (const reply of replies) {
    if ("failed" in reply) {
      reasons.add(reply.failed === PORTS_TIMED_OUT ? PORTS_TIMED_OUT : `pane ${reply.pane} did not answer (${reply.failed})`);
      continue;
    }
    if (reply.parsed.status === "unsupported") {
      unsupported++;
      continue;
    }
    read++;
    if (reply.parsed.reason) reasons.add(reply.parsed.reason);
    for (const port of reply.parsed.ports) ports.push({ ...port, pane: reply.pane, recorded: reply.recorded });
  }
  ports.sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
  if (read === 0 && unsupported > 0 && reasons.size === 0) return { status: "unsupported", ports: [], reason: PORTS_UNSUPPORTED };
  if (read === 0 && reasons.size > 0) return unavailable([...reasons].join("; "));
  return { status: reasons.size > 0 ? "partial" : "ok", ports, ...(reasons.size > 0 ? { reason: [...reasons].join("; ") } : {}) };
}
