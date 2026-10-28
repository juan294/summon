import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: exec }));
import {
  discoverGhostty,
  parseVersion,
  parseEffectiveConfig,
  probeGhostty,
  probeGhosttyDetach,
} from "./ghostty.js";

let temp: string;
const config =
  "shell-integration = detect\nnotify-on-command-finish = unfocused\nscrollback-compression = true\nlink-osc8 = true\nclipboard-read = ask\nclipboard-write = allow\nvt-window-resize-allowed = false\nvt-xt-checksum-report = false\n";
const dictionary =
  '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/><property name="name override" access="rw"/></class><class name="tab"><property name="name override" access="rw"/></class>';
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "summon-ghostty-"));
  mkdirSync(join(temp, "Contents/Resources"), { recursive: true });
  mkdirSync(join(temp, "Contents/MacOS"), { recursive: true });
  writeFileSync(join(temp, "Contents/MacOS/ghostty"), "");
  writeFileSync(join(temp, "Contents/Resources/Ghostty.sdef"), dictionary);
  exec.mockReset();
  exec.mockImplementation((_binary: string, args: string[]) => {
    if (args[0] === "--version") return "Ghostty 1.4.0\n  - channel: stable\n";
    if (args[0] === "+list-actions")
      return "move_tab_to_new_window\nset_tab_title\n";
    if (args.includes("--help")) return "--default --changes-only --no-pager";
    return config;
  });
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));
describe("bounded Ghostty diagnostics", () => {
  it("discovers only a known existing bundle binary", () => {
    expect(discoverGhostty([join(temp, "missing"), temp])).toBe(temp);
    expect(discoverGhostty([join(temp, "missing")])).toBeNull();
  });
  it("parses stable and prerelease versions without claiming unknown security", () => {
    expect(parseVersion("Ghostty 1.3.1")).toEqual({
      text: "1.3.1",
      recommended: false,
      stable: true,
    });
    expect(parseVersion("Ghostty 1.4.0-dev+abc")).toEqual({
      text: "1.4.0-dev+abc",
      recommended: false,
      stable: false,
    });
    expect(parseVersion("Ghostty 1.10.0")).toMatchObject({ recommended: true });
    expect(parseVersion("broken 1.4")).toBeNull();
  });
  it("reads allowlisted scalar values only, poisoning malformed/repeated targets", () => {
    const values = parseEffectiveConfig(
      config +
        "env = TOKEN=secret\nclipboard-read = deny\nshell-integration nope\n",
    );
    expect(values["clipboard-read"]).toBeNull();
    expect(values["shell-integration"]).toBeNull();
    expect(values["link-osc8"]).toBe("true");
    expect(JSON.stringify(values)).not.toContain("secret");
    expect(
      parseEffectiveConfig("clipboard-write = surprise")["clipboard-write"],
    ).toBeNull();
  });
  it("probes installed-style dictionary/actions/config with bounded argv execution", () => {
    const result = probeGhostty(temp);
    expect(result.version?.recommended).toBe(true);
    expect(result.capabilities.foreground.state).toBe("supported");
    expect(result.capabilities.titleOverride.state).toBe("supported");
    expect(result.capabilities.detachTab.state).toBe("supported");
    expect(result.config["shell-integration"]).toBe("detect");
    expect(exec).toHaveBeenCalledWith(
      join(temp, "Contents/MacOS/ghostty"),
      ["--version"],
      expect.objectContaining({
        timeout: 2000,
        maxBuffer: 1048576,
        encoding: "utf-8",
      }),
    );
    expect(exec).toHaveBeenCalledWith(
      join(temp, "Contents/MacOS/ghostty"),
      ["+show-config", "--no-pager", "--changes-only=false"],
      expect.objectContaining({ timeout: 3000, maxBuffer: 1048576 }),
    );
  });
  it("merges defaults and empty changes for old CLI using documented flags", () => {
    exec.mockImplementation((_b: string, args: string[]) => {
      if (args[0] === "--version") return "Ghostty 1.3.1";
      if (args[0] === "+list-actions") return "set_tab_title";
      if (args.includes("--changes-only=false")) throw new Error("unsupported");
      if (args.includes("--help")) return "--default --no-pager";
      return args.includes("--default") ? config : "";
    });
    const result = probeGhostty(temp);
    expect(result.version?.recommended).toBe(false);
    expect(result.config["shell-integration"]).toBe("detect");
    expect(result.capabilities.detachTab.state).toBe("unsupported");
  });
  it.each(["timeout", "nonzero", "truncated"])(
    "recovers next invocation after %s without persistent errors",
    () => {
      exec.mockImplementationOnce(() => {
        throw new Error("probe unavailable");
      });
      expect(probeGhostty(temp).version).toBeNull();
      expect(probeGhostty(temp).version?.recommended).toBe(true);
    },
  );
  it("rejects malformed/oversized output and missing dictionary/action evidence", () => {
    writeFileSync(join(temp, "Contents/Resources/Ghostty.sdef"), "");
    exec.mockImplementation((_b: string, args: string[]) =>
      args[0] === "--version" ? "nonsense" : "",
    );
    const result = probeGhostty(temp);
    expect(result.version).toBeNull();
    expect(result.capabilities.nativeIdentity.state).toBe("unavailable");
    expect(result.capabilities.detachTab.state).toBe("unavailable");
    expect(result.capabilities.effectiveConfig.state).toBe("unavailable");
    exec.mockReturnValue("x".repeat(1048577));
    expect(probeGhostty(temp).version).toBeNull();
  });
  it("reports missing app without executing processes", () => {
    expect(probeGhostty(null).app).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });
});


describe("P4 cheap detach capability",()=>{
 it("queries actions only with bounded shell-free argv",()=>{
  expect(probeGhosttyDetach(temp).state).toBe("supported");expect(exec).toHaveBeenCalledTimes(1);expect(exec).toHaveBeenCalledWith(join(temp,"Contents/MacOS/ghostty"),["+list-actions"],expect.objectContaining({timeout:3000,maxBuffer:1048576}));
 });
 it("old/unknown capabilities disclose and retry on a new invocation",()=>{
  exec.mockReturnValue("set_tab_title\n");expect(probeGhosttyDetach(temp).state).toBe("unsupported");exec.mockImplementationOnce(()=>{throw new Error("timeout");});expect(probeGhosttyDetach(temp).state).toBe("unavailable");exec.mockReturnValue("move_tab_to_new_window\n");expect(probeGhosttyDetach(temp).state).toBe("supported");expect(probeGhosttyDetach(null).state).toBe("unavailable");
 });
});
