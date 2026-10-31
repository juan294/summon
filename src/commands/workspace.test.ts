import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const fixture = vi.hoisted(() => ({
  home: "",
  exec: vi.fn(),
  failStatusWrite: false,
}));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => fixture.home,
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (
      from: import("node:fs").PathLike,
      to: import("node:fs").PathLike,
    ) => {
      if (fixture.failStatusWrite && String(to).endsWith("/demo.json"))
        throw new Error("fixture rename denied");
      return actual.renameSync(from, to);
    },
    existsSync: (file: import("node:fs").PathLike) =>
      String(file) === "/Applications/Ghostty.app" ||
      String(file) === "/Applications/Ghostty.app/Contents/MacOS/ghostty" ||
      actual.existsSync(file),
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
      String(args[0]).endsWith("Ghostty.sdef")
        ? '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/><property name="name override" access="rw"/></class><class name="tab"><property name="name override" access="rw"/></class>'
        : actual.readFileSync(...args),
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: fixture.exec,
}));
// AR-M3: the real reader runs; the spy only records how each command reads.
const readStatusSpy = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../status.js", async (original) => {
  const actual = await original<typeof import("../status.js")>();
  return { ...actual, readStatus: (...args: Parameters<typeof actual.readStatus>) => { readStatusSpy.calls.push(args); return actual.readStatus(...args); } };
});
// The Rex binary is pinned; every rex call goes through fixture.exec like osascript does.
vi.mock("../backends/rex/cli.js", async (original) => ({
  ...(await original<typeof import("../backends/rex/cli.js")>()),
  discoverRex: () => ({ path: "/mock/rex", searched: ["PATH"] }),
}));
fixture.home = mkdtempSync(join(tmpdir(), "summon-workspace-test-"));
const { writeStatus } = await import("../status-record.js");
const { readStatus } = await import("../status.js");
const { focusWorkspace } = await import("../workspace-focus.js");
const { launch } = await import("../launcher.js");
const { handleFocusCommand, handleInspectCommand, handleTitleCommand } =
  await import("./workspace.js");
const { STATUS_DIR } = await import("../paths.js");
const id = "00000000-0000-4000-8000-000000000001";
const native = {
  rootTerminalId: id,
  panes: [{ name: "editor", terminalId: id }],
};
const base = {
  project: "demo",
  directory: "/tmp/demo",
  pid: process.pid,
  startedAt: new Date().toISOString(),
  layout: "minimal",
  panes: ["editor"],
  source: "summon" as const,
  version: 1 as const,
};
const context = (args: string[], values = {}) => ({
  parsed: { values, positionals: [], args },
  values,
  args,
  subcommand: "inspect",
  overrides: {},
});
function seed(withNative = true) {
  writeStatus({ ...base, ...(withNative ? { native } : {}) });
  mkdirSync(STATUS_DIR, { recursive: true });
  writeFileSync(join(STATUS_DIR, "demo.active"), "");
  writeFileSync(join(STATUS_DIR, "demo.pid"), String(process.pid));
}
beforeEach(() => {
  rmSync(STATUS_DIR, { recursive: true, force: true });
  fixture.exec.mockReset();
  fixture.failStatusWrite = false;
});
afterAll(() => rmSync(fixture.home, { recursive: true, force: true }));
describe("workspace commands with real status fixtures", () => {
  it("P2-missing-identity makes legacy focus unavailable without native calls", () => {
    seed(false);
    expect(focusWorkspace("demo")).toMatchObject({ kind: "unavailable" });
    expect(fixture.exec).not.toHaveBeenCalled();
  });
  it("P2-identical-cwd-title selects stored root UUID; unknown selector lists valid names", () => {
    seed();
    fixture.exec.mockReturnValue(
      JSON.stringify({ focused: true, terminalId: id }),
    );
    expect(focusWorkspace("demo")).toEqual({ kind: "focused", terminalId: id });
    expect(focusWorkspace("demo", "absent")).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining("editor"),
    });
    expect(fixture.exec).toHaveBeenCalledTimes(1);
  });
  it("P2-observation-failure/read-only inspection preserves shell liveness and files", async () => {
    seed();
    const before = readFileSync(join(STATUS_DIR, "demo.json"), "utf8");
    const files = readdirSync(STATUS_DIR);
    fixture.exec.mockReturnValue(
      JSON.stringify([
        {
          terminalId: id,
          pid: 0,
          tty: "",
          title: 'quotes"\n\t🦊',
          directory: "/tmp/demo",
          tabId: id,
          windowId: id,
          focused: false,
        },
      ]),
    );
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    readStatusSpy.calls.length = 0;
    await handleInspectCommand(context(["demo"], { json: true }));
    // AR-M3: inspect reads with reconciliation, as every status read did before the reader split.
    expect(readStatusSpy.calls).toEqual([["demo"]]);
    const result = JSON.parse(String(out.mock.calls[0]![0]));
    expect(result.state).toBe("active");
    expect(result.panes[0]).toMatchObject({
      pid: null,
      tty: null,
      title: 'quotes"\n\t🦊',
      availability: "available",
    });
    expect(readStatus("demo")?.state).toBe("active");
    expect(readFileSync(join(STATUS_DIR, "demo.json"), "utf8")).toBe(before);
    expect(readdirSync(STATUS_DIR)).toEqual(files);
    out.mockRestore();
  });
  it("P2-missing-identity emits structured unavailable JSON and exit2", async () => {
    seed(false);
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const fail = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit2");
    });
    await expect(
      handleInspectCommand(context(["demo"], { json: true })),
    ).rejects.toThrow("exit2");
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({
      availability: "unavailable",
      reason: expect.stringContaining("relaunch"),
    });
    expect(exit).toHaveBeenCalledWith(2);
    expect(fixture.exec).not.toHaveBeenCalled();
    exit.mockRestore();
    out.mockRestore();
    fail.mockRestore();
  });
  // UX-M3: a name with no record that is not registered gets the closest registered names; the exit code stays 2.
  it("focus, inspect and title on an unknown name suggest registered projects on stderr and still exit 2", async () => {
    const configDir = join(fixture.home, ".config", "summon");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "projects"), "chapa=/tmp/chapa\n");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    try {
      for (const run of [
        () => handleFocusCommand(context(["chpaa"])),
        () => handleInspectCommand(context(["chpaa"], { json: true })),
        () => handleTitleCommand(context(["chpaa"])),
      ]) {
        stderr.mockClear();
        await expect(run()).rejects.toThrow("exit:2");
        const lines = stderr.mock.calls.map((c) => String(c[0]));
        expect(lines.at(-1)).toBe("Did you mean: chapa?\n");
      }
      // A name with a record is never second-guessed.
      seed(false);
      stderr.mockClear();
      await expect(handleFocusCommand(context(["demo"]))).rejects.toThrow("exit:2");
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).not.toContain("Did you mean");
      expect(fixture.exec).not.toHaveBeenCalled();
    } finally {
      rmSync(join(configDir, "projects"), { force: true });
      stderr.mockRestore();
      out.mockRestore();
      exit.mockRestore();
    }
  });
  it("focus handler reports confirmed success only", async () => {
    seed();
    fixture.exec.mockReturnValue(
      JSON.stringify({ focused: true, terminalId: id }),
    );
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleFocusCommand(context(["demo"]));
    expect(out).toHaveBeenCalledWith(expect.stringContaining("Focused"));
    out.mockRestore();
  });
  it("P2-R2 failed status replacement invalidates prior native targeting but preserves shell sidecars", async () => {
    seed();
    const projectDir = join(fixture.home, "demo");
    mkdirSync(projectDir, { recursive: true });
    fixture.failStatusWrite = true;
    fixture.exec.mockImplementation(
      (bin: string, args: string[], options?: { input?: string }) =>
        bin === "/usr/bin/which"
          ? "/usr/bin/true\n"
          : options?.input
            ? `SUMMON_NATIVE_V1\n${id}\n00000000-0000-4000-8000-000000000002\n`
            : "",
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await expect(
      launch(projectDir, {
        editor: "true",
        sidebar: "",
        panes: "1",
        shell: "false",
        "auto-resize": "false",
        clean: "false",
        "no-project-config": "true",
      }),
    ).resolves.toBe("launched");
    expect(readStatus("demo")).toBeNull();
    expect(readFileSync(join(STATUS_DIR, "demo.pid"), "utf8")).toBe(
      String(process.pid),
    );
    expect(readFileSync(join(STATUS_DIR, "demo.active"), "utf8")).toBe("");
    expect(focusWorkspace("demo").kind).toBe("unavailable");
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("status could not be saved"),
    );
    stderr.mockRestore();
    stdout.mockRestore();
  });
  it("validates usage/project before native calls", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("usage");
    });
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    for (const args of [[], ["../x"], ["demo", "pane", "extra"]])
      await expect(handleFocusCommand(context(args))).rejects.toThrow("usage");
    expect(fixture.exec).not.toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });
});


describe("P4 title handler real status fixtures", () => {
  it("reads default tab and targets explicit pane without changing status keys", async () => {
    seed();
    const before = readFileSync(join(STATUS_DIR, "demo.json"), "utf8");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    fixture.exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "tab",
        override: "existing\n\u202e🦊",
      }),
    );
    readStatusSpy.calls.length = 0;
    await handleTitleCommand(context(["demo"]));
    // AR-M3: title reads with reconciliation, as every status read did before the reader split.
    expect(readStatusSpy.calls).toEqual([["demo"]]);
    expect(fixture.exec.mock.calls[0]![2].input).not.toMatch(
      /\bactivate\b|set name override/,
    );
    expect(out.mock.calls.flat().join("")).toContain("\\u000a");
    expect(out.mock.calls.flat().join("")).toContain("\\u202e");
    fixture.exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "pane",
        override: "new 🦊",
      }),
    );
    await handleTitleCommand(context(["demo", "editor"], { set: "new 🦊" }));
    expect(fixture.exec.mock.calls[1]![2].input).toContain(
      "set titleTarget to p",
    );
    fixture.exec.mockReturnValue(
      JSON.stringify({
        found: true,
        terminalId: id,
        scope: "tab",
        override: "",
      }),
    );
    await handleTitleCommand(context(["demo"], { reset: true }));
    expect(out).toHaveBeenCalledWith(
      expect.stringContaining("no title override"),
    );
    expect(readFileSync(join(STATUS_DIR, "demo.json"), "utf8")).toBe(before);
    out.mockRestore();
  });
  it("invalid/conflicting title options fail before native IO", async () => {
    seed();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("usage");
    });
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    for (const values of [
      { set: "", reset: true },
      { set: "" },
      { set: "bad\n" },
      { set: "🦊".repeat(257) },
    ])
      await expect(
        handleTitleCommand(context(["demo"], values)),
      ).rejects.toThrow("usage");
    expect(fixture.exec).not.toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });
  it("unknown mutation output exits2 with readback guidance and no retry", async () => {
    seed();
    fixture.exec.mockImplementation(() => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit2");
    });
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await expect(
      handleTitleCommand(context(["demo"], { set: "new" })),
    ).rejects.toThrow("exit2");
    expect(exit).toHaveBeenCalledWith(2);
    expect(fixture.exec).toHaveBeenCalledTimes(1);
    expect(err.mock.calls.flat().join("")).toContain("unknown");
    exit.mockRestore();
    err.mockRestore();
  });
});

describe("P4 detach command real generator", () => {
  it("prints an opt-in snippet only after supported action evidence", async () => {
    const { handleKeybindingsCommand } = await import("./setup.js");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    fixture.exec.mockReturnValue("move_tab_to_new_window\n");
    await handleKeybindingsCommand({ ...context([], { "detach-tab": true }), overrides: { "no-project-config": "true" } });
    expect(out.mock.calls.flat().join("")).toContain(
      "summon-nav:n = move_tab_to_new_window",
    );
    expect(fixture.exec).toHaveBeenCalledTimes(1);
    out.mockRestore();
  });
  it("unsupported action prints no partial stdout and exits2", async () => {
    const { handleKeybindingsCommand } = await import("./setup.js");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit2");
    });
    fixture.exec.mockReturnValue("set_tab_title\n");
    await expect(
      handleKeybindingsCommand({ ...context([], { "detach-tab": true }), overrides: { "no-project-config": "true" } }),
    ).rejects.toThrow("exit2");
    expect(out).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(2);
    out.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  });
});

describe("workspace commands under Rex (plan P10, Phase 4)", () => {
  const SESSION = "session:0000aaaa-0000-0000-0000-000000000001";
  const WINDOW = "window:0000aaaa-0000-0000-0000-000000000002";
  const block = (n: number) => `block:0000aaaa-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
  // Full preset: display order differs from the block order the server assigned (paneOrder).
  const PANES = ["editor", "sidebar", "editor-2", "right-1", "shell"];
  const BLOCKS = [
    { name: "editor", blockId: block(1), label: "editor · vim" },
    { name: "editor-2", blockId: block(2), label: "editor · vim" },
    { name: "right-1", blockId: block(3), label: "editor · vim" },
    { name: "shell", blockId: block(4), label: "shell" },
    { name: "sidebar", blockId: block(5), label: "sidebar · lazygit" },
  ];
  const rex = { server: "unix:///tmp/rex.sock", hostId: "host-1", sessionId: SESSION, windowId: WINDOW, rootBlockId: block(1), blocks: BLOCKS };
  function seedRex(blocks = BLOCKS) {
    writeStatus({ ...base, panes: PANES, launchId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", backend: "rex", rex: { ...rex, blocks } });
  }
  type RexAnswers = { present?: boolean; live?: string[]; unreachable?: boolean; windowLabel?: string; program?: Array<Record<string, unknown>> };
  function rexExec(answers: RexAnswers = {}) {
    const live = (answers.live ?? BLOCKS.map((b) => b.name)).map((name) => BLOCKS.find((b) => b.name === name)!.blockId);
    const calls: string[][] = [];
    fixture.exec.mockImplementation((bin: string, args: string[]) => {
      if (bin !== "/mock/rex") return "";
      calls.push(args);
      const sub = args.slice(args.indexOf("-S") + 2);
      if (answers.unreachable) throw Object.assign(new Error("exit 4"), { status: 4, stderr: "Error: dial unix: connect: no such file\n" });
      if (sub[0] === "ls") return JSON.stringify({ sessions: answers.present === false ? [] : [{ session_id: SESSION, label: "demo" }] });
      if (sub.includes("session.view")) return JSON.stringify({ session_id: SESSION, label: "demo", revision: 3, windows: [{ window_id: WINDOW, label: answers.windowLabel ?? "[demo]", layers: [{ layer_id: "l", kind: "tiled", bounds: [0, 0, 1, 1], layout: null, blocks: live.map((id) => ({ block_id: id, host_id: "host-1" })) }] }] });
      if (sub[0] === "focus") return "";
      if (sub.includes("client.list")) return JSON.stringify({ clients: [{ client_id: "client:app", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app" } }] });
      if (sub.includes("session.select")) return "{}";
      if (sub[0] === "block" && sub[1] === "ls") return JSON.stringify({ blocks: live.map((id) => ({ block_id: id, label: BLOCKS.find((b) => b.blockId === id)!.label, window_id: WINDOW })) });
      if (sub[0] === "block" && sub[1] === "call" && sub.at(-1) === "program_status") return JSON.stringify({ records: answers.program ?? [] });
      if (sub[0] === "block" && sub[1] === "call") return sub.at(-1) === "title" ? JSON.stringify({ title: "vim ~/x" }) : JSON.stringify({ foreground: { pid: 4242, cwd: "/tmp/demo" }, child: { pid: 4000 } });
      if (sub.includes("session.set_block_label") || sub.includes("session.set_window_label")) return JSON.stringify({ revision: 4 });
      throw new Error(`unexpected rex call ${args.join(" ")}`);
    });
    return calls;
  }
  let exitSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit:${code}`); }) as never);
  });
  afterEach(() => { exitSpy.mockRestore(); });

  it("focus targets the root block of an active session, then selects it in the app", async () => {
    seedRex();
    const calls = rexExec();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleFocusCommand(context(["demo"]));
    expect(logSpy).toHaveBeenCalledWith("Focused [demo]");
    logSpy.mockRestore();
    expect(calls.map((c) => c.slice(c.indexOf("-S") + 2))).toContainEqual(["focus", "-s", SESSION, block(1)]);
    expect(calls.some((c) => c.includes("session.select") && c.includes(`window_id=${WINDOW}`))).toBe(true);
  });

  it("focus by pane name maps through the record, never through display position", async () => {
    seedRex();
    const calls = rexExec();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleFocusCommand(context(["demo", "editor-2"]));
    logSpy.mockRestore();
    const focus = calls.map((c) => c.slice(c.indexOf("-S") + 2)).find((c) => c[0] === "focus")!;
    expect(focus).toEqual(["focus", "-s", SESSION, block(2)]);
    expect(PANES.indexOf("editor-2")).not.toBe(1);
  });

  it("focus on a partial session goes to the first live pane; stopped and unknown refuse with exit 2", async () => {
    seedRex();
    const calls = rexExec({ live: ["shell", "sidebar"] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleFocusCommand(context(["demo"]));
    logSpy.mockRestore();
    expect(calls.map((c) => c.slice(c.indexOf("-S") + 2)).find((c) => c[0] === "focus")).toEqual(["focus", "-s", SESSION, block(4)]);

    rexExec({ present: false });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(handleFocusCommand(context(["demo"]))).rejects.toThrow("exit:2");
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("no longer exists in Rex");
    errSpy.mockClear();
    rexExec({ unreachable: true });
    await expect(handleFocusCommand(context(["demo"]))).rejects.toThrow("exit:2");
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("could not be verified");
    errSpy.mockRestore();
  });

  it("inspect prints block ids, pids and titles with the tty UNAVAILABLE and exit 0 when every recorded block is present", async () => {
    seedRex();
    rexExec();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleInspectCommand(context(["demo"], { json: true }));
    const result = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(result).toMatchObject({ project: "demo", state: "active", backend: "rex", availability: "available" });
    expect(result.panes.map((p: Record<string, unknown>) => [p.name, p.blockId, p.pid, p.tty, p.title, p.availability])).toEqual([
      ["editor", block(1), 4242, null, "vim ~/x", "available"],
      ["sidebar", block(5), 4242, null, "vim ~/x", "available"],
      ["editor-2", block(2), 4242, null, "vim ~/x", "available"],
      ["right-1", block(3), 4242, null, "vim ~/x", "available"],
      ["shell", block(4), 4242, null, "vim ~/x", "available"],
    ]);
    logSpy.mockClear();
    await handleInspectCommand(context(["demo"]));
    const text = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("demo: active (available, Rex)");
    expect(text).toContain(`  shell  ${block(4)}  PID 4242  UNAVAILABLE  vim ~/x`);
    logSpy.mockRestore();
  });

  it("inspect on a partial or unknown session is unavailable with the reason and exit 2", async () => {
    seedRex();
    rexExec({ live: ["editor", "shell"] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleInspectCommand(context(["demo"], { json: true }))).rejects.toThrow("exit:2");
    const partial = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(partial).toMatchObject({ state: "active", availability: "unavailable", reason: expect.stringContaining("closed in Rex (sidebar, editor-2, right-1)") });
    logSpy.mockClear();
    rexExec({ unreachable: true });
    await expect(handleInspectCommand(context(["demo"], { json: true }))).rejects.toThrow("exit:2");
    expect(JSON.parse(String(logSpy.mock.calls[0]![0]))).toMatchObject({ state: "unknown", availability: "unavailable", reason: expect.stringContaining("could not be verified") });
    logSpy.mockRestore();
  });

  it("title reads, sets and resets pane labels and the tab (window) label through the server", async () => {
    seedRex();
    const calls = rexExec({ windowLabel: "[demo]" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleTitleCommand(context(["demo", "shell"]));
    expect(logSpy).toHaveBeenLastCalledWith("shell");
    await handleTitleCommand(context(["demo", "shell"], { set: "logs" }));
    expect(logSpy).toHaveBeenLastCalledWith("logs");
    await handleTitleCommand(context(["demo", "shell"], { reset: true }));
    expect(logSpy).toHaveBeenLastCalledWith("shell");
    await handleTitleCommand(context(["demo"]));
    expect(logSpy).toHaveBeenLastCalledWith("[demo]");
    await handleTitleCommand(context(["demo"], { set: "work" }));
    expect(logSpy).toHaveBeenLastCalledWith("work");
    logSpy.mockRestore();
    const labels = calls.filter((c) => c.includes("session.set_block_label") || c.includes("session.set_window_label"));
    expect(labels).toHaveLength(3);
  });

  it("title on a stopped or unknown session exits 2 before any label call; inspect on a stopped session lists nothing", async () => {
    seedRex();
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const answers of [{ present: false }, { unreachable: true }]) {
      const calls = rexExec(answers);
      await expect(handleTitleCommand(context(["demo", "shell"], { set: "x" }))).rejects.toThrow("exit:2");
      expect(calls.some((c) => c.includes("session.set_block_label"))).toBe(false);
    }
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("no longer exists in Rex");
    const calls = rexExec({ present: false });
    await expect(handleInspectCommand(context(["demo"], { json: true }))).rejects.toThrow("exit:2");
    expect(JSON.parse(String(logSpy.mock.calls.at(-1)![0]))).toMatchObject({ state: "stopped", availability: "unavailable", reason: expect.stringContaining("no longer exists in Rex"), panes: [] });
    expect(calls.some((c) => c.includes("block"))).toBe(false);
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("inspect prints the root pane's program status when its programs report one", async () => {
    seedRex();
    rexExec({ program: [{ state: "blocked", kind: "question", app: "claude", title: "Review", msg: "Continue?" }] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleInspectCommand(context(["demo"]));
    const text = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("  program: blocked (question) claude Review Continue?");
    logSpy.mockClear();
    await handleInspectCommand(context(["demo"], { json: true }));
    expect(JSON.parse(String(logSpy.mock.calls[0]![0])).programStatus).toEqual({ state: "blocked", kind: "question", app: "claude", title: "Review", msg: "Continue?" });
    logSpy.mockRestore();
  });

  it("inspect prints a program status without optional fields as its state and app only", async () => {
    seedRex();
    rexExec({ program: [{ state: "working", app: "pnpm" }] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleInspectCommand(context(["demo"]));
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toContain("  program: working pnpm");
    logSpy.mockRestore();
  });

  it("inspect escapes control characters in every program status field, kind and app included", async () => {
    seedRex();
    rexExec({ program: [{ state: "blocked", kind: "question\u001b[31m", app: "claude\u0007", title: "T\u001b]0;x\u0007", msg: "m\n" }] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleInspectCommand(context(["demo"]));
    const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("  program:"))!;
    expect(line).toBe("  program: blocked (question\\u001b[31m) claude\\u0007 T\\u001b]0;x\\u0007 m\\u000a");
    logSpy.mockRestore();
  });

  it("inspect on a partial session (root closed) reports state partial with the closed panes named", async () => {
    seedRex();
    rexExec({ live: ["shell"] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handleInspectCommand(context(["demo"], { json: true }))).rejects.toThrow("exit:2");
    const result = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(result).toMatchObject({ state: "partial", availability: "unavailable", reason: expect.stringContaining("closed in Rex (editor, sidebar, editor-2, right-1)") });
    expect(result.panes.find((p: Record<string, unknown>) => p.name === "shell")).toMatchObject({ availability: "available", pid: 4242 });
    logSpy.mockRestore();
  });
});

