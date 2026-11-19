import { describe, it, expect } from "vitest";
import { createLiveBudget, LIVE_DEADLINE_MS } from "./live-budget.js";

describe("createLiveBudget", () => {
  it("starts the deadline on first use, not at creation", async () => {
    const budget = createLiveBudget(30);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(budget.expired()).toBe(false);
    expect(budget.signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(budget.expired()).toBe(true);
    expect(budget.signal.aborted).toBe(true);
  });

  it("expires by the clock even when the timer has not run (synchronous work held the event loop)", () => {
    let clock = 1000;
    const budget = createLiveBudget(100, () => clock);
    expect(budget.expired()).toBe(false);
    clock = 1100;
    expect(budget.expired()).toBe(true);
    expect(budget.signal.aborted).toBe(true);
  });

  it("many reads listening on the one signal print no listener warning", async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error): void => { warnings.push(warning); };
    process.on("warning", onWarning);
    try {
      const budget = createLiveBudget();
      const listeners = Array.from({ length: 40 }, () => () => {});
      for (const listener of listeners) budget.signal.addEventListener("abort", listener);
      await new Promise((resolve) => setImmediate(resolve));
      for (const listener of listeners) budget.signal.removeEventListener("abort", listener);
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((w) => w.name === "MaxListenersExceededWarning")).toEqual([]);
  });

  it("creates scratch state once per key", () => {
    const budget = createLiveBudget();
    let made = 0;
    const a = budget.scratch("k", () => ({ n: ++made }));
    const b = budget.scratch("k", () => ({ n: ++made }));
    expect(a).toBe(b);
    expect(budget.scratch("other", () => ({ n: ++made })).n).toBe(2);
  });

  it("defaults to the plan's 4 s", () => {
    expect(LIVE_DEADLINE_MS).toBe(4000);
  });
});
