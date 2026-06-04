import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalIsTTY = process.stdout.isTTY;
const originalNoColor = process.env.NO_COLOR;
const originalForceColor = process.env.FORCE_COLOR;
const originalColorterm = process.env.COLORTERM;

async function loadAnsiModule() {
  vi.resetModules();
  return import("./ansi.js");
}

beforeEach(() => {
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  delete process.env.COLORTERM;
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
});

afterEach(() => {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
  if (originalForceColor === undefined) {
    delete process.env.FORCE_COLOR;
  } else {
    process.env.FORCE_COLOR = originalForceColor;
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

  // #477: FORCE_COLOR support — color functions must call supportsColor() at invocation time
  it("enables color when FORCE_COLOR=1 even without isTTY", async () => {
    // isTTY is false (set in beforeEach), but FORCE_COLOR=1 forces color on
    process.env.FORCE_COLOR = "1";
    const ansi = await loadAnsiModule();

    expect(ansi.bold("text")).toBe("\x1b[1mtext\x1b[0m");
    expect(ansi.green("ok")).toBe("\x1b[32mok\x1b[0m");
  });

  it("disables color when FORCE_COLOR=0 even with isTTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.FORCE_COLOR = "0";
    const ansi = await loadAnsiModule();

    expect(ansi.bold("text")).toBe("text");
    expect(ansi.green("ok")).toBe("ok");
  });

  it("respects NO_COLOR over isTTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.NO_COLOR = "1";
    const ansi = await loadAnsiModule();

    expect(ansi.bold("text")).toBe("text");
    expect(ansi.green("ok")).toBe("ok");
  });

  it("truncateLine returns string unchanged when within width", async () => {
    const ansi = await loadAnsiModule();
    expect(ansi.truncateLine("hello world", 20)).toBe("hello world");
  });

  it("truncateLine truncates to width with ellipsis", async () => {
    const ansi = await loadAnsiModule();
    const result = ansi.truncateLine("a very long line here", 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith("…")).toBe(true);
  });
});
