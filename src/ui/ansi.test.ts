import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalIsTTY = process.stdout.isTTY;
const originalNoColor = process.env.NO_COLOR;
const originalColorterm = process.env.COLORTERM;

async function loadAnsiModule() {
  vi.resetModules();
  return import("./ansi.js");
}

beforeEach(() => {
  delete process.env.NO_COLOR;
  delete process.env.COLORTERM;
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
});

afterEach(() => {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
  if (originalColorterm === undefined) {
    delete process.env.COLORTERM;
  } else {
    process.env.COLORTERM = originalColorterm;
  }
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
});

describe("ansi helpers", () => {
  it("returns raw strings when color is disabled", async () => {
    const ansi = await loadAnsiModule();

    expect(ansi.wrap("32", "ok")).toBe("ok");
    expect(ansi.bold("text")).toBe("text");
    expect(ansi.green("text")).toBe("text");
    expect(ansi.yellow("text")).toBe("text");
    expect(ansi.cyan("text")).toBe("text");
    expect(ansi.magenta("text")).toBe("text");
    expect(ansi.brightCyan("text")).toBe("text");
    expect(ansi.colorSwatch(["#00ff00"])).toBe("");
  });

  it("wraps ANSI output when color is enabled", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const ansi = await loadAnsiModule();

    expect(ansi.dim("muted")).toBe("\x1b[2mmuted\x1b[0m");
    expect(ansi.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });

  it("supports truecolor swatches and hex parsing", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.COLORTERM = "truecolor";
    const ansi = await loadAnsiModule();

    expect(ansi.hexToRgb("#336699")).toEqual([51, 102, 153]);
    expect(ansi.hexToRgb("ff00aa")).toEqual([255, 0, 170]);
    expect(ansi.colorSwatch(["#336699", "#ff00aa"])).toBe(
      "\x1b[38;2;51;102;153m██\x1b[0m\x1b[38;2;255;0;170m██\x1b[0m",
    );
  });
});
