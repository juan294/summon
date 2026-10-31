import { describe, expect, it } from "vitest";
import { createMonitorInputDecoder } from "./monitor-input.js";

describe("monitor byte stream decoder", () => {
  for (const [wire, event] of [
    ["\x1b[?2033;2$y", { type: "mode", status: 2 }],
    ["\x1b[?999;1n", { type: "visibility", status: 1 }],
  ] as const) {
    it(`decodes every split of ${JSON.stringify(wire)}`, () => {
      for (let split = 1; split < wire.length; split++) {
        const decoder = createMonitorInputDecoder();
        expect(decoder.push(wire.slice(0, split), 0)).toEqual([]);
        expect(decoder.push(wire.slice(split), 50)).toEqual([event]);
        expect(decoder.pendingDeadline()).toBeNull();
      }
    });
  }
  it("decodes coalesced arrows, reports and user keys in order once", () => {
    const decoder = createMonitorInputDecoder();
    expect(decoder.push("\x1b[B\x1b[?999;2nq", 0)).toEqual([
      { type: "key", bytes: "\x1b[B" },
      { type: "visibility", status: 2 },
      { type: "key", bytes: "q" },
    ]);
    expect(decoder.push("\x1b[50q\rq", 1)).toEqual([
      { type: "key", bytes: "\r" },
      { type: "key", bytes: "q" },
    ]);
  });
  it("expires incomplete CSI into quarantine without releasing continuation as keys", () => {
    const decoder = createMonitorInputDecoder();
    decoder.push("\x1b[?999;", 0);
    expect(decoder.pendingDeadline()).toBe(100);
    decoder.expire(99);
    expect(decoder.pendingDeadline()).toBe(100);
    decoder.expire(100);
    expect(decoder.pendingDeadline()).toBeNull();
    expect(decoder.push("2\r\nq", 150)).toEqual([]);
    expect(decoder.push("q", 151)).toEqual([{ type: "key", bytes: "q" }]);
  });
  it("expiry of a lone escape cannot release delayed CSI payload as actions", () => {
    const decoder = createMonitorInputDecoder();
    decoder.push("\x1b", 0);
    decoder.expire(100);
    expect(decoder.push("[q", 101)).toEqual([]);
    expect(decoder.push("q", 102)).toEqual([{ type: "key", bytes: "q" }]);
  });
  it("FE-M2: a lone Esc becomes an escape key when it expires and keeps the next key", () => {
    const decoder = createMonitorInputDecoder();
    expect(decoder.push("\x1b", 0)).toEqual([]);
    expect(decoder.expire(99)).toEqual([]);
    expect(decoder.expire(100)).toEqual([{ type: "key", bytes: "\x1b" }]);
    expect(decoder.expire(200)).toEqual([]);
    expect(decoder.push("q", 101)).toEqual([{ type: "key", bytes: "q" }]);
  });
  it("FE-M2: a key read after the Esc deadline releases the escape first, then the key", () => {
    const decoder = createMonitorInputDecoder();
    decoder.push("\x1b", 0);
    expect(decoder.push("q", 150)).toEqual([
      { type: "key", bytes: "\x1b" },
      { type: "key", bytes: "q" },
    ]);
  });
  it("FE-M2: a reply split after a lone-Esc expiry still never reaches the key handler", () => {
    const decoder = createMonitorInputDecoder();
    decoder.push("\x1b", 0);
    expect(decoder.expire(100)).toEqual([{ type: "key", bytes: "\x1b" }]);
    expect(decoder.push("[?999;1n", 101)).toEqual([]);
    expect(decoder.push("q", 102)).toEqual([{ type: "key", bytes: "q" }]);
  });
  it("FE-M2: an incomplete CSI that expires emits no escape key", () => {
    const decoder = createMonitorInputDecoder();
    decoder.push("\x1b[?999;", 0);
    expect(decoder.expire(100)).toEqual([]);
  });
  it("quarantines overflow with bounded state and suppresses embedded Enter/q", () => {
    const decoder = createMonitorInputDecoder();
    expect(decoder.push("\x1b[" + "9".repeat(20_000) + "\rq", 0)).toEqual([]);
    expect(decoder.push("\x1b[?999;2nq", 1)).toEqual([
      { type: "visibility", status: 2 },
      { type: "key", bytes: "q" },
    ]);
  });
  it("quarantines non-ASCII CSI rather than buffering Unicode or releasing action keys", () => {
    const decoder = createMonitorInputDecoder();
    expect(decoder.push("\x1b[?🦊", 0)).toEqual([]);
    expect(decoder.pendingDeadline()).toBeNull();
    expect(decoder.push("\rq", 1)).toEqual([]);
    expect(decoder.push("q", 2)).toEqual([{ type: "key", bytes: "q" }]);
  });
  it("resynchronizes nested escape while quarantined without leaking its payload", () => {
    const decoder = createMonitorInputDecoder();
    decoder.push("\x1b[" + "9".repeat(256), 0);
    expect(decoder.push("\x1b[q", 1)).toEqual([]);
    expect(decoder.push("q", 2)).toEqual([{ type: "key", bytes: "q" }]);
  });
  it("Ctrl+C stays responsive inside ordinary, pending and quarantined sequences", () => {
    const decoder = createMonitorInputDecoder();
    expect(decoder.push("\x03", 0)).toEqual([{ type: "key", bytes: "\x03" }]);
    expect(decoder.push("\x1b[?\x03", 0)).toEqual([
      { type: "key", bytes: "\x03" },
    ]);
    decoder.push("\x1b[" + "9".repeat(256), 0);
    expect(decoder.push("\x03", 0)).toEqual([{ type: "key", bytes: "\x03" }]);
  });
  it("drops unknown escape/control sequences and resets partial state", () => {
    const decoder = createMonitorInputDecoder();
    expect(decoder.push("\x1bq\x00", 0)).toEqual([]);
    decoder.push("\x1b[", 1);
    decoder.reset();
    expect(decoder.push(Buffer.from("?r"), 2)).toEqual([
      { type: "key", bytes: "?" },
      { type: "key", bytes: "r" },
    ]);
  });
});
