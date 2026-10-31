import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
  existsSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = vi.hoisted(() => vi.fn());
// A pass-through rmdirSync that a test can make fail (doctor --fix reporting, BE-L2).
const rmdirFault = vi.hoisted(() => ({ path: "", code: "" }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    rmdirSync: (...args: Parameters<typeof fs.rmdirSync>) => {
      if (rmdirFault.path && String(args[0]) === rmdirFault.path) throw Object.assign(new Error(rmdirFault.code), { code: rmdirFault.code });
      return fs.rmdirSync(...args);
    },
  };
});
let home = "";
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));
vi.mock("node:child_process", () => ({ execFileSync: exec }));
// Rex discovery is machine-dependent (the app bundle may exist on the developer's Mac): pin it.
const mockDiscoverRex = vi.hoisted(() => vi.fn((): { path: string | null; searched: string[] } => ({ path: null, searched: ["PATH", "/Applications/Rex Beta.app"] })));
vi.mock("../backends/rex/cli.js", async (original) => ({
  ...(await original<typeof import("../backends/rex/cli.js")>()),
  discoverRex: () => mockDiscoverRex(),
}));
home = mkdtempSync(join(tmpdir(), "summon-doctor-"));
const { handleDoctorCommand } = await import("./doctor.js");
const { resetConfigCache } = await import("../config.js");
const { GHOSTTY_PATHS } = await import("../utils.js");
const originalPaths = [...GHOSTTY_PATHS];
const app = join(home, "Applications/Ghostty.app");
const target = join(home, ".config/ghostty/config");
const scalarConfig =
  "shell-integration = detect\nnotify-on-command-finish = unfocused\nscrollback-compression = true\nlink-osc8 = true\nclipboard-read = ask\nclipboard-write = allow\nvt-window-resize-allowed = false\nvt-xt-checksum-report = false\n";
let effective = scalarConfig;
let errors: ReturnType<typeof vi.spyOn>;
const context = (values = {}) => ({
  parsed: { values: {}, positionals: [], args: [] },
  values,
  subcommand: "doctor",
  args: [],
  overrides: {},
});
const output = () => errors.mock.calls.flat().join("\n");
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  rmSync(join(home, ".config"), { recursive: true, force: true });
  rmSync(join(home, "Library"), { recursive: true, force: true });
  mkdirSync(join(home, ".config/ghostty"), { recursive: true });
  mkdirSync(join(home, ".config/summon"), { recursive: true });
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/Resources"), { recursive: true });
  writeFileSync(join(app, "Contents/MacOS/ghostty"), "");
  writeFileSync(
    join(app, "Contents/Resources/Ghostty.sdef"),
    '<class name="terminal"><property name="id"/><property name="pid"/><property name="tty"/><property name="name override" access="rw"/></class><class name="tab"><property name="name override" access="rw"/></class>',
  );
  writeFileSync(target, "# existing preferences\n");
  writeFileSync(join(home, ".config/summon/config"), "");
  writeFileSync(join(home, ".config/summon/projects"), "");
  GHOSTTY_PATHS.splice(0, GHOSTTY_PATHS.length, app);
  resetConfigCache();
  effective = scalarConfig;
  exec.mockReset();
  mockDiscoverRex.mockReturnValue({ path: null, searched: ["PATH", "/Applications/Rex Beta.app"] });
  exec.mockImplementation((binary: string, args: string[]) => {
    if (binary === "osascript") return "Finder";
    if (binary === "/usr/bin/which")
      return args[0] === "missing"
        ? (() => {
            throw new Error("missing");
          })()
        : "/usr/bin/nvim";
    if (binary === "/bin/ps") return join(app, "Contents/MacOS/ghostty");
    if (args[0] === "--version") return "Ghostty 1.4.0";
    if (args[0] === "+list-actions") return "move_tab_to_new_window";
    return readFileSync(target, "utf-8").includes("Added by summon")
      ? scalarConfig
      : effective;
  });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  GHOSTTY_PATHS.splice(0, GHOSTTY_PATHS.length, ...originalPaths);
  rmSync(home, { recursive: true, force: true });
});
Object.defineProperty(globalThis, "__VERSION__", {
  value: "test",
  configurable: true,
});
describe("doctor effective diagnostics", () => {
  it("uses defaults when an explicit file has no keys, without speculative fixes", async () => {
    await handleDoctorCommand(context({ fix: true }));
    expect(output()).toMatch(/checks passed/);
    expect(output()).toContain("Ghostty 1.4.0");
    expect(output()).toContain("nativeIdentity: supported");
    expect(readFileSync(target, "utf-8")).toBe("# existing preferences\n");
    expect(output()).toContain("scrollback-compression=true");
  });
  it("reports a timed-out accessibility probe as INFO, counted neither as a pass nor as a failure (PE-L3)", async () => {
    await handleDoctorCommand(context());
    const [, passed, total] = /(\d+)\/(\d+) checks passed\./.exec(output()) ?? [];
    errors.mockClear();
    const answer = exec.getMockImplementation()!;
    exec.mockImplementation((binary: string, args: string[]) => {
      if (binary === "osascript" && String(args[1]).includes("System Events"))
        throw Object.assign(new Error("spawnSync osascript ETIMEDOUT"), { code: "ETIMEDOUT", signal: "SIGKILL" });
      return answer(binary, args);
    });
    await handleDoctorCommand(context());
    expect(output()).toContain("INFO  Accessibility permission could not be checked (System Events did not answer); a launch will report it if it is missing");
    expect(output()).not.toContain("Accessibility permission is granted");
    expect(output()).not.toContain("Accessibility permission is required");
    expect(output()).toContain(`${Number(passed) - 1}/${Number(total) - 1} checks passed.`);
  });
  it("warns on 1.3.1 while retaining success", async () => {
    exec.mockImplementationOnce(() => "Ghostty 1.3.1");
    await handleDoctorCommand(context());
    expect(output()).toContain("WARN");
    expect(output()).toContain("1.4.0 recommended");
  });
  it("does not claim the security baseline for prereleases", async () => {
    exec.mockImplementationOnce(() => "Ghostty 1.4.0-dev");
    await handleDoctorCommand(context());
    expect(output()).toContain("unverified security baseline");
  });
  it("classifies missing app as FAIL, unknown version as UNAVAILABLE and retries next invocation", async () => {
    GHOSTTY_PATHS.splice(0, GHOSTTY_PATHS.length, join(home, "missing.app"));
    await expect(handleDoctorCommand(context())).rejects.toThrow("exit:2");
    expect(output()).toContain("FAIL");
    GHOSTTY_PATHS.splice(0, GHOSTTY_PATHS.length, app);
    exec.mockImplementationOnce(() => {
      throw new Error("timeout");
    });
    await expect(handleDoctorCommand(context())).rejects.toThrow("exit:2");
    expect(output()).toContain("UNAVAILABLE");
    await handleDoctorCommand(context());
  });
  it("does not fix any key when another effective scalar is invalid", async () => {
    effective = scalarConfig
      .replace("detect", "none")
      .replace("link-osc8 = true", "link-osc8 = invalid");
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
      "exit:2",
    );
    expect(readFileSync(target, "utf-8")).toBe("# existing preferences\n");
    expect(output()).toContain("UNAVAILABLE");
  });
  it("unavailable dictionary/action evidence fails visibly rather than claiming success", async () => {
    writeFileSync(join(app, "Contents/Resources/Ghostty.sdef"), "");
    await expect(handleDoctorCommand(context())).rejects.toThrow("exit:2");
    expect(output()).toContain("unavailable");
  });
  it("backs up an eligible existing target, appends only missing deficient settings and requeries", async () => {
    effective = scalarConfig
      .replace("detect", "none")
      .replace("unfocused", "never");
    await handleDoctorCommand(context({ fix: true }));
    expect(readFileSync(target, "utf-8")).toContain(
      "notify-on-command-finish = unfocused",
    );
    const backups = readdirSync(join(home, ".config/ghostty")).filter((n) =>
      n.includes(".bak."),
    );
    expect(backups).toHaveLength(1);
    expect(
      readFileSync(join(home, ".config/ghostty", backups[0]!), "utf-8"),
    ).toBe("# existing preferences\n");
    expect(
      exec.mock.calls.filter(([, args]) => args[0] === "+show-config"),
    ).toHaveLength(2);
  });
  it.each([
    "shell-integration = none\nnotify-on-command-finish = never\n",
    "config-file = extra.conf\n",
  ])("preserves explicit values/includes (%s)", async (content) => {
    writeFileSync(target, content);
    effective = scalarConfig
      .replace("detect", "none")
      .replace("unfocused", "never");
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
      "exit:2",
    );
    expect(readFileSync(target, "utf-8")).toBe(content);
    expect(output()).toMatch(/edit.*reload/i);
  });
  it.each([
    "Library/Application Support/com.mitchellh.ghostty/config",
    ".config/ghostty/config.ghostty",
  ])("refuses ambiguous second source %s", async (relative) => {
    const alternative = join(home, relative);
    mkdirSync(join(alternative, ".."), { recursive: true });
    writeFileSync(alternative, "shell-integration = none");
    effective = scalarConfig.replace("detect", "none");
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
      "exit:2",
    );
    expect(readFileSync(target, "utf-8")).toBe("# existing preferences\n");
  });
  it("refuses unknown app CLI overrides or XDG origins", async () => {
    effective = scalarConfig.replace("detect", "none");
    vi.stubEnv("XDG_CONFIG_HOME", join(home, "elsewhere"));
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
      "exit:2",
    );
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    exec.mockImplementation((binary: string, args: string[]) =>
      binary === "/bin/ps"
        ? `${app}/Contents/MacOS/ghostty --config-file=other`
        : args[0] === "--version"
          ? "Ghostty 1.4.0"
          : args[0] === "+list-actions"
            ? "move_tab_to_new_window"
            : binary === "osascript"
              ? "Finder"
              : effective,
    );
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
      "exit:2",
    );
    expect(readFileSync(target, "utf-8")).toBe("# existing preferences\n");
  });
  it("never creates a missing target or fixes unreadable effective values", async () => {
    rmSync(target);
    effective = "env = TOKEN=secret\nshell-integration = invalid\n";
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
      "exit:2",
    );
    expect(readdirSync(join(home, ".config/ghostty"))).toEqual([]);
    expect(output()).not.toContain("secret");
    expect(output()).toContain("UNAVAILABLE");
  });
  it.each(["command", "port", "accessibility", "version"])(
    "--fix cannot clear an unrelated %s failure",
    async (kind) => {
      effective = scalarConfig.replace("detect", "none");
      if (kind === "command")
        writeFileSync(join(home, ".config/summon/config"), "editor=missing\n");
      if (kind === "port") {
        const projects = ["api", "web"].map((name) => {
          const dir = join(home, name);
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, "package.json"),
            JSON.stringify({ scripts: { dev: "vite --port 3000" } }),
          );
          return `${name}=${dir}`;
        });
        writeFileSync(
          join(home, ".config/summon/projects"),
          projects.join("\n"),
        );
      }
      if (kind === "version")
        exec.mockImplementationOnce(() => "malformed version");
      if (kind === "accessibility")
        exec.mockImplementation((binary: string, args: string[]) => {
          if (binary === "osascript") throw new Error("assistive access");
          if (binary === "/bin/ps") return `${app}/Contents/MacOS/ghostty`;
          if (args[0] === "--version") return "Ghostty 1.4.0";
          if (args[0] === "+list-actions") return "move_tab_to_new_window";
          return readFileSync(target, "utf-8").includes("Added by summon")
            ? scalarConfig
            : effective;
        });
      await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow(
        "exit:2",
      );
      expect(readFileSync(target, "utf-8")).toContain("Added by summon");
    },
  );
  it("reports configured executables and verbose trust/system details, with stderr only", async () => {
    writeFileSync(
      join(home, ".config/summon/config"),
      "editor=nvim --flag\nsidebar=lazygit\n",
    );
    writeFileSync(
      join(home, ".config/summon/trust.json"),
      JSON.stringify({ one: "sha" }),
    );
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleDoctorCommand(context({ verbose: true }));
    expect(output()).toContain('editor command "nvim" found');
    expect(output()).toContain("Summon version:");
    expect(output()).toContain("Node.js version:");
    expect(output()).toContain("Ghostty path:");
    expect(output()).toContain("1 project");
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe("doctor Rex section (plan P15, Phase 3)", () => {
  const REX = "/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex";
  const rexAnswers = (reachable: boolean) => (binary: string, args: string[]) => {
    if (binary === REX) {
      if (args.includes("version")) return "rex 0.0.1793131181-gdd9a20\ncommit: dd9a201\napi: revision 7 (supports 0 to 7)\n";
      if (args.includes("whoami")) {
        if (!reachable) throw Object.assign(new Error("exit 4"), { status: 4, stderr: "Error: dial unix: connect: no such file\n" });
        return JSON.stringify({ host_id: "host-1" });
      }
      if (args.includes("client.list")) return JSON.stringify({ clients: [
        { client_id: "client:a", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app", label: "Studio" } },
        { client_id: "client:b", connected_at: "2026-10-29T07:00:00Z", connection_state: "lost", info: { kind: "app" } },
      ] });
    }
    if (binary === "osascript") return "Finder";
    if (binary === "/usr/bin/which") return "/usr/bin/nvim";
    if (binary === "/bin/ps") return join(app, "Contents/MacOS/ghostty");
    if (args[0] === "--version") return "Ghostty 1.4.0";
    if (args[0] === "+list-actions") return "move_tab_to_new_window";
    return effective;
  };

  it("says the Rex CLI is not found when it is absent", async () => {
    await handleDoctorCommand(context());
    expect(output()).toContain("Checking Rex...");
    expect(output()).toContain("Rex CLI not found (searched PATH, /Applications/Rex Beta.app); not applicable");
  });

  it("reports version, api revision, server, app clients with their state and this shell's backend", async () => {
    mockDiscoverRex.mockReturnValue({ path: REX, searched: ["PATH"] });
    exec.mockImplementation(rexAnswers(true));
    await handleDoctorCommand(context());
    expect(output()).toContain(`Rex CLI found at ${REX}`);
    expect(output()).toContain("rex 0.0.1793131181-gdd9a20 (api: revision 7 (supports 0 to 7))");
    expect(output()).toContain("Rex server reachable at unix://");
    expect(output()).toContain("app client client:a (Studio) connected");
    expect(output()).toContain("app client client:b lost");
    expect(output()).toContain("this shell launches in ghostty (placement outside)");
    expect(output()).toMatch(/checks passed/);
    const rexCalls = exec.mock.calls.filter((c) => c[0] === REX).map((c) => c[1] as string[]);
    expect(rexCalls.every((args) => args.includes("--autostart=false"))).toBe(true);
  });

  it("escapes control characters in the rex version lines and the app client fields (Strix CWE-150)", async () => {
    mockDiscoverRex.mockReturnValue({ path: REX, searched: ["PATH"] });
    const answers = rexAnswers(true);
    exec.mockImplementation((binary: string, args: string[]) => {
      if (binary === REX && args.includes("version")) return "rex 1\u001b]52;c;aGk=\u0007\napi: revision 7\u001b[2K\n";
      if (binary === REX && args.includes("client.list")) return JSON.stringify({ clients: [{ client_id: "client:a", connected_at: "2026-10-29T08:00:00Z", connection_state: "connected", info: { kind: "app", label: "Stu\u001b[2Kdio" } }] });
      return answers(binary, args);
    });
    await handleDoctorCommand(context());
    expect(output()).not.toContain("\u001b");
    expect(output()).toContain("rex 1\\u001b]52;c;aGk=\\u0007 (api: revision 7\\u001b[2K)");
    expect(output()).toContain("app client client:a (Stu\\u001b[2Kdio) connected");
  });

  it("an unreachable server is informational under Ghostty and a failure when Rex is this shell's backend", async () => {
    mockDiscoverRex.mockReturnValue({ path: REX, searched: ["PATH"] });
    exec.mockImplementation(rexAnswers(false));
    await handleDoctorCommand(context());
    expect(output()).toContain("INFO  Rex server not reachable");

    errors.mockClear();
    vi.stubEnv("TERM_PROGRAM", "rex");
    await expect(handleDoctorCommand(context())).rejects.toThrow("exit:2");
    expect(output()).toContain("FAIL  Rex server not reachable");
    expect(output()).toContain("this shell launches in rex (placement inside-rex");
  });

  it("reads the config once, so an unknown key is warned about once (Rex checks and command checks share it)", async () => {
    mockDiscoverRex.mockReturnValue({ path: REX, searched: ["PATH"] });
    exec.mockImplementation(rexAnswers(true));
    writeFileSync(join(home, ".config/summon/config"), "editor=nvim\nmaximize=true\nbogus=1\n");
    resetConfigCache();
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await handleDoctorCommand(context());
      expect(warns.mock.calls.flat().filter((line) => String(line).includes("unknown config key: bogus"))).toHaveLength(1);
    } finally {
      warns.mockRestore();
    }
    expect(output()).toContain("Rex ignores these Ghostty settings from your config: maximize");
    expect(output()).toContain("Checking configured commands");
  });

  it("UX-H1: names once the Ghostty-only settings in config that Rex ignores silently, and only when some are set", async () => {
    mockDiscoverRex.mockReturnValue({ path: REX, searched: ["PATH"] });
    exec.mockImplementation(rexAnswers(true));
    writeFileSync(join(home, ".config/summon/config"), "editor=nvim\nmaximize=true\nfloat=false\nfont-size=14\nnew-window=true\n");
    resetConfigCache();
    await handleDoctorCommand(context());
    const lines = output().split("\n").filter((line: string) => line.includes("Rex ignores"));
    expect(lines).toEqual(["  INFO  Rex ignores these Ghostty settings from your config: maximize, font-size, new-window"]);

    errors.mockClear();
    writeFileSync(join(home, ".config/summon/config"), "editor=nvim\nfloat=false\n");
    resetConfigCache();
    await handleDoctorCommand(context());
    expect(output()).not.toContain("Rex ignores");

    // Without Rex there is nothing to say.
    errors.mockClear();
    mockDiscoverRex.mockReturnValue({ path: null, searched: ["PATH"] });
    writeFileSync(join(home, ".config/summon/config"), "editor=nvim\nmaximize=true\n");
    resetConfigCache();
    await handleDoctorCommand(context());
    expect(output()).not.toContain("Rex ignores");
  });

  it("marks the Ghostty checks not applicable, uncounted, when Ghostty is absent and Rex is present", async () => {
    GHOSTTY_PATHS.splice(0, GHOSTTY_PATHS.length, join(home, "missing.app"));
    mockDiscoverRex.mockReturnValue({ path: REX, searched: ["PATH"] });
    exec.mockImplementation(rexAnswers(true));
    try {
      await handleDoctorCommand(context());
    } finally {
      GHOSTTY_PATHS.splice(0, GHOSTTY_PATHS.length, app);
    }
    expect(output()).toContain("not applicable (Rex detected, Ghostty not installed)");
    expect(output()).not.toContain("Ghostty.app not found");
    expect(output()).not.toContain("Accessibility permission");
    expect(output()).toMatch(/\d+\/\d+ checks passed\./);
  });
});
describe("doctor configured commands", () => {
  it("accepts an executable absolute path for editor without calling which (T1.9)", async () => {
    const editor = join(home, "bin/hx");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(editor, "#!/bin/sh\n");
    chmodSync(editor, 0o755);
    writeFileSync(join(home, ".config/summon/config"), `editor=${editor}\n`);
    resetConfigCache();

    await handleDoctorCommand(context());

    expect(output()).toContain(`editor command "${editor}" found at ${editor}`);
    expect(exec).not.toHaveBeenCalledWith("/usr/bin/which", [editor], expect.anything());
  });
});

describe("doctor lock files (BE-L2, QA-L1)", () => {
  const summonDir = () => join(home, ".config/summon");
  const DEAD = 424242;
  function lock(path: string, entries: Array<{ name: string; ageMs?: number }>): string {
    mkdirSync(path, { recursive: true });
    for (const { name, ageMs = 0 } of entries) {
      writeFileSync(join(path, name), "");
      const seconds = (Date.now() - ageMs) / 1000;
      utimesSync(join(path, name), seconds, seconds);
    }
    return path;
  }
  const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  beforeEach(() => {
    const kill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === DEAD) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      return kill(pid, signal);
    }) as typeof process.kill);
  });

  it("--fix reports a stale lock it could not remove instead of claiming it removed it", async () => {
    const dead = lock(join(summonDir(), "config.lock"), [{ name: `${DEAD}-${uuid}.owner` }]);
    rmdirFault.path = dead;
    rmdirFault.code = "ENOTEMPTY";
    try {
      await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow("exit:2");
    } finally {
      rmdirFault.path = "";
    }
    expect(output()).toContain(`Could not remove stale lock ${dead} (owner process ${DEAD} is gone)`);
    expect(output()).not.toContain("Removed stale lock");
  });

  it("passes when no lock is stale, and a live owner's lock is not a finding", async () => {
    lock(join(summonDir(), "trust.json.lock"), [{ name: `${process.pid}-${uuid}.owner` }]);
    await handleDoctorCommand(context({ fix: true }));
    expect(output()).toContain("No stale lock files");
    expect(output()).not.toContain("trust.json.lock");
    expect(existsSync(join(summonDir(), "trust.json.lock"))).toBe(true);
  });

  it("reports stale and unrecognized locks without changing them, and --fix removes only the stale ones", async () => {
    const dead = lock(join(summonDir(), "config.lock"), [{ name: `${DEAD}-${uuid}.owner` }]);
    const expired = lock(join(summonDir(), "status/p.json.lock"), [{ name: `${process.pid}-${uuid}.owner`, ageMs: 65_000 }]);
    const released = lock(join(summonDir(), "status/q.json.lock"), []);
    const unknown = lock(join(summonDir(), "projects.lock"), [{ name: "junk\u001b[31m" }]);
    const live = lock(join(summonDir(), "trust.json.lock"), [{ name: `${process.pid}-${uuid}.owner` }]);

    await expect(handleDoctorCommand(context())).rejects.toThrow("exit:2");
    const report = output();
    expect(report).toContain(`Stale lock ${dead} (owner process ${DEAD} is gone)`);
    expect(report).toContain(`Stale lock ${expired} (owner token is 65 s old)`);
    expect(report).toContain(`Stale lock ${released} (interrupted release)`);
    expect(report).toContain(`Unrecognized lock ${unknown} (junk\\u001b[31m)`);
    expect(report).not.toContain("\u001b[31m");
    expect(report).toContain("(3 auto-fixable with --fix)");
    for (const path of [dead, expired, released, unknown, live]) expect(existsSync(path)).toBe(true);

    errors.mockClear();
    await expect(handleDoctorCommand(context({ fix: true }))).rejects.toThrow("exit:2");
    expect(output()).toContain(`Removed stale lock ${dead}`);
    expect(output()).toContain(`Removed stale lock ${expired}`);
    expect(output()).toContain(`Removed stale lock ${released}`);
    for (const path of [dead, expired, released]) expect(existsSync(path)).toBe(false);
    expect(readdirSync(unknown)).toEqual(["junk\u001b[31m"]);
    expect(existsSync(live)).toBe(true);

    rmSync(unknown, { recursive: true });
    errors.mockClear();
    await handleDoctorCommand(context());
    expect(output()).toContain("No stale lock files");
  });
});
