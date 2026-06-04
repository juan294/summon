import { describe, it, expect } from "vitest";
import { sym } from "./symbols.js";

// #478: Canonical glyph vocabulary
describe("sym", () => {
  it("sym.ok is exactly U+2713 (✓)", () => {
    expect(sym.ok).toBe("✓");
  });

  it("sym.warn is exactly U+26A0 (⚠)", () => {
    expect(sym.warn).toBe("⚠");
  });

  it("sym.fail is exactly U+2717 (✗)", () => {
    expect(sym.fail).toBe("✗");
  });

  it("sym.info is middle dot (·)", () => {
    expect(sym.info).toBe("·");
  });

  it("sym.bullet is U+2022 (•)", () => {
    expect(sym.bullet).toBe("•");
  });
});
