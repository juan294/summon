import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: exec }));
import { readNativeInventory, focusTerminal, generateInventoryScript, generateNativeFocusScript, generateTitleScript, titleTerminal } from "./native.js";
import { validateTitleText } from "../../ui/sanitize.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const app = mkdtempSync(join(tmpdir(), "summon-native-bundle-"));
mkdirSync(join(app, "Contents/Resources"), { recursive: true });
writeFileSync(
  join(app, "Contents/Resources/Ghostty.sdef"),
  '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/></class>',
);
afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  exec.mockReset();
  writeFileSync(join(app,"Contents/Resources/Ghostty.sdef"),'<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/><property name="name override" access="rw"/></class><class name="tab"><property name="name override" access="rw"/></class>');
});
describe("native bridge", () => {
  it("P2-json-roundtrip retains arbitrary native text; pid zero/empty tty become null", () => {
    const title = 'tab\t"quote"\r\n\\🦊';
    exec.mockReturnValue(
      JSON.stringify([
        {
          terminalId: id,
          pid: 0,
          tty: "",
          title,
          directory: "/tmp/ü",
          tabId: id,
          windowId: id,
          focused: false,
        },
      ]),
    );
    expect(readNativeInventory([id], app)).toEqual({
      kind: "available",
      panes: [
        {
          terminalId: id,
          pid: null,
          tty: null,
          title,
          directory: "/tmp/ü",
          tabId: id,
          windowId: id,
          focused: false,
        },
      ],
    });
    expect(exec).toHaveBeenCalledWith(
      "osascript",
      [],
      expect.objectContaining({ timeout: 3000, maxBuffer: 1024 * 1024 }),
    );
  });
  it("P2-readonly-inspect emits no activation/close or marker writes", () => {
    const script = generateInventoryScript([id]);
    expect(script).toContain("NSJSONSerialization");
    expect(script).toContain("is not running");
    expect(script).not.toMatch(
      /\bactivate\b|\bclose\b|input text|do shell script|\.active|\.pid/,
    );
  });
  it("P2-identical-cwd-title focuses exact UUID only and confirms readback", () => {
    exec.mockReturnValue(JSON.stringify({ focused: true, terminalId: id }));
    expect(focusTerminal(id, app)).toEqual({ kind: "focused", terminalId: id });
    const script = exec.mock.calls[0]![2].input as string;
    expect(script).toContain(`set wantedId to "${id}"`);
    expect(script).toContain("set p to terminal id wantedId");
    expect(script).toContain(
      "id of focused terminal of selected tab of front window",
    );
    expect(script).not.toContain("working directory");
  });
  it("batches container UUID enumeration and stops after exact targets are resolved", () => {
    const focus = generateNativeFocusScript(id);
    const inventory = generateInventoryScript([id]);
    for (const script of [focus, inventory]) {
      expect(script).toContain("set liveIds to id of every terminal of t");
      expect(script).not.toContain("repeat with p in terminals of t");
    }
    expect(focus).toContain("if targetFound then exit repeat");
    expect(focus).toContain("if liveIds contains wantedId then");
    expect(inventory).toContain("if remainingCount is 0 then exit repeat");
    expect(inventory).toContain("set p to terminal id (wantedId as text)");
  });
  it("P2-missing-identity never reports a false successful focus", () => {
    exec.mockReturnValue('{"focused":false}');
    expect(focusTerminal(id, app)).toMatchObject({
      kind: "unavailable",
      code: "missing",
    });
    exec.mockReturnValue(
      JSON.stringify({
        focused: true,
        terminalId: "00000000-0000-4000-8000-000000000002",
      }),
    );
    expect(focusTerminal(id, app)).toMatchObject({ kind: "failed" });
  });
  it("P2-permission-recovery retries on next call and does not leak raw native errors", () => {
    exec.mockImplementationOnce(() => {
      throw new Error("secret environment -1743 Not authorized");
    });
    const denied = readNativeInventory([id], app);
    expect(denied).toMatchObject({ kind: "unavailable", code: "permission" });
    expect(JSON.stringify(denied)).not.toContain("secret");
    expect(JSON.stringify(denied)).toContain("Automation");
    exec.mockReturnValue("[]");
    expect(readNativeInventory([id], app)).toEqual({
      kind: "available",
      panes: [],
    });
  });
  it.each([
    { error: new Error("bad") },
    { error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) },
    { error: new Error("-1719 assistive access") },
  ])("maps native errors visibly without retry", ({ error }) => {
    exec.mockImplementation(() => {
      throw error;
    });
    expect(focusTerminal(id, app).kind).not.toBe("focused");
    expect(exec).toHaveBeenCalledTimes(1);
  });
  it.each([
    "not-json",
    "{}",
    "[{}]",
    JSON.stringify([{ terminalId: id, pid: -1, tty: 3, title: "x" }]),
    "x".repeat(1024 * 1024 + 1),
  ])("rejects malformed or oversized output", (output) => {
    exec.mockReturnValue(output);
    expect(readNativeInventory([id], app).kind).toBe("unavailable");
  });
  it("P2 capability recovery rejects old/unavailable dictionary before native IO", () => {
    const dictionary = join(app, "Contents/Resources/Ghostty.sdef");
    writeFileSync(
      dictionary,
      '<class name="terminal"><property name="id"/></class>',
    );
    expect(readNativeInventory([id], app)).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("upgrade"),
    });
    expect(exec).not.toHaveBeenCalled();
    writeFileSync(
      dictionary,
      '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/></class>',
    );
    exec.mockReturnValue("[]");
    expect(readNativeInventory([id], app).kind).toBe("available");
    expect(readNativeInventory([id], join(app, "missing"))).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("doctor"),
    });
  });
  it("rejects invalid UUIDs before native IO", () => {
    expect(() => generateNativeFocusScript('a" & dangerous')).toThrow(
      /identity/,
    );
    expect(() => generateInventoryScript(["invalid"])).toThrow(/identity/);
    expect(exec).not.toHaveBeenCalled();
  });
});


describe("P4 native title controls", () => {
  it("read is side-effect-free and resolves current container by UUID", () => {
    const script = generateTitleScript(id, "tab", { kind: "read" });
    expect(script).toContain("set liveIds to id of every terminal of t");
    expect(script).toContain("set titleTarget to t");
    expect(script).toContain("name override of titleTarget");
    expect(script).not.toMatch(
      /\bactivate\b|\bfocus\b|\bclose\b|set name override/,
    );
    exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "tab",
        override: 'existing\n\t"🦊',
      }),
    );
    expect(titleTerminal(id, "tab", { kind: "read" }, app)).toEqual({
      kind: "title",
      terminalId: id,
      scope: "tab",
      override: 'existing\n\t"🦊',
    });
  });
  it("set/reset confirms exact override without changing identity", () => {
    const title = 'work "a" \\ 🦊';
    exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "pane",
        override: title,
      }),
    );
    expect(
      titleTerminal(id, "pane", { kind: "set", text: title }, app),
    ).toEqual({
      kind: "title",
      terminalId: id,
      scope: "pane",
      override: title,
    });
    expect(exec.mock.calls[0]![2].input).toContain(
      "set name override of titleTarget to",
    );
    exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "pane",
        override: "",
      }),
    );
    expect(titleTerminal(id, "pane", { kind: "reset" }, app)).toMatchObject({
      kind: "title",
      override: "",
    });
  });
  it.each([
    "",
    "x\n",
    "x\r",
    "x\t",
    "\x00",
    "\x7f",
    "\x9f",
    "\u202a",
    "\u202e",
    "\u2066",
    "\u2069",
    "🦊".repeat(257),
  ])("rejects invalid title before native IO", (text) => {
    expect(validateTitleText(text)).not.toBeNull();
    expect(() =>
      generateTitleScript(id, "pane", { kind: "set", text }),
    ).toThrow();
    expect(exec).not.toHaveBeenCalled();
  });
  it("counts Unicode codepoints and preserves spaces", () => {
    expect(validateTitleText("🦊".repeat(256))).toBeNull();
    expect(validateTitleText("  ")).toBeNull();
  });
  it("capability failure prevents writes and can recover", () => {
    writeFileSync(
      join(app, "Contents/Resources/Ghostty.sdef"),
      '<class name="terminal"><property name="id"/></class>',
    );
    expect(
      titleTerminal(id, "tab", { kind: "set", text: "title" }, app),
    ).toMatchObject({ kind: "unavailable" });
    expect(exec).not.toHaveBeenCalled();
    writeFileSync(join(app, "Contents/Resources/Ghostty.sdef"), '<class name="terminal"><property name="id"/><property name="name override" access="rw"/></class><class name="tab"><property name="name override" access="rw"/></class>');
    exec.mockReturnValue(JSON.stringify({found:true,terminalId:id,scope:"tab",override:"title"}));
    expect(titleTerminal(id,"tab",{kind:"set",text:"title"},app).kind).toBe("title");
  });
  it("timeout/malformed/mismatched mutation result is unknown; no automatic retry", () => {
    exec.mockImplementationOnce(() => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    });
    expect(
      titleTerminal(id, "tab", { kind: "set", text: "title" }, app),
    ).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("unknown"),
    });
    expect(exec).toHaveBeenCalledTimes(1);
    for (const output of [
      "invalid",
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "tab",
        override: "other",
      }),
    ]) {
      exec.mockReturnValue(output);
      expect(
        titleTerminal(id, "tab", { kind: "set", text: "title" }, app),
      ).toMatchObject({
        kind: "failed",
        reason: expect.stringMatching(/read/i),
      });
    }
    exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "tab",
        override: "title",
      }),
    );
    expect(titleTerminal(id, "tab", { kind: "read" }, app).kind).toBe("title");
  });
  it("missing target exits unavailable without false mutation success", () => {
    exec.mockReturnValue('{"found":false}');
    expect(titleTerminal(id, "tab", { kind: "reset" }, app)).toMatchObject({
      kind: "unavailable",
      code: "missing",
    });
  });
});
