// UX-L2: every wizard tip is correct for the backend it is shown under, and every command it names parses.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Layout validation may list custom layouts: never from the real ~/.config/summon.
const home = mkdtempSync(join(tmpdir(), "summon-tips-test-"));
vi.mock("node:os", async (original) => ({ ...(await original<typeof import("node:os")>()), homedir: () => home }));

const { TIPS, tipsFor, getRandomTip } = await import("./setup.js");
const { parseCli } = await import("./cli/parse.js");
const { CLI_FLAGS } = await import("./config.js");

/** The dispatch registry's subcommands, read from the entry point (importing it would run the CLI). */
const SUBCOMMANDS = new Set(
  [...readFileSync(new URL("./index.ts", import.meta.url), "utf8").matchAll(/^\s+(\w+):\s+\(\) => import\(/gm)].map((m) => m[1]!),
);
const PLACEHOLDERS: Record<string, string> = { "<name>": "demo", "<path>": "/tmp/demo", "<cmd>": "vim", "<project>": "demo", "<project>...": "demo" };

afterEach(() => vi.restoreAllMocks());

describe("wizard tips (UX-L2)", () => {
  it("reads the registry", () => {
    expect(SUBCOMMANDS.has("status")).toBe(true);
    expect(SUBCOMMANDS.has("session")).toBe(true);
  });

  it.each(TIPS.filter((tip) => tip.command).map((tip) => [tip.command!, tip] as const))("%s parses as written in its tip", (command, tip) => {
    expect(tip.text).toContain(command);
    const [bin, ...words] = command.split(" ");
    expect(bin).toBe("summon");
    const argv = words.map((w) => PLACEHOLDERS[w] ?? w);
    expect(argv.every((w) => !w.startsWith("<"))).toBe(true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const parsed = parseCli(argv);
    // A launch target is a path; anything else must be a real subcommand.
    expect(parsed.subcommand === "." || SUBCOMMANDS.has(parsed.subcommand ?? ""), command).toBe(true);
  });

  it("names only real flags", () => {
    for (const tip of TIPS) for (const flag of tip.text.match(/--[a-z-]+/g) ?? []) expect(CLI_FLAGS, tip.text).toContain(flag);
  });

  it("says what each command really does", () => {
    const texts = TIPS.map((tip) => tip.text);
    expect(texts.some((t) => t.includes("session save"))).toBe(false);
    expect(texts.some((t) => t.includes("AppleScript"))).toBe(false);
    expect(texts.some((t) => t.includes("in the first pane"))).toBe(false);
    expect(texts.some((t) => t.includes("listening"))).toBe(false);
    expect(texts).toContain("The --on-start flag runs a command before the workspace is created");
  });

  it("shows Ghostty-only tips under Ghostty only, Rex-only tips under Rex only, and only shared tips when undetected", () => {
    const fontSize = TIPS.find((tip) => tip.text.includes("--font-size"))!;
    expect(fontSize.backend).toBe("ghostty");
    expect(tipsFor("ghostty")).toContain(fontSize);
    expect(tipsFor("rex")).not.toContain(fontSize);
    for (const tip of tipsFor("rex")) expect(tip.backend === undefined || tip.backend === "rex").toBe(true);
    for (const tip of tipsFor(undefined)) expect(tip.backend).toBeUndefined();
    expect(tipsFor("rex").some((tip) => tip.backend === "rex")).toBe(true);
  });

  it("getRandomTip draws from the backend's tips", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const rex = tipsFor("rex");
    expect(getRandomTip("rex")).toBe(rex[rex.length - 1]!.text);
  });
});
