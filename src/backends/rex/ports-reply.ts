/**
 * The terminal `ports` reply (API revision 16 and later) as Summon reads it: a leaf module, so `inspect`'s status
 * code can parse a reply without loading the side-by-side live read (backends/rex/ports.ts).
 */
import { basename } from "node:path";
import type { LivePort, LivePortsStatus } from "../port.js";
import { asRecord } from "./types.js";

export const PORTS_METHOD = "com.superlogical.terminal.ports";
/** Rex's own `--timeout` for one `ports` call; a healthy server answers in about 25 ms (measured 2026-11-19). */
export const PORTS_CALL_TIMEOUT_MS = 2000;
export const PORTS_UNSUPPORTED = "this Rex server has no live ports (needs API 16 or later)";
/** A server that has the method, asked about a pane that cannot answer it. */
export const PANE_PORTS_UNSUPPORTED = "this pane does not support live ports";
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
  if (status === "unsupported") return { status, ports: [], reason: PANE_PORTS_UNSUPPORTED };
  return { status, ports, ...(reasons.size > 0 ? { reason: [...reasons].join("; ") } : {}) };
}

