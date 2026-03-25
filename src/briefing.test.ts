import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./config.js")>();
  return { ...original, listProjects: vi.fn().mockReturnValue([]) };
});
vi.mock("./status.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./status.js")>();
  return {
    ...original,
    readAllStatuses: vi.fn().mockReturnValue([]),
    getGitBranch: vi.fn().mockReturnValue(null),
  };
});
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFileSync: vi.fn().mockReturnValue("") };
});

const {
  isAgentCommit,
  collectGitData,
  collectBriefingData,
  formatProjectBriefing,
  formatBriefingHeader,
  formatBriefingSummary,
  formatFullBriefing,
  generateRecommendation,
  runBriefing,
} = await import("./briefing.js");
import type { ProjectBriefing, BriefingSummary, CommitSummary } from "./briefing.js";

const { listProjects } = await import("./config.js") as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
};
const { readAllStatuses, getGitBranch } = await import("./status.js") as unknown as {
  readAllStatuses: ReturnType<typeof vi.fn>;
  getGitBranch: ReturnType<typeof vi.fn>;
};
const { execFileSync } = await import("node:child_process") as unknown as {
  execFileSync: ReturnType<typeof vi.fn>;
};

// --- Test helpers ---

function makeBriefing(overrides?: Partial<ProjectBriefing>): ProjectBriefing {
  return {
    name: "myapp",
    directory: "/tmp/myapp",
    state: "active",
    uptime: 3600000,
    gitBranch: "main",
    overnightCommits: [],
    dirtyFiles: [],
    lastSession: null,
    ...overrides,
  };
}

function makeCommit(overrides?: Partial<CommitSummary>): CommitSummary {
  return {
    hash: "abc1234",
    subject: "feat: add login",
    author: "Juan",
    isAgent: false,
    ...overrides,
  };
}

function makeSummary(overrides?: Partial<BriefingSummary>): BriefingSummary {
  return {
    totalProjects: 3,
    activeCount: 1,
    totalOvernightCommits: 5,
    recommendation: null,
    ...overrides,
  };
}

// --- isAgentCommit ---

describe("isAgentCommit", () => {
  it("detects Claude co-authored commits via message", () => {
    expect(isAgentCommit("Juan", "feat: add auth\n\nCo-Authored-By: Claude")).toBe(true);
  });

  it("detects Copilot author name", () => {
    expect(isAgentCommit("Copilot", "fix: typo")).toBe(true);
  });

  it("detects 'agent' in author name", () => {
    expect(isAgentCommit("my-agent-bot", "refactor: cleanup")).toBe(true);
  });

  it("detects 'bot' in author name", () => {
    expect(isAgentCommit("dependabot", "chore: bump dep")).toBe(true);
  });

  it("returns false for human commits", () => {
    expect(isAgentCommit("Juan", "feat: manual change")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(isAgentCommit("", "")).toBe(false);
  });

  it("is case-insensitive for author", () => {
    expect(isAgentCommit("CLAUDE", "some commit")).toBe(true);
  });

  it("is case-insensitive for message", () => {
    expect(isAgentCommit("Juan", "fix: thing\n\nco-authored-by: COPILOT")).toBe(true);
  });
});

// --- generateRecommendation ---

describe("generateRecommendation", () => {
  it("returns null when no projects have issues", () => {
    const projects = [makeBriefing()];
    expect(generateRecommendation(projects)).toBe(null);
  });

  it("prioritizes stale active workspaces (long uptime + dirty)", () => {
    const stale = makeBriefing({
      name: "stale-app",
      state: "active",
      uptime: 10 * 3600000, // 10 hours
      dirtyFiles: ["file.ts"],
    });
    const agentWork = makeBriefing({
      name: "agent-app",
      overnightCommits: [makeCommit({ isAgent: true })],
    });
    expect(generateRecommendation([stale, agentWork])).toBe(
      "stale-app (long-running, uncommitted changes)",
    );
  });

  it("recommends projects with agent commits second", () => {
    const agentWork = makeBriefing({
      name: "agent-app",
      overnightCommits: [makeCommit({ isAgent: true, subject: "feat: automated" })],
    });
    const dirty = makeBriefing({
      name: "dirty-app",
      dirtyFiles: ["src/index.ts"],
    });
    expect(generateRecommendation([agentWork, dirty])).toBe(
      "agent-app (agent commits to review)",
    );
  });

  it("recommends dirty projects third", () => {
    const dirty = makeBriefing({
      name: "dirty-app",
      dirtyFiles: ["file.ts"],
    });
    const clean = makeBriefing({ name: "clean-app" });
    expect(generateRecommendation([clean, dirty])).toBe(
      "dirty-app (uncommitted changes)",
    );
  });

  it("returns null for empty project list", () => {
    expect(generateRecommendation([])).toBe(null);
  });

  it("does not flag stale if uptime is under 8 hours", () => {
    const project = makeBriefing({
      state: "active",
      uptime: 7 * 3600000,
      dirtyFiles: ["file.ts"],
    });
    // Should match dirty but not stale
    expect(generateRecommendation([project])).toBe("myapp (uncommitted changes)");
  });

  it("does not flag stale if no dirty files", () => {
    const project = makeBriefing({
      state: "active",
      uptime: 10 * 3600000,
      dirtyFiles: [],
    });
    expect(generateRecommendation([project])).toBe(null);
  });
});

// --- collectGitData ---

describe("collectGitData", () => {
  beforeEach(() => {
    getGitBranch.mockReturnValue(null);
    execFileSync.mockReturnValue("");
  });

  it("returns branch from getGitBranch", () => {
    getGitBranch.mockReturnValue("develop");
    const result = collectGitData("/tmp/myapp");
    expect(result.branch).toBe("develop");
  });

  it("returns null branch when getGitBranch returns null", () => {
    getGitBranch.mockReturnValue(null);
    const result = collectGitData("/tmp/myapp");
    expect(result.branch).toBeNull();
  });

  it("parses overnight commits from git log output", () => {
    getGitBranch.mockReturnValue("main");
    execFileSync
      .mockReturnValueOnce("abc123|feat: add auth|Juan\ndef456|fix: typo|Claude")
      .mockReturnValueOnce(""); // git status --porcelain

    const result = collectGitData("/tmp/myapp");
    expect(result.commits).toHaveLength(2);
    expect(result.commits[0]!.hash).toBe("abc123");
    expect(result.commits[0]!.subject).toBe("feat: add auth");
    expect(result.commits[0]!.author).toBe("Juan");
    expect(result.commits[0]!.isAgent).toBe(false);
    expect(result.commits[1]!.isAgent).toBe(true); // "Claude" matches agent pattern
  });

  it("returns empty commits when git log returns empty", () => {
    getGitBranch.mockReturnValue("main");
    execFileSync.mockReturnValue("");

    const result = collectGitData("/tmp/myapp");
    expect(result.commits).toEqual([]);
  });

  it("returns empty commits on git log error", () => {
    getGitBranch.mockReturnValue("main");
    execFileSync.mockImplementation(() => { throw new Error("not a git repo"); });

    const result = collectGitData("/tmp/myapp");
    expect(result.commits).toEqual([]);
    expect(result.dirty).toEqual([]);
  });

  it("parses dirty files from git status --porcelain", () => {
    getGitBranch.mockReturnValue("main");
    execFileSync
      .mockReturnValueOnce("") // git log
      .mockReturnValueOnce("M  src/index.ts\n?? new-file.ts");

    const result = collectGitData("/tmp/myapp");
    expect(result.dirty).toEqual(["src/index.ts", "new-file.ts"]);
  });

  it("returns empty dirty when status is clean", () => {
    getGitBranch.mockReturnValue("main");
    execFileSync.mockReturnValue("");

    const result = collectGitData("/tmp/myapp");
    expect(result.dirty).toEqual([]);
  });
});

// --- collectBriefingData ---

describe("collectBriefingData", () => {
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
    execFileSync.mockReturnValue("");
  });

  it("returns empty projects when none registered", () => {
    const { projects, summary } = collectBriefingData();
    expect(projects).toEqual([]);
    expect(summary.totalProjects).toBe(0);
    expect(summary.activeCount).toBe(0);
    expect(summary.totalOvernightCommits).toBe(0);
  });

  it("builds briefing from registered projects and statuses", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      { project: "myapp", state: "active", uptime: 3_600_000 },
    ]);
    getGitBranch.mockReturnValue("develop");
    execFileSync.mockReturnValue("");

    const { projects, summary } = collectBriefingData();
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe("myapp");
    expect(projects[0]!.state).toBe("active");
    expect(projects[0]!.gitBranch).toBe("develop");
    expect(summary.totalProjects).toBe(1);
    expect(summary.activeCount).toBe(1);
  });

  it("handles unknown state when no status found", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue("main");
    execFileSync.mockReturnValue("");

    const { projects } = collectBriefingData();
    expect(projects[0]!.state).toBe("unknown");
    expect(projects[0]!.uptime).toBeNull();
  });

  it("counts overnight commits in summary", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue("main");
    execFileSync
      .mockReturnValueOnce("abc|feat: something|Juan\ndef|fix: other|Juan")
      .mockReturnValueOnce("");

    const { summary } = collectBriefingData();
    expect(summary.totalOvernightCommits).toBe(2);
  });

  it("generates recommendation when appropriate", () => {
    listProjects.mockReturnValue([["dirtyapp", "/tmp/dirtyapp"]]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue("main");
    execFileSync
      .mockReturnValueOnce("")
      .mockReturnValueOnce(" M dirty-file.ts");

    const { summary } = collectBriefingData();
    expect(summary.recommendation).toBe("dirtyapp (uncommitted changes)");
  });
});

// --- formatProjectBriefing ---

describe("formatProjectBriefing", () => {
  // Disable color for predictable test output
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });

  it("renders active project with branch", () => {
    const output = formatProjectBriefing(makeBriefing({ name: "myapp", gitBranch: "develop" }));
    expect(output).toContain("myapp");
    expect(output).toContain("active");
    expect(output).toContain("develop");
  });

  it("renders stopped project state", () => {
    const output = formatProjectBriefing(makeBriefing({ state: "stopped", uptime: null }));
    expect(output).toContain("stopped");
  });

  it("shows overnight commits with agent tags", () => {
    const commits = [
      makeCommit({ subject: "feat: add auth", isAgent: false }),
      makeCommit({ subject: "fix: typo", isAgent: true }),
    ];
    const output = formatProjectBriefing(makeBriefing({ overnightCommits: commits }));
    expect(output).toContain("2 commits since yesterday");
    expect(output).toContain("feat: add auth");
    expect(output).toContain("(you)");
    expect(output).toContain("fix: typo");
    expect(output).toContain("(agent)");
  });

  it("shows '+ N more' when commits exceed 5", () => {
    const commits = Array.from({ length: 8 }, (_, i) =>
      makeCommit({ subject: `commit ${i + 1}` }),
    );
    const output = formatProjectBriefing(makeBriefing({ overnightCommits: commits }));
    expect(output).toContain("8 commits since yesterday");
    expect(output).toContain("+ 3 more");
  });

  it("shows no new commits message", () => {
    const output = formatProjectBriefing(makeBriefing({ overnightCommits: [] }));
    expect(output).toContain("No new commits");
  });

  it("shows dirty file count", () => {
    const output = formatProjectBriefing(
      makeBriefing({ dirtyFiles: ["a.ts", "b.ts", "c.ts"] }),
    );
    expect(output).toContain("3 modified files (uncommitted)");
  });

  it("shows clean working tree", () => {
    const output = formatProjectBriefing(makeBriefing({ dirtyFiles: [] }));
    expect(output).toContain("Clean working tree");
  });

  it("shows uptime warning for long-running workspaces", () => {
    const output = formatProjectBriefing(
      makeBriefing({ state: "active", uptime: 12 * 3600000 }),
    );
    expect(output).toContain("12h");
  });

  it("shows singular commit text for 1 commit", () => {
    const commits = [makeCommit()];
    const output = formatProjectBriefing(makeBriefing({ overnightCommits: commits }));
    expect(output).toContain("1 commit since yesterday");
  });

  it("shows singular file text for 1 dirty file", () => {
    const output = formatProjectBriefing(makeBriefing({ dirtyFiles: ["one.ts"] }));
    expect(output).toContain("1 modified file (uncommitted)");
  });

  it("handles project with no git branch", () => {
    const output = formatProjectBriefing(makeBriefing({ gitBranch: null }));
    expect(output).not.toContain("Branch:");
  });

  it("shows lastSession when present and not long-running", () => {
    const output = formatProjectBriefing(
      makeBriefing({ state: "stopped", uptime: null, lastSession: "2h ago" }),
    );
    expect(output).toContain("Last session:");
    expect(output).toContain("2h ago");
  });

  it("replaces last tree character when no lastSession and not long-running", () => {
    const output = formatProjectBriefing(
      makeBriefing({ state: "stopped", uptime: null, lastSession: null }),
    );
    // Should end tree with └─ not ├─
    expect(output).toContain("\u2514\u2500");
  });
});

// --- formatBriefingHeader ---

describe("formatBriefingHeader", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });

  it("contains 'summon briefing' text", () => {
    const output = formatBriefingHeader();
    expect(output).toContain("summon briefing");
  });

  it("contains date information", () => {
    const output = formatBriefingHeader();
    // Should contain the current year
    expect(output).toContain(String(new Date().getFullYear()));
  });

  it("uses box-drawing characters", () => {
    const output = formatBriefingHeader();
    expect(output).toMatch(/[═╔╗╚╝║]/);
  });
});

// --- formatBriefingSummary ---

describe("formatBriefingSummary", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });

  it("shows project and commit counts", () => {
    const summary = makeSummary({ totalProjects: 3, activeCount: 1, totalOvernightCommits: 5 });
    const output = formatBriefingSummary(summary);
    expect(output).toContain("3 projects");
    expect(output).toContain("1 active");
    expect(output).toContain("5 overnight commits");
  });

  it("shows recommendation when present", () => {
    const summary = makeSummary({ recommendation: "myapp (agent commits to review)" });
    const output = formatBriefingSummary(summary);
    expect(output).toContain("Start with:");
    expect(output).toContain("myapp (agent commits to review)");
  });

  it("omits recommendation when null", () => {
    const summary = makeSummary({ recommendation: null });
    const output = formatBriefingSummary(summary);
    expect(output).not.toContain("Start with:");
  });
});

// --- formatFullBriefing ---

describe("formatFullBriefing", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
  });

  it("combines header, projects, and summary", () => {
    const projects = [
      makeBriefing({ name: "alpha" }),
      makeBriefing({ name: "beta", state: "stopped", uptime: null }),
    ];
    const summary = makeSummary({ totalProjects: 2 });
    const output = formatFullBriefing(projects, summary);
    expect(output).toContain("summon briefing");
    expect(output).toContain("alpha");
    expect(output).toContain("beta");
    expect(output).toContain("2 projects");
  });

  it("renders empty project list gracefully", () => {
    const summary = makeSummary({ totalProjects: 0, activeCount: 0, totalOvernightCommits: 0 });
    const output = formatFullBriefing([], summary);
    expect(output).toContain("summon briefing");
    expect(output).toContain("0 projects");
  });
});

// --- runBriefing ---

describe("runBriefing", () => {
  beforeEach(() => {
    listProjects.mockReturnValue([]);
    readAllStatuses.mockReturnValue([]);
    getGitBranch.mockReturnValue(null);
    execFileSync.mockReturnValue("");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints empty message when no projects registered", () => {
    runBriefing();
    expect(console.log).toHaveBeenCalledWith(
      "No projects registered. Use 'summon add <name> <path>' to register projects.",
    );
  });

  it("prints full briefing when projects exist", () => {
    listProjects.mockReturnValue([["myapp", "/tmp/myapp"]]);
    readAllStatuses.mockReturnValue([
      { project: "myapp", state: "active", uptime: 60_000 },
    ]);
    getGitBranch.mockReturnValue("main");
    execFileSync.mockReturnValue("");

    runBriefing();
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("summon briefing");
    expect(output).toContain("myapp");
  });
});
