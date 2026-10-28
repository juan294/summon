import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
      String(file) === "/Applications/Ghostty.app/Contents/MacOS/ghostty" ||
      actual.existsSync(file),
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
      String(args[0]).endsWith("Ghostty.sdef")
        ? '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/></class>'
        : actual.readFileSync(...args),
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: fixture.exec,
}));
fixture.home = mkdtempSync(join(tmpdir(), "summon-workspace-test-"));
const { writeStatus, readStatus } = await import("../status.js");
const { focusWorkspace, launch } = await import("../launcher.js");
const { handleFocusCommand, handleInspectCommand } =
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
    await handleInspectCommand(context(["demo"], { json: true }));
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
    ).resolves.toBeUndefined();
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
