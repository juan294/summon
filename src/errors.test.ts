import { describe, it, expect } from "vitest";
import { TabOpenError } from "./errors.js";

describe("TabOpenError", () => {
  it("is instanceof Error", () => {
    expect(new TabOpenError("x")).toBeInstanceOf(Error);
  });

  it("has name TabOpenError", () => {
    expect(new TabOpenError("x").name).toBe("TabOpenError");
  });

  it("preserves the message", () => {
    expect(new TabOpenError("test message").message).toBe("test message");
  });

  it("accepts a cause option", () => {
    const cause = new Error("root cause");
    const err = new TabOpenError("wrapper", { cause });
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
  });
});
