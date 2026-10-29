import { describe, it, expect } from "vitest";
import { classifyRexFailure } from "./errors.js";
import { isMutatingOp } from "./types.js";
import type { RexOp, RexRawResult } from "./types.js";

function raw(partial: Partial<RexRawResult>): RexRawResult {
  return { code: null, signal: null, timedOut: false, enoent: false, stdout: "", stderr: "", ...partial };
}

const MUTATING: RexOp[] = ["session-create", "focus", "do-select", "do-window-new", "kill", "window-rename", "block-label"];
const READ_ONLY: RexOp[] = ["whoami", "ls", "client-ls", "session-view", "session-inspect", "block-ls", "block-call"];

describe("isMutatingOp", () => {
  it("separates the ops that change server state from the read-only ones", () => {
    for (const op of MUTATING) expect(isMutatingOp(op), op).toBe(true);
    for (const op of READ_ONLY) expect(isMutatingOp(op), op).toBe(false);
  });
});

describe("classifyRexFailure", () => {
  it("ENOENT is missing-binary with outcome none for every op", () => {
    for (const op of [...MUTATING, ...READ_ONLY]) {
      const failure = classifyRexFailure(op, raw({ enoent: true }));
      expect(failure.kind, op).toBe("missing-binary");
      expect(failure.outcome, op).toBe("none");
      expect(failure.ok).toBe(false);
      expect(failure.op).toBe(op);
    }
  });

  it("a process timeout is timeout: unknown after a mutation, none after a read", () => {
    expect(classifyRexFailure("session-create", raw({ timedOut: true, signal: "SIGKILL" }))).toMatchObject({ kind: "timeout", outcome: "unknown" });
    expect(classifyRexFailure("ls", raw({ timedOut: true, signal: "SIGKILL" }))).toMatchObject({ kind: "timeout", outcome: "none" });
  });

  it("a signal without timeout is signal with the same outcome rule", () => {
    expect(classifyRexFailure("kill", raw({ signal: "SIGTERM" }))).toMatchObject({ kind: "signal", outcome: "unknown" });
    expect(classifyRexFailure("whoami", raw({ signal: "SIGTERM" }))).toMatchObject({ kind: "signal", outcome: "none" });
  });

  it("exit 4 is unreachable with outcome none even for a mutation", () => {
    const failure = classifyRexFailure("session-create", raw({ code: 4, stderr: "Error: dial unix /tmp/server.sock: connect: no such file or directory\n" }));
    expect(failure).toMatchObject({ kind: "unreachable", outcome: "none" });
    expect(failure.hint).toContain("Open the Rex app");
    expect(classifyRexFailure("ls", raw({ code: 4, stderr: "Error: server unreachable\n" }))).toMatchObject({ kind: "unreachable", outcome: "none" });
  });

  it("exit 2 is invalid with outcome none", () => {
    expect(classifyRexFailure("do-select", raw({ code: 2, stderr: "Error: unknown flag: --bogus\n\nUsage:\n  rex do\n" }))).toMatchObject({ kind: "invalid", outcome: "none" });
    expect(classifyRexFailure("whoami", raw({ code: 2, stderr: "Error: unknown flag: --bogus\n" }))).toMatchObject({ kind: "invalid", outcome: "none" });
  });

  it("exit 3 is not-found, or ambiguous when stderr says so; Rex changes nothing on 3", () => {
    expect(classifyRexFailure("focus", raw({ code: 3, stderr: 'Error: session target "session:abc" not found\n' }))).toMatchObject({ kind: "not-found", outcome: "none" });
    expect(classifyRexFailure("focus", raw({ code: 3, stderr: 'Error: target "ed" matches more than one block\n' }))).toMatchObject({ kind: "ambiguous", outcome: "none" });
    expect(classifyRexFailure("focus", raw({ code: 3, stderr: "Error: ambiguous target\n" }))).toMatchObject({ kind: "ambiguous", outcome: "none" });
    expect(classifyRexFailure("session-view", raw({ code: 3, stderr: 'Error: session target "session:abc" not found\n' }))).toMatchObject({ kind: "not-found", outcome: "none" });
    expect(classifyRexFailure("session-view", raw({ code: 3, stderr: "Error: ambiguous target\n" }))).toMatchObject({ kind: "ambiguous", outcome: "none" });
  });

  describe("exit 1", () => {
    it("with a JSON server error on stdout: rejected, rolled-back for session-create", () => {
      const failure = classifyRexFailure("session-create", raw({ code: 1, stdout: '{"error":{"code":"bad_request","message":"layout: split needs before and after"}}\n' }));
      expect(failure).toMatchObject({ kind: "rejected", outcome: "rolled-back" });
      expect(failure.reason).toBe("bad_request: layout: split needs before and after");
    });

    it("with a JSON server error on stderr: rejected, outcome none for other mutating ops and for reads", () => {
      const body = '{"error":{"code":"not_found","message":"no such session"}}';
      expect(classifyRexFailure("do-select", raw({ code: 1, stderr: body }))).toMatchObject({ kind: "rejected", outcome: "none" });
      expect(classifyRexFailure("session-view", raw({ code: 1, stderr: body }))).toMatchObject({ kind: "rejected", outcome: "none" });
    });

    it("with the CLI's Error: line quoting a server code: rejected", () => {
      const failure = classifyRexFailure("session-create", raw({ code: 1, stderr: "Error: session.create: conflict: too many sessions\n" }));
      expect(failure).toMatchObject({ kind: "rejected", outcome: "rolled-back" });
      expect(failure.reason).toBe("Error: session.create: conflict: too many sessions");
      expect(classifyRexFailure("kill", raw({ code: 1, stderr: "Error: session_not_found\n" }))).toMatchObject({ kind: "rejected", outcome: "none" });
    });

    it("a JSON body whose error.code is not a string is not a server error", () => {
      expect(classifyRexFailure("session-create", raw({ code: 1, stdout: '{"error":{"code":42}}' }))).toMatchObject({ kind: "failed", outcome: "unknown" });
      expect(classifyRexFailure("session-create", raw({ code: 1, stdout: '{"error":"boom"}' }))).toMatchObject({ kind: "failed", outcome: "unknown" });
      expect(classifyRexFailure("session-create", raw({ code: 1, stdout: "[1,2]" }))).toMatchObject({ kind: "failed", outcome: "unknown" });
    });

    it("with 'timed out' in stderr: timeout, unknown after a mutation", () => {
      const failure = classifyRexFailure("session-create", raw({ code: 1, stderr: "Error: request timed out after 10s: context deadline exceeded\n" }));
      expect(failure).toMatchObject({ kind: "timeout", outcome: "unknown" });
      expect(classifyRexFailure("ls", raw({ code: 1, stderr: "Error: wait timed out\n" }))).toMatchObject({ kind: "timeout", outcome: "none" });
    });

    it("with connect error text: unreachable, none", () => {
      expect(classifyRexFailure("session-create", raw({ code: 1, stderr: "Error: connect to unix:///x/server.sock: refused\n" }))).toMatchObject({ kind: "unreachable", outcome: "none" });
      expect(classifyRexFailure("ls", raw({ code: 1, stderr: "Error: server unreachable\n" }))).toMatchObject({ kind: "unreachable", outcome: "none" });
    });

    it("without any recognized shape: failed, unknown after a mutation and none after a read", () => {
      expect(classifyRexFailure("session-create", raw({ code: 1, stderr: "Error: something else\n" }))).toMatchObject({ kind: "failed", outcome: "unknown" });
      expect(classifyRexFailure("block-ls", raw({ code: 1, stderr: "Error: something else\n" }))).toMatchObject({ kind: "failed", outcome: "none" });
    });
  });

  it("any other exit code is unknown with the mutating outcome rule", () => {
    expect(classifyRexFailure("session-create", raw({ code: 130 }))).toMatchObject({ kind: "unknown", outcome: "unknown" });
    expect(classifyRexFailure("ls", raw({ code: 130 }))).toMatchObject({ kind: "unknown", outcome: "none" });
    expect(classifyRexFailure("ls", raw({}))).toMatchObject({ kind: "unknown", outcome: "none" });
  });

  it("a malformed response is malformed with the mutating outcome rule", () => {
    expect(classifyRexFailure("session-create", raw({ code: 0, stdout: "not json", malformed: true }))).toMatchObject({ kind: "malformed", outcome: "unknown" });
    expect(classifyRexFailure("session-view", raw({ code: 0, stdout: "not json", malformed: true }))).toMatchObject({ kind: "malformed", outcome: "none" });
  });

  it("keeps the first stderr line verbatim as the reason, with control characters escaped and the rest dropped", () => {
    const failure = classifyRexFailure("ls", raw({ code: 1, stderr: "Error: \x1b[31mred\x1b[0m\ttab\r\nUsage: rex ls\n" }));
    expect(failure.reason).toBe("Error: \\u001b[31mred\\u001b[0m\\u0009tab");
    expect(failure.reason).not.toContain("Usage");
  });

  it("falls back to a generic reason when stderr is empty", () => {
    expect(classifyRexFailure("ls", raw({ code: 1 })).reason).toBe("rex exited with status 1");
    expect(classifyRexFailure("ls", raw({ signal: "SIGTERM" })).reason).toBe("rex was killed by SIGTERM");
    expect(classifyRexFailure("ls", raw({ timedOut: true })).reason).toBe("rex did not answer in time");
    expect(classifyRexFailure("ls", raw({ enoent: true })).reason).toBe("rex binary not found");
  });

  it("caps an oversized first line", () => {
    const failure = classifyRexFailure("ls", raw({ code: 1, stderr: "E".repeat(2000) }));
    expect(failure.reason.length).toBeLessThanOrEqual(512);
    expect(failure.reason.endsWith("…")).toBe(true);
  });

  it("keeps the raw result for diagnostics", () => {
    const input = raw({ code: 1, stdout: "out", stderr: "err" });
    expect(classifyRexFailure("ls", input).raw).toEqual(input);
  });
});
