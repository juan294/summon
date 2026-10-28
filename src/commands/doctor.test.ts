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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = vi.hoisted(() => vi.fn());
let home = "";
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => home,
}));
vi.mock("node:child_process", () => ({ execFileSync: exec }));
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
    vi.unstubAllEnvs();
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
