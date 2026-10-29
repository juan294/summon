import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRex, rexCandidatePaths, defaultRexServer, runRex, REX_PROCESS_GRACE_MS } from "./cli.js";
import type { RexExec } from "./cli.js";

let root: string;
let savedPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "summon-rex-cli-"));
  savedPath = process.env["PATH"];
  // An empty PATH entry keeps `which rex` from finding a real binary.
  process.env["PATH"] = join(root, "empty-bin");
  mkdirSync(join(root, "empty-bin"));
});

afterEach(() => {
  if (savedPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = savedPath;
  rmSync(root, { recursive: true, force: true });
});

function fakeBinary(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
}

describe("rexCandidatePaths", () => {
  it("lists REX_BIN_DIR first, then the bundled helpers under /Applications and ~/Applications", () => {
    const paths = rexCandidatePaths({ REX_BIN_DIR: "/bin-dir" }, "/Users/me");
    expect(paths).toEqual([
      "/bin-dir/rex",
      "/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
      "/Applications/Rex.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
      "/Users/me/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
      "/Users/me/Applications/Rex.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex",
    ]);
  });

  it("omits the REX_BIN_DIR entry when the variable is unset", () => {
    expect(rexCandidatePaths({}, "/Users/me")[0]).toContain("/Applications/Rex Beta.app");
  });
});

describe("discoverRex", () => {
  it("prefers PATH over every bundle candidate", () => {
    const bin = join(root, "on-path");
    fakeBinary(join(bin, "rex"));
    process.env["PATH"] = bin;
    const bundle = join(root, "Rex Beta.app", "rex");
    fakeBinary(bundle);
    expect(discoverRex({}, [bundle])).toEqual({ path: join(bin, "rex"), searched: ["PATH"] });
  });

  it("walks the candidates in order and reports what it searched", () => {
    const first = join(root, "a", "rex");
    const second = join(root, "b", "rex");
    fakeBinary(second);
    expect(discoverRex({}, [first, second])).toEqual({ path: second, searched: ["PATH", first, second] });
  });

  it("returns null with the full search list when nothing exists", () => {
    const candidate = join(root, "missing", "rex");
    expect(discoverRex({}, [candidate])).toEqual({ path: null, searched: ["PATH", candidate] });
  });

  it("derives candidates from REX_BIN_DIR by default", () => {
    const binDir = join(root, "rex-bin");
    fakeBinary(join(binDir, "rex"));
    expect(discoverRex({ REX_BIN_DIR: binDir }).path).toBe(join(binDir, "rex"));
  });
});

describe("defaultRexServer", () => {
  it("percent-encodes the Application Support path", () => {
    expect(defaultRexServer("/Users/me")).toBe("unix:///Users/me/Library/Application%20Support/rex/server.sock");
  });
});

describe("runRex", () => {
  const opts = { binary: "/opt/rex", server: "unix:///tmp/server.sock", timeoutMs: 4000, autostart: false };

  function fakeExec(impl: (file: string, args: string[], options: Record<string, unknown>) => string): { exec: RexExec; calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> } {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const exec: RexExec = (file, args, options) => {
      calls.push({ file, args, options: options as Record<string, unknown> });
      return impl(file, args, options as Record<string, unknown>);
    };
    return { exec, calls };
  }

  function failure(partial: Record<string, unknown>): Error {
    return Object.assign(new Error("spawn failed"), { status: null, signal: null, stdout: "", stderr: "", ...partial });
  }

  it("prepends the global flags in a fixed order and always passes -S", () => {
    const { exec, calls } = fakeExec(() => "");
    runRex("ls", ["ls", "--json"], opts, exec);
    expect(calls[0]!.file).toBe("/opt/rex");
    expect(calls[0]!.args).toEqual(["--color", "never", "--timeout", "4s", "--autostart=false", "-S", "unix:///tmp/server.sock", "ls", "--json"]);
    const { exec: exec2, calls: calls2 } = fakeExec(() => "");
    runRex("whoami", ["whoami"], { ...opts, autostart: true, timeoutMs: 2500, server: "tcp://host:7777" }, exec2);
    expect(calls2[0]!.args.slice(0, 7)).toEqual(["--color", "never", "--timeout", "3s", "--autostart=true", "-S", "tcp://host:7777"]);
  });

  it("writes input to stdin only when given, never runs through a shell and kills with SIGKILL", () => {
    const { exec, calls } = fakeExec(() => "{}");
    runRex("session-create", ["api", "call", "session.create", "-"], { ...opts, input: '{"label":"x"}' }, exec);
    expect(calls[0]!.options).toMatchObject({ input: '{"label":"x"}', encoding: "utf-8", maxBuffer: 1024 * 1024, killSignal: "SIGKILL", timeout: 4000 + REX_PROCESS_GRACE_MS, stdio: ["pipe", "pipe", "pipe"] });
    expect(calls[0]!.options).not.toHaveProperty("shell");
    const { exec: exec2, calls: calls2 } = fakeExec(() => "");
    runRex("ls", ["ls"], opts, exec2);
    expect(calls2[0]!.options).not.toHaveProperty("input");
    expect(calls2[0]!.options["stdio"]).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("parses JSON when argv carries --json", () => {
    const { exec } = fakeExec(() => '{"sessions":[]}\n');
    const result = runRex("ls", ["ls", "--json"], opts, exec);
    expect(result).toEqual({ ok: true, op: "ls", stdout: '{"sessions":[]}\n', json: { sessions: [] } });
  });

  it("parses JSON for session-create and session-view without --json", () => {
    const { exec } = fakeExec(() => '{"session_id":"session:1"}');
    expect(runRex("session-create", ["api", "call", "session.create", "-"], { ...opts, input: "{}" }, exec)).toMatchObject({ ok: true, json: { session_id: "session:1" } });
    const { exec: exec2 } = fakeExec(() => '{"revision":3}');
    expect(runRex("session-view", ["api", "call", "session.view"], opts, exec2)).toMatchObject({ ok: true, json: { revision: 3 } });
  });

  it("leaves stdout unparsed for a text op", () => {
    const { exec } = fakeExec(() => "focused\n");
    const result = runRex("focus", ["focus", "block:1"], opts, exec);
    expect(result).toEqual({ ok: true, op: "focus", stdout: "focused\n" });
  });

  it("invalid JSON on a JSON op is a malformed failure with the mutating outcome rule", () => {
    const { exec } = fakeExec(() => "not json");
    const created = runRex("session-create", ["api", "call", "session.create", "-"], { ...opts, input: "{}" }, exec);
    expect(created).toMatchObject({ ok: false, kind: "malformed", outcome: "unknown", raw: { code: 0, stdout: "not json", malformed: true } });
    const listed = runRex("ls", ["ls", "--json"], opts, exec);
    expect(listed).toMatchObject({ ok: false, kind: "malformed", outcome: "none" });
  });

  it("ENOENT is a missing-binary failure", () => {
    const { exec } = fakeExec(() => { throw failure({ code: "ENOENT" }); });
    expect(runRex("ls", ["ls"], opts, exec)).toMatchObject({ ok: false, kind: "missing-binary", outcome: "none", raw: { enoent: true, code: null } });
  });

  it("an exceeded output buffer is a malformed failure", () => {
    const { exec } = fakeExec(() => { throw failure({ code: "ENOBUFS", signal: "SIGKILL", stdout: "x".repeat(10) }); });
    expect(runRex("session-view", ["api", "call", "session.view"], opts, exec)).toMatchObject({ ok: false, kind: "malformed", raw: { malformed: true } });
  });

  it("a process timeout is reported as timedOut even though the kill signal is set", () => {
    const { exec } = fakeExec(() => { throw failure({ code: "ETIMEDOUT", signal: "SIGKILL" }); });
    expect(runRex("session-create", ["api", "call", "session.create", "-"], { ...opts, input: "{}" }, exec)).toMatchObject({ ok: false, kind: "timeout", outcome: "unknown", raw: { timedOut: true, signal: "SIGKILL" } });
  });

  it("a non-zero exit carries the status and both streams into the classifier", () => {
    const { exec } = fakeExec(() => { throw failure({ status: 3, stderr: 'Error: session target "x" not found\n', stdout: "" }); });
    const result = runRex("focus", ["focus", "x"], opts, exec);
    expect(result).toMatchObject({ ok: false, kind: "not-found", outcome: "none", reason: 'Error: session target "x" not found', raw: { code: 3, signal: null } });
  });

  it("stream buffers are decoded when the error carries Buffers", () => {
    const { exec } = fakeExec(() => { throw failure({ status: 1, stderr: Buffer.from("Error: boom\n"), stdout: Buffer.from("") }); });
    expect(runRex("ls", ["ls"], opts, exec)).toMatchObject({ ok: false, kind: "failed", reason: "Error: boom" });
  });

  it("rejects a timeout below one second so the Rex --timeout flag is never 0s", () => {
    expect(() => runRex("ls", ["ls"], { ...opts, timeoutMs: 0 }, fakeExec(() => "").exec)).toThrow("timeoutMs");
  });
});
