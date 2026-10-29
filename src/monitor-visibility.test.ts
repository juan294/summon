import { describe, expect, it } from "vitest";
import { createMonitorVisibility } from "./monitor-visibility.js";

describe("monitor visibility controller", () => {
  it.each([1, 2])(
    "negotiates original mode %s and restores only owned changes",
    (mode) => {
      const controller = createMonitorVisibility(true);
      expect(controller.start(0)).toMatchObject({
        writes: ["\x1b[?2033$p"],
        hidden: false,
        nextDeadline: 500,
      });
      expect(
        controller.handle({ type: "mode", status: mode }, 10),
      ).toMatchObject({ writes: ["\x1b[?2033h"], nextDeadline: 510 });
      expect(
        controller.handle({ type: "visibility", status: 1 }, 20),
      ).toMatchObject({ hidden: false, fallback: false, nextDeadline: null });
      expect(controller.dispose().writes).toEqual(
        mode === 2 ? ["\x1b[?2033l"] : [],
      );
      expect(controller.dispose().writes).toEqual([]);
    },
  );
  it.each([0, 3, 4, 99])(
    "falls back for unsupported/unknown mode %s",
    (mode) => {
      const controller = createMonitorVisibility(true);
      controller.start(0);
      expect(
        controller.handle({ type: "mode", status: mode }, 1),
      ).toMatchObject({
        hidden: false,
        fallback: true,
        writes: [],
        nextDeadline: null,
      });
      expect(
        controller.handle({ type: "visibility", status: 2 }, 2).hidden,
      ).toBe(false);
    },
  );
  it("retains polling during negotiation and falls back after 500ms", () => {
    const controller = createMonitorVisibility(true);
    controller.start(0);
    expect(controller.tick(499)).toMatchObject({
      hidden: false,
      fallback: false,
    });
    expect(controller.tick(500)).toMatchObject({
      hidden: false,
      fallback: true,
    });
    expect(controller.handle({ type: "mode", status: 2 }, 501).writes).toEqual(
      [],
    );
  });
  it("restores owned mode when initial report never arrives", () => {
    const controller = createMonitorVisibility(true);
    controller.start(0);
    controller.handle({ type: "mode", status: 2 }, 5);
    expect(controller.tick(505)).toMatchObject({
      writes: ["\x1b[?2033l"],
      hidden: false,
      fallback: true,
    });
    expect(controller.dispose().writes).toEqual([]);
  });
  it("hidden watchdog queries at30s, fallback restores polling and owned mode on missing reply", () => {
    const controller = createMonitorVisibility(true);
    controller.start(0);
    controller.handle({ type: "mode", status: 2 }, 0);
    expect(
      controller.handle({ type: "visibility", status: 2 }, 0),
    ).toMatchObject({ hidden: true, nextDeadline: 30000, refresh: false });
    expect(controller.tick(29999).writes).toEqual([]);
    expect(controller.tick(30000)).toMatchObject({
      hidden: true,
      writes: ["\x1b[?998n"],
      nextDeadline: 30500,
    });
    expect(controller.tick(30500)).toMatchObject({
      hidden: false,
      fallback: true,
      refresh: true,
      writes: ["\x1b[?2033l"],
    });
    expect(
      controller.handle({ type: "visibility", status: 2 }, 30501).hidden,
    ).toBe(false);
  });
  it("visible resumes once and duplicates do not reset hidden watchdog", () => {
    const controller = createMonitorVisibility(true);
    controller.start(0);
    controller.handle({ type: "mode", status: 1 }, 0);
    controller.handle({ type: "visibility", status: 2 }, 0);
    expect(
      controller.handle({ type: "visibility", status: 2 }, 100).nextDeadline,
    ).toBe(30000);
    expect(
      controller.handle({ type: "visibility", status: 1 }, 200).refresh,
    ).toBe(true);
    expect(
      controller.handle({ type: "visibility", status: 1 }, 201).refresh,
    ).toBe(false);
    controller.handle({ type: "visibility", status: 2 }, 300);
    controller.tick(30300);
    expect(
      controller.handle({ type: "visibility", status: 2 }, 30400).nextDeadline,
    ).toBe(60400);
    expect(
      controller.handle({ type: "visibility", status: 99 }, 30500),
    ).toMatchObject({ hidden: false, refresh: true });
  });
  it("opt-out performs no protocol IO and ignores all reports", () => {
    const controller = createMonitorVisibility(false);
    expect(controller.start(0)).toMatchObject({
      writes: [],
      hidden: false,
      fallback: true,
      nextDeadline: null,
    });
    expect(controller.handle({ type: "mode", status: 2 }, 1).writes).toEqual(
      [],
    );
    expect(controller.tick(60000).writes).toEqual([]);
    expect(controller.dispose().writes).toEqual([]);
  });
});
