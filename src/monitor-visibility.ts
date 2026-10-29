import type { MonitorInput } from "./monitor-input.js";

export interface VisibilityEffects {
  writes: string[];
  hidden: boolean;
  fallback: boolean;
  refresh: boolean;
  nextDeadline: number | null;
}

/** Pure protocol policy. The TUI owns IO and schedules the returned single deadline. */
export function createMonitorVisibility(enabled: boolean) {
  let phase: "idle" | "mode" | "initial" | "active" | "fallback" | "disposed" =
    "idle";
  let hidden = false;
  let owned = false;
  let deadline: number | null = null;
  let awaitingWatchdog = false;
  const effects = (
    writes: string[] = [],
    refresh = false,
  ): VisibilityEffects => ({
    writes,
    hidden,
    fallback: phase === "fallback",
    refresh,
    nextDeadline: deadline,
  });
  const restore = (): string[] => {
    const writes = owned ? ["\x1b[?2033l"] : [];
    owned = false;
    return writes;
  };
  const fallback = (): VisibilityEffects => {
    const wasHidden = hidden;
    phase = "fallback";
    hidden = false;
    deadline = null;
    awaitingWatchdog = false;
    return effects(restore(), wasHidden);
  };
  return {
    start(now: number): VisibilityEffects {
      if (phase !== "idle") return effects();
      if (!enabled) return fallback();
      phase = "mode";
      deadline = now + 500;
      return effects(["\x1b[?2033$p"]);
    },
    handle(event: MonitorInput, now: number): VisibilityEffects {
      if (event.type === "mode" && phase === "mode") {
        if (event.status !== 1 && event.status !== 2) return fallback();
        owned = event.status === 2;
        phase = "initial";
        deadline = now + 500;
        return effects(["\x1b[?2033h"]);
      }
      if (
        event.type !== "visibility" ||
        (phase !== "initial" && phase !== "active")
      )
        return effects();
      const wasHidden = hidden;
      const initial = phase === "initial";
      phase = "active";
      hidden = event.status === 2;
      if (hidden && (!wasHidden || initial || awaitingWatchdog))
        deadline = now + 30_000;
      if (!hidden) deadline = null;
      awaitingWatchdog = false;
      return effects([], wasHidden && !hidden);
    },
    tick(now: number): VisibilityEffects {
      if (deadline === null || now < deadline) return effects();
      if (phase === "mode" || phase === "initial" || awaitingWatchdog)
        return fallback();
      awaitingWatchdog = true;
      deadline = now + 500;
      return effects(["\x1b[?998n"]);
    },
    dispose(): VisibilityEffects {
      phase = "disposed";
      hidden = false;
      deadline = null;
      awaitingWatchdog = false;
      return effects(restore());
    },
  };
}
