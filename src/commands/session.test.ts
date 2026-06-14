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
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockGetProject.mockReturnValue(undefined);

    await expect(
      handleSessionCommand(makeContext({ args: ["add", "foo", "bogus"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockWriteSession).not.toHaveBeenCalled();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("bogus");
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });

  it("errors because 'all' is a reserved name", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockGetProject.mockReturnValue("/tmp/proj");

    await expect(
      handleSessionCommand(makeContext({ args: ["add", "all", "proj"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockWriteSession).not.toHaveBeenCalled();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("reserved");
    mockExit.mockRestore();
    writeSpy.mockRestore();
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

    expect(logSpy).toHaveBeenCalledWith("No sessions found.");
    expect(logSpy).toHaveBeenCalledWith("Run `summon session add <name> <project> [...]` to create one.");
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
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockReadSession.mockReturnValue([]);

    await expect(
      handleSessionCommand(makeContext({ args: ["empty-session"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).not.toHaveBeenCalled();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("empty");
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });

  it("aborts if second project launch rejects — third project never called — exits 1", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
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
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allWrites).toContain("osascript failed");
    mockExit.mockRestore();
    writeSpy.mockRestore();
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
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockListProjects.mockReturnValue(new Map());

    await expect(
      handleSessionCommand(makeContext({ values: { all: true }, args: [] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).not.toHaveBeenCalled();
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("session launch — skip untrusted projects and continue", () => {
  it("skips a project that fails the trust gate and continues with the rest", async () => {
    const { SummonError } = await import("../trust.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    mockListProjects.mockReturnValue(
      new Map([
        ["api", "/tmp/api"],
        ["web", "/tmp/web"],
        ["worker", "/tmp/worker"],
      ]),
    );
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web", worker: "/tmp/worker" };
      return map[name];
    });
    // Second project is untrusted; first and third succeed.
    mockLaunch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new SummonError("This project has a .summon file. Run 'summon trust .' to allow it."))
      .mockResolvedValueOnce(undefined);

    await handleSessionCommand(makeContext({ values: { all: true }, args: [] }));

    // All three were attempted; the untrusted one was skipped, not fatal.
    expect(mockLaunch).toHaveBeenCalledTimes(3);
    const allWarns = warnSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allWarns).toContain("web");
    expect(allWarns.toLowerCase()).toContain("untrusted");
    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allLogs).toContain("Session complete");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    writeSpy.mockRestore();
  });

});

describe("session launch — skip tab-open failures and continue", () => {
  it("skips a project whose tab failed to open and continues with the rest", async () => {
    const { TabOpenError } = await import("../errors.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    mockListProjects.mockReturnValue(
      new Map([
        ["api", "/tmp/api"],
        ["web", "/tmp/web"],
        ["worker", "/tmp/worker"],
      ]),
    );
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web", worker: "/tmp/worker" };
      return map[name];
    });
    // Second project fails with TabOpenError; first and third succeed.
    mockLaunch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TabOpenError("Ghostty did not open a new tab."))
      .mockResolvedValueOnce(undefined);

    await handleSessionCommand(makeContext({ values: { all: true }, args: [] }));

    // All three were attempted; the failed one was skipped, not fatal.
    expect(mockLaunch).toHaveBeenCalledTimes(3);
    const allWarns = warnSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allWarns).toContain("web");
    expect(allWarns.toLowerCase()).toContain("tab failed");
    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(allLogs).toContain("Session complete");
    expect(allLogs).toContain("failed (tab did not open)");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("non-TabOpenError rejections still abort with process.exit(1)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);

    mockListProjects.mockReturnValue(new Map([["api", "/tmp/api"], ["web", "/tmp/web"]]));
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web" };
      return map[name];
    });
    mockLaunch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("osascript failed"));

    await expect(
      handleSessionCommand(makeContext({ values: { all: true }, args: [] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).toHaveBeenCalledTimes(2);
    mockExit.mockRestore();
    writeSpy.mockRestore();
    logSpy.mockRestore();
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

describe("session launch with no name and no --all", () => {
  it("prints usage and lists saved sessions then exits 1", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockListSessions.mockReturnValue(["alpha", "beta"]);

    await expect(
      handleSessionCommand(makeContext({ args: [] })),
    ).rejects.toThrow("process.exit:1");

    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toContain("Usage:");
    expect(allErrors).toContain("alpha");
    expect(allErrors).toContain("beta");
    expect(mockLaunch).not.toHaveBeenCalled();
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });

  it("prints usage and 'no saved sessions' message when list is empty then exits 1", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockListSessions.mockReturnValue([]);

    await expect(
      handleSessionCommand(makeContext({ args: [] })),
    ).rejects.toThrow("process.exit:1");

    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toContain("Usage:");
    expect(allErrors).toContain("No sessions found");
    expect(mockLaunch).not.toHaveBeenCalled();
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("session launch <name> — session not found", () => {
  it("errors when readSession returns null", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockReadSession.mockReturnValue(null);

    await expect(
      handleSessionCommand(makeContext({ args: ["nonexistent"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).not.toHaveBeenCalled();
    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toContain("nonexistent");
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("session launch — unknown projects in session", () => {
  it("errors when a project in the session is not registered", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockReadSession.mockReturnValue(["api", "unknown-proj"]);
    mockGetProject.mockImplementation((name: string) => {
      return name === "api" ? "/tmp/api" : undefined;
    });

    await expect(
      handleSessionCommand(makeContext({ args: ["myteam"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockLaunch).not.toHaveBeenCalled();
    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toContain("unknown-proj");
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("session remove", () => {
  it("calls deleteSession and confirms removal", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockDeleteSession.mockReturnValue(true);

    await handleSessionCommand(makeContext({ args: ["remove", "myteam"] }));

    expect(mockDeleteSession).toHaveBeenCalledWith("myteam");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("myteam"));
    logSpy.mockRestore();
  });

  it("errors when session does not exist", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockDeleteSession.mockReturnValue(false);

    await expect(
      handleSessionCommand(makeContext({ args: ["remove", "ghost"] })),
    ).rejects.toThrow("process.exit:1");

    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toContain("ghost");
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });

  it("errors when no name is provided", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      handleSessionCommand(makeContext({ args: ["remove"] })),
    ).rejects.toThrow("process.exit");

    mockExit.mockRestore();
  });

  it("rejects invalid session name in remove without calling deleteSession (#532 BE-M2)", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockIsValidSessionName.mockReturnValue(false);

    await expect(
      handleSessionCommand(makeContext({ args: ["remove", "../../evil"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockDeleteSession).not.toHaveBeenCalled();
    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toMatch(/invalid|not found/i);
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("session show — not found", () => {
  it("errors when session does not exist", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockReadSession.mockReturnValue(null);

    await expect(
      handleSessionCommand(makeContext({ args: ["show", "ghost"] })),
    ).rejects.toThrow("process.exit:1");

    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toContain("ghost");
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });

  it("errors when no name is provided to show", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      handleSessionCommand(makeContext({ args: ["show"] })),
    ).rejects.toThrow("process.exit");

    mockExit.mockRestore();
  });

  it("rejects invalid session name in show without calling readSession (#532 BE-M2)", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    mockIsValidSessionName.mockReturnValue(false);

    await expect(
      handleSessionCommand(makeContext({ args: ["show", "../../evil"] })),
    ).rejects.toThrow("process.exit:1");

    expect(mockReadSession).not.toHaveBeenCalled();
    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allErrors).toMatch(/invalid|not found/i);
    mockExit.mockRestore();
    writeSpy.mockRestore();
  });
});

describe("session add — no args", () => {
  it("errors when no name is provided", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      handleSessionCommand(makeContext({ args: ["add"] })),
    ).rejects.toThrow("process.exit");

    expect(mockWriteSession).not.toHaveBeenCalled();
    mockExit.mockRestore();
  });

  it("errors when name is given but no projects", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      handleSessionCommand(makeContext({ args: ["add", "myteam"] })),
    ).rejects.toThrow("process.exit");

    expect(mockWriteSession).not.toHaveBeenCalled();
    mockExit.mockRestore();
  });
});

describe("session launch — partial failure shows already-launched list", () => {
  it("reports already-launched projects when first succeeds and second fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error("process.exit:" + code);
    }) as never);

    mockReadSession.mockReturnValue(["api", "web"]);
    mockGetProject.mockImplementation((name: string) => {
      const map: Record<string, string> = { api: "/tmp/api", web: "/tmp/web" };
      return map[name];
    });
    mockLaunch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("osascript timeout"));

    await expect(
      handleSessionCommand(makeContext({ args: ["myteam"] })),
    ).rejects.toThrow("process.exit:1");

    const allErrors = writeSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Should mention the already-launched project
    expect(allErrors).toContain("api");
    mockExit.mockRestore();
    writeSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("session launch — spinner", () => {
  it("non-TTY static mode: prints label once, no animation interval (#615)", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    mockReadSession.mockReturnValue(["api"]);
    mockGetProject.mockReturnValue("/tmp/api");
    mockLaunch.mockResolvedValue(undefined);

    await handleSessionCommand(makeContext({ args: ["mysession"] }));

    // No animation interval should have been started
    expect(setIntervalSpy).not.toHaveBeenCalled();
    // Label is printed once as a plain line
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain("Summoning api");

    writeSpy.mockRestore();
    logSpy.mockRestore();
    setIntervalSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
  });

  it("static mode: NO_COLOR set — prints label once, no setInterval animation (#615)", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    // Simulate a TTY so the isTTY guard doesn't short-circuit
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const origNoColor = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";

    mockReadSession.mockReturnValue(["api"]);
    mockGetProject.mockReturnValue("/tmp/api");
    mockLaunch.mockResolvedValue(undefined);

    await handleSessionCommand(makeContext({ args: ["mysession"] }));

    // No animation interval should have been started
    expect(setIntervalSpy).not.toHaveBeenCalled();
    // The label should have been printed to stderr or stdout exactly once (static line)
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain("Summoning api");

    writeSpy.mockRestore();
    logSpy.mockRestore();
    setIntervalSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
    if (origNoColor === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = origNoColor;
    }
  });

  it("static mode: SUMMON_NO_SPINNER set — prints label once, no setInterval animation (#615)", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const origNoSpinner = process.env["SUMMON_NO_SPINNER"];
    process.env["SUMMON_NO_SPINNER"] = "1";

    mockReadSession.mockReturnValue(["api"]);
    mockGetProject.mockReturnValue("/tmp/api");
    mockLaunch.mockResolvedValue(undefined);

    await handleSessionCommand(makeContext({ args: ["mysession"] }));

    expect(setIntervalSpy).not.toHaveBeenCalled();
    const allWrites = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWrites).toContain("Summoning api");

    writeSpy.mockRestore();
    logSpy.mockRestore();
    setIntervalSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
    if (origNoSpinner === undefined) {
      delete process.env["SUMMON_NO_SPINNER"];
    } else {
      process.env["SUMMON_NO_SPINNER"] = origNoSpinner;
    }
  });
});
