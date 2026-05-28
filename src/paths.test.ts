import { describe, it, expect } from "vitest";
import {
  CONFIG_DIR,
  STATUS_DIR,
  SNAPSHOTS_DIR,
  LAYOUTS_DIR,
  TRUST_FILE,
} from "./paths.js";

describe("paths constants", () => {
  it("CONFIG_DIR is a string containing summon", () => {
    expect(typeof CONFIG_DIR).toBe("string");
    expect(CONFIG_DIR).toContain("summon");
  });

  it("STATUS_DIR is a string containing summon", () => {
    expect(typeof STATUS_DIR).toBe("string");
    expect(STATUS_DIR).toContain("summon");
  });

  it("SNAPSHOTS_DIR is a string containing summon", () => {
    expect(typeof SNAPSHOTS_DIR).toBe("string");
    expect(SNAPSHOTS_DIR).toContain("summon");
  });

  it("LAYOUTS_DIR is a string containing summon", () => {
    expect(typeof LAYOUTS_DIR).toBe("string");
    expect(LAYOUTS_DIR).toContain("summon");
  });

  it("TRUST_FILE is a string containing summon", () => {
    expect(typeof TRUST_FILE).toBe("string");
    expect(TRUST_FILE).toContain("summon");
  });

  it("STATUS_DIR is nested under CONFIG_DIR", () => {
    expect(STATUS_DIR.startsWith(CONFIG_DIR)).toBe(true);
  });

  it("SNAPSHOTS_DIR is nested under CONFIG_DIR", () => {
    expect(SNAPSHOTS_DIR.startsWith(CONFIG_DIR)).toBe(true);
  });

  it("LAYOUTS_DIR is nested under CONFIG_DIR", () => {
    expect(LAYOUTS_DIR.startsWith(CONFIG_DIR)).toBe(true);
  });

  it("TRUST_FILE is nested under CONFIG_DIR", () => {
    expect(TRUST_FILE.startsWith(CONFIG_DIR)).toBe(true);
  });
});
