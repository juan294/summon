import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLaunch = vi.fn();
const mockListProjects = vi.fn();
const mockGetProject = vi.fn();
const mockListSessions = vi.fn();
const mockReadSession = vi.fn();
const mockWriteSession = vi.fn();
const mockDeleteSession = vi.fn();
const mockSessionExists = vi.fn();
const mockIsValidSessionName = vi.fn();

vi.mock("../launcher.js", () => ({
  launch: (...args: unknown[]) => mockLaunch(...args),
}));

vi.mock("../config.js", () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

vi.mock("../sessions.js", () => ({
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  readSession: (...args: unknown[]) => mockReadSession(...args),
  writeSession: (...args: unknown[]) => mockWriteSession(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
  isValidSessionName: (...args: unknown[]) => mockIsValidSessionName(...args),
}));

const { handleSessionCommand } = await import("./session.js");

function makeContext(overrides: {
  args?: string[];
  values?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
} = {}) {
  return {
    parsed: { values: {}, positionals: [], args: [] },
    values: overrides.values ?? {},
    subcommand: "session",
    args: overrides.args ?? [],
    overrides: overrides.overrides ?? {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListSessions.mockReturnValue([]);
  mockListProjects.mockReturnValue(new Map<string, string>());
  mockGetProject.mockReturnValue(undefined);
  mockIsValidSessionName.mockReturnValue(true);
});

describe("session add", () => {
  it("calls writeSession when all projects exist in registry", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { a: "/tmp/a", b: "/tmp/b", c: "/tmp/c" };
      return map[name];
    });

    await handleSessionCommand(makeContext({ args: ["add", "foo", "a", "b", "c"] }));

    expect(mockWriteSession).toHaveBeenCalledWith("foo", ["a", "b", "c"]);
    logSpy.mockRestore();
  });

  it("errors when a project is not in registry (calls process.exit(1))", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockGetProject.mockReturnValue(undefined);

    await expect(
      handleSessionCommand(makeContext({ args: ["add", "foo", "bogus"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockWriteSession).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("bogus"));
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("errors because 'all' is a reserved name", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockGetProject.mockReturnValue("/tmp/proj");

    await expect(
      handleSessionCommand(makeContext({ args: ["add", "all", "proj"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockWriteSession).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("reserved"));
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("session list", () => {
  it("lists saved sessions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListSessions.mockReturnValue(["alpha", "beta"]);

    await handleSessionCommand(makeContext({ args: ["list"] }));

    expect(mockListSessions).toHaveBeenCalled();
    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allLogs).toContain("alpha");
    expect(allLogs).toContain("beta");
    logSpy.mockRestore();
  });

  it("prints 'No saved sessions.' when empty", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListSessions.mockReturnValue([]);

    await handleSessionCommand(makeContext({ args: ["list"] }));

    expect(logSpy).toHaveBeenCalledWith("No saved sessions.");
    logSpy.mockRestore();
  });
});

describe("session show", () => {
  it("prints projects from readSession in order", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadSession.mockReturnValue(["api", "web", "worker"]);

    await handleSessionCommand(makeContext({ args: ["show", "myteam"] }));

    expect(logSpy).toHaveBeenNthCalledWith(1, "api");
    expect(logSpy).toHaveBeenNthCalledWith(2, "web");
    expect(logSpy).toHaveBeenNthCalledWith(3, "worker");
    logSpy.mockRestore();
  });
});

describe("session launch <name>", () => {
  it("calls launch 3 times in order; first has no new-tab, second+third have new-tab: 'true'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadSession.mockReturnValue(["api", "web", "worker"]);
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web", worker: "/tmp/worker" };
      return map[name];
    });
    mockLaunch.mockResolvedValue(undefined);

    await handleSessionCommand(makeContext({ args: ["myteam"] }));

    expect(mockLaunch).toHaveBeenCalledTimes(3);
    const calls = mockLaunch.mock.calls;
    expect(calls[0]).toEqual(["/tmp/api", expect.objectContaining({ "new-tab": undefined })]);
    expect(calls[1]).toEqual(["/tmp/web", expect.objectContaining({ "new-tab": "true" })]);
    expect(calls[2]).toEqual(["/tmp/worker", expect.objectContaining({ "new-tab": "true" })]);
    logSpy.mockRestore();
  });

  it("errors when session is empty (readSession returns [])", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockReadSession.mockReturnValue([]);

    await expect(
      handleSessionCommand(makeContext({ args: ["empty-session"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("empty"));
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });

  it("aborts if second project launch rejects — third project never called — exits 1", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);

    mockReadSession.mockReturnValue(["api", "web", "worker"]);
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web", worker: "/tmp/worker" };
      return map[name];
    });
    mockLaunch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("osascript failed"))
      .mockResolvedValueOnce(undefined);

    await expect(
      handleSessionCommand(makeContext({ args: ["myteam"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("osascript failed"));
    mockExit.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("session launch --all", () => {
  it("uses listProjects() keys", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListProjects.mockReturnValue(new Map([["api", "/tmp/api"], ["web", "/tmp/web"]]));
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web" };
      return map[name];
    });
    mockLaunch.mockResolvedValue(undefined);

    await handleSessionCommand(makeContext({ values: { all: true }, args: [] }));

    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/api", expect.anything());
    expect(mockLaunch).toHaveBeenCalledWith("/tmp/web", expect.anything());
    logSpy.mockRestore();
  });

  it("exits with error when registry is empty", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockListProjects.mockReturnValue(new Map());

    await expect(
      handleSessionCommand(makeContext({ values: { all: true }, args: [] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).not.toHaveBeenCalled();
    mockExit.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("session launch --new-window <name>", () => {
  it("first call has new-window: 'true' and no new-tab; second call has new-tab: 'true' and no new-window key", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReadSession.mockReturnValue(["api", "web"]);
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web" };
      return map[name];
    });
    mockLaunch.mockResolvedValue(undefined);

    await handleSessionCommand(
      makeContext({ args: ["myteam"], overrides: { "new-window": "true" } }),
    );

    expect(mockLaunch).toHaveBeenCalledTimes(2);
    const calls = mockLaunch.mock.calls;

    // First call: new-window present, new-tab absent/undefined
    expect(calls[0]![1]).toMatchObject({ "new-window": "true" });
    expect(calls[0]![1]["new-tab"]).toBeUndefined();

    // Second call: new-tab present, new-window absent (key deleted)
    expect(calls[1]![1]).toMatchObject({ "new-tab": "true" });
    expect(Object.prototype.hasOwnProperty.call(calls[1]![1], "new-window")).toBe(false);

    logSpy.mockRestore();
  });
});
