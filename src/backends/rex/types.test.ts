import { describe, it, expect } from "vitest";
import { parseRexIdentity } from "./types.js";

const ID = "01a1b2c3-d4e5-4f60-8a7b-8c9d0e1f2a3b";
const valid = () => ({
  server: "unix:///Users/me/Library/Application%20Support/rex/server.sock",
  hostId: "cf528d2b-1111-4222-8333-444455556666",
  sessionId: `session:${ID}`,
  windowId: `window:${ID}`,
  rootBlockId: `block:${ID}`,
  blocks: [
    { name: "editor", blockId: `block:${ID}`, label: "editor · nvim" },
    { name: "shell", blockId: "block:11111111-2222-4333-8444-555566667777", label: "shell" },
  ],
});
const PANES = ["editor", "sidebar", "shell"];

describe("parseRexIdentity", () => {
  it("round-trips a valid identity and drops unknown keys", () => {
    const parsed = parseRexIdentity({ ...valid(), extra: 1 }, PANES);
    expect(parsed).toEqual(valid());
  });

  it("accepts a block subset of panes (unverified panes are filled in later)", () => {
    expect(parseRexIdentity({ ...valid(), blocks: [] }, PANES)?.blocks).toEqual([]);
  });

  it.each([
    ["server scheme", { server: "ftp://x" }],
    ["server with whitespace", { server: "unix:///a b" }],
    ["hostId empty", { hostId: "" }],
    ["sessionId kind", { sessionId: `window:${ID}` }],
    ["windowId format", { windowId: "window:short" }],
    ["rootBlockId kind", { rootBlockId: `session:${ID}` }],
    ["blocks not array", { blocks: {} }],
    ["block name not a pane", { blocks: [{ name: "ghost", blockId: `block:${ID}`, label: "x" }] }],
    ["block id format", { blocks: [{ name: "editor", blockId: "block:x", label: "x" }] }],
    ["block label type", { blocks: [{ name: "editor", blockId: `block:${ID}`, label: 3 }] }],
    ["block item null", { blocks: [null] }],
    ["duplicate block name", { blocks: [{ name: "editor", blockId: `block:${ID}`, label: "a" }, { name: "editor", blockId: "block:11111111-2222-4333-8444-555566667777", label: "b" }] }],
    ["duplicate block id", { blocks: [{ name: "editor", blockId: `block:${ID}`, label: "a" }, { name: "shell", blockId: `block:${ID}`, label: "b" }] }],
  ])("rejects an identity with an invalid %s", (_label, patch) => {
    expect(parseRexIdentity({ ...valid(), ...patch }, PANES)).toBeUndefined();
  });

  it("rejects non-objects", () => {
    expect(parseRexIdentity(null, PANES)).toBeUndefined();
    expect(parseRexIdentity("x", PANES)).toBeUndefined();
  });

  it("accepts tcp and https servers and an empty block label", () => {
    expect(parseRexIdentity({ ...valid(), server: "tcp://127.0.0.1:7000" }, PANES)?.server).toBe("tcp://127.0.0.1:7000");
    expect(parseRexIdentity({ ...valid(), server: "https://rex.example" }, PANES)?.server).toBe("https://rex.example");
    expect(parseRexIdentity({ ...valid(), blocks: [{ name: "editor", blockId: `block:${ID}`, label: "" }] }, PANES)?.blocks[0]?.label).toBe("");
  });
});
