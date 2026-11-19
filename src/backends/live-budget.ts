/**
 * The deadline shared by one command's live reads (`LiveBudget`, backends/port.ts). Pure apart from one unref'd
 * timer, so a command never waits on it and nothing outlives the process.
 */
import { setMaxListeners } from "node:events";
import { IO_CONCURRENCY } from "../utils.js";
import type { LiveBudget } from "./port.js";

/** How long one command spends on live ports across every workspace (plan 2026-11-19-rex-live-ports). */
export const LIVE_DEADLINE_MS = 4000;

export function createLiveBudget(deadlineMs: number = LIVE_DEADLINE_MS, now: () => number = Date.now): LiveBudget {
  const controller = new AbortController();
  // Each active call and its child process can both listen on the same signal.
  setMaxListeners(0, controller.signal);
  const state = new Map<string, unknown>();
  const waiting: Array<() => void> = [];
  let freeSlots = IO_CONCURRENCY;
  let endsAt: number | undefined;
  return {
    signal: controller.signal,
    expired() {
      if (endsAt === undefined) {
        endsAt = now() + deadlineMs;
        setTimeout(() => controller.abort(), deadlineMs).unref();
      }
      // The clock as well as the timer: synchronous work can hold the timer past the deadline.
      if (!controller.signal.aborted && now() >= endsAt) controller.abort();
      return controller.signal.aborted;
    },
    async withSlot<T>(call: () => Promise<T>): Promise<T> {
      if (freeSlots > 0) freeSlots--;
      else await new Promise<void>((resolve) => waiting.push(resolve));
      try {
        return await call();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else freeSlots++;
      }
    },
    scratch<T>(key: string, create: () => T): T {
      if (!state.has(key)) state.set(key, create());
      return state.get(key) as T;
    },
  };
}
