import { afterEach, describe, expect, it, vi } from "vitest";
import { printRexAction } from "./action-snippet.js";

describe("printRexAction", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "__REX_ACTION_LUA__");
  });

  it("writes the embedded file once, unchanged, with its final newline", () => {
    const text = "-- Summon: Open workspace…\nrex.action{}\n";
    Object.defineProperty(globalThis, "__REX_ACTION_LUA__", { value: text, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    printRexAction();

    expect(writeSpy.mock.calls).toEqual([[text]]);
    writeSpy.mockRestore();
  });

  it("reads the constant at call time", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    Object.defineProperty(globalThis, "__REX_ACTION_LUA__", { value: "first\n", configurable: true });
    printRexAction();
    Object.defineProperty(globalThis, "__REX_ACTION_LUA__", { value: "second\n", configurable: true });
    printRexAction();

    expect(writeSpy.mock.calls).toEqual([["first\n"], ["second\n"]]);
    writeSpy.mockRestore();
  });
});
