import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRex, rexCandidatePaths, defaultRexServer, createRexCli, resolveBlockSession, runRex, runRexAsync, execRexAsync, REX_PROCESS_GRACE_MS } from "./cli.js";
import type { RexExec, RexExecAsync } from "./cli.js";

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

describe("runRexAsync", () => {
  const opts = { binary: "/opt/rex", server: "unix:///tmp/server.sock", timeoutMs: 2000, autostart: false };

  function syncFailure(partial: Record<string, unknown>): Error {
    return Object.assign(new Error("spawn failed"), { status: null, signal: null, stdout: "", stderr: "", ...partial });
  }

  function asyncFailure(partial: Record<string, unknown>): Error {
    return Object.assign(new Error("Command failed"), { code: null, killed: false, signal: null, stdout: "", stderr: "", ...partial });
  }

  it("passes the same argv as runRex and the timeout and signal to the process boundary", async () => {
    const seen: Array<{ file: string; args: string[]; options: Parameters<RexExecAsync>[2] }> = [];
    const exec: RexExecAsync = async (file, args, options) => { seen.push({ file, args, options }); return '{"blocks":[]}'; };
    const signal = new AbortController().signal;
    const result = await runRexAsync("block-ls", ["block", "ls", "-s", "session:1", "--json"], { ...opts, signal }, exec);
    expect(result).toEqual({ ok: true, op: "block-ls", stdout: '{"blocks":[]}', json: { blocks: [] } });
    const syncArgs: string[][] = [];
    runRex("block-ls", ["block", "ls", "-s", "session:1", "--json"], opts, (_f, args) => { syncArgs.push(args); return "{}"; });
    expect(seen[0]!.file).toBe("/opt/rex");
    expect(seen[0]!.args).toEqual(syncArgs[0]);
    expect(seen[0]!.options).toEqual({ timeoutMs: 2000, signal });
  });

  it("classifies each failure exactly as runRex does", async () => {
    const cases: Array<{ name: string; sync: Record<string, unknown>; async: Record<string, unknown> }> = [
      { name: "missing binary", sync: { code: "ENOENT" }, async: { code: "ENOENT" } },
      { name: "process timeout", sync: { code: "ETIMEDOUT", signal: "SIGKILL" }, async: { killed: true, signal: "SIGKILL" } },
      { name: "exit 3 not found", sync: { status: 3, stderr: 'Error: method "x" not found\n' }, async: { code: 3, stderr: 'Error: method "x" not found\n' } },
      { name: "exit 4 unreachable", sync: { status: 4, stderr: "Error: could not connect\n" }, async: { code: 4, stderr: "Error: could not connect\n" } },
      { name: "exit 1 failed", sync: { status: 1, stderr: "Error: boom\n" }, async: { code: 1, stderr: "Error: boom\n" } },
      { name: "output too large", sync: { code: "ENOBUFS", signal: "SIGKILL" }, async: { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGKILL" } },
      { name: "killed by a signal", sync: { signal: "SIGTERM" }, async: { signal: "SIGTERM" } },
    ];
    for (const c of cases) {
      const sync = runRex("block-call", ["block", "call", "ports"], opts, () => { throw syncFailure(c.sync); });
      const asyncResult = await runRexAsync("block-call", ["block", "call", "ports"], opts, async () => { throw asyncFailure(c.async); });
      expect(asyncResult, c.name).toEqual(sync);
    }
  });

  it("a call ended by its signal is a timeout", async () => {
    const aborted = Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" });
    expect(await runRexAsync("block-call", ["block", "call", "ports"], opts, async () => { throw aborted; })).toMatchObject({ ok: false, kind: "timeout", raw: { timedOut: true, signal: null } });
  });

  it("invalid JSON is malformed and a too short timeout is refused", async () => {
    expect(await runRexAsync("block-call", ["block", "call", "ports"], opts, async () => "nope")).toMatchObject({ ok: false, kind: "malformed" });
    await expect(runRexAsync("ls", ["ls"], { ...opts, timeoutMs: 10 }, async () => "")).rejects.toThrow("runRexAsync: timeoutMs");
  });

  it("execRexAsync runs a real binary without a shell, closes stdin and reports the exit status in code", async () => {
    const bin = join(root, "fake-rex");
    writeFileSync(bin, '#!/bin/sh\nif [ "$1" = fail ]; then echo "Error: nope" >&2; exit 3; fi\ncat >/dev/null\nprintf "%s|" "$@"\n');
    chmodSync(bin, 0o755);
    expect(await execRexAsync(bin, ["a b", "$HOME"], { timeoutMs: 2000 })).toBe("a b|$HOME|");
    expect(await execRexAsync(bin, ["x"], { timeoutMs: 2000, input: "ignored" })).toBe("x|");
    await expect(execRexAsync(bin, ["fail"], { timeoutMs: 2000 })).rejects.toMatchObject({ code: 3, stderr: "Error: nope\n" });
  });

  it("execRexAsync stops a running child when its signal aborts", async () => {
    const bin = join(root, "slow-rex");
    writeFileSync(bin, "#!/bin/sh\nexec /bin/sleep 30\n");
    chmodSync(bin, 0o755);
    const controller = new AbortController();
    const started = Date.now();
    const pending = runRexAsync("block-call", ["block", "call", "ports"], { ...opts, binary: bin, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toMatchObject({ ok: false, kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("createRexCli / probeWhoami (Phase 3)", () => {
  it("binds the binary and server and forwards per-call options with read-only defaults", async () => {
    const { createRexCli } = await import("./cli.js");
    const exec = vi.fn(() => "{}");
    const cli = createRexCli("/mock/rex", "unix:///mock/server.sock", exec);
    cli.call("ls", ["ls", "--json"]);
    expect(exec).toHaveBeenLastCalledWith("/mock/rex", ["--color", "never", "--timeout", "8s", "--autostart=false", "-S", "unix:///mock/server.sock", "ls", "--json"], expect.objectContaining({ timeout: 10_000 }));
    cli.call("session-create", ["api", "call", "session.create", "-"], { input: "{}", timeoutMs: 10_000, autostart: true });
    expect(exec).toHaveBeenLastCalledWith("/mock/rex", ["--color", "never", "--timeout", "10s", "--autostart=true", "-S", "unix:///mock/server.sock", "api", "call", "session.create", "-"], expect.objectContaining({ input: "{}", timeout: 12_000 }));
  });

  it("probeWhoami answers with the host id and the caller's session when the server replies", async () => {
    const { probeWhoami } = await import("./cli.js");
    const exec = vi.fn(() => JSON.stringify({ host_id: "host-1", session_id: "session:1", endpoint: "unix:///x" }));
    expect(probeWhoami("/mock/rex", "unix:///x", exec)).toEqual({ answers: true, hostId: "host-1", sessionId: "session:1" });
    expect(exec).toHaveBeenCalledWith("/mock/rex", ["--color", "never", "--timeout", "1s", "--autostart=false", "-S", "unix:///x", "whoami", "--json"], expect.objectContaining({ timeout: 3000 }));
  });

  it("probeWhoami does not answer when the host id carries control characters, and drops such a session id (Strix CWE-150)", async () => {
    const { probeWhoami } = await import("./cli.js");
    expect(probeWhoami("/mock/rex", "unix:///x", vi.fn(() => JSON.stringify({ host_id: "host\u001b]52;c;aGk=\u0007" })))).toEqual({ answers: false, reason: "rex whoami returned an unusable host id" });
    expect(probeWhoami("/mock/rex", "unix:///x", vi.fn(() => JSON.stringify({ host_id: "host\u202e1" })))).toEqual({ answers: false, reason: "rex whoami returned an unusable host id" });
    expect(probeWhoami("/mock/rex", "unix:///x", vi.fn(() => JSON.stringify({ host_id: "host-1", session_id: "session:\u001b[2K" })))).toEqual({ answers: true, hostId: "host-1" });
  });

  it("probeWhoami does not answer on failure or when the host id is missing", async () => {
    const { probeWhoami } = await import("./cli.js");
    const failing = vi.fn(() => { throw Object.assign(new Error("exit 4"), { status: 4, stderr: "Error: dial unix: connect: no such file\n" }); });
    expect(probeWhoami("/mock/rex", "unix:///x", failing)).toEqual({ answers: false, reason: "Error: dial unix: connect: no such file" });
    const noHost = vi.fn(() => JSON.stringify({ endpoint: "unix:///x" }));
    expect(probeWhoami("/mock/rex", "unix:///x", noHost)).toEqual({ answers: false, reason: "rex whoami returned no host id" });
  });
});

describe("resolveBlockSession", () => {
  const block = "block:0000aaaa-0000-0000-0000-000000000010";
  const other = "block:0000aaaa-0000-0000-0000-000000000011";
  const session = "session:0000aaaa-0000-0000-0000-000000000001";

  it("scopes inspection to the requested block on the bound server and returns its canonical session", () => {
    const exec = vi.fn<RexExec>(() => JSON.stringify({ session_id: session, block: { block_id: block } }));
    const cli = createRexCli("rex", "unix:///tmp/owned.sock", exec);
    expect(resolveBlockSession(cli, block)).toBe(session);
    expect(exec.mock.calls[0]![1]).toEqual(["--color", "never", "--timeout", "2s", "--autostart=false", "-S", cli.server, "block", "inspect", "-s", block, block, "--json"]);
  });

  it("refuses invalid input, a different block, a bad session ID, and an unavailable server", () => {
    const exec = vi.fn<RexExec>(() => JSON.stringify({ session_id: session, block: { block_id: other } }));
    const cli = createRexCli("rex", "unix:///tmp/owned.sock", exec);
    expect(resolveBlockSession(cli, "--help")).toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
    expect(resolveBlockSession(cli, block)).toBeUndefined();
    for (const answer of ["{}", JSON.stringify({ session_id: other, block: { block_id: block } })]) {
      expect(resolveBlockSession(createRexCli("rex", cli.server, () => answer), block)).toBeUndefined();
    }
    expect(resolveBlockSession(createRexCli("rex", cli.server, () => { throw Object.assign(new Error("unavailable"), { status: 4 }); }), block)).toBeUndefined();
  });
});
