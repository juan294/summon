import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import type { CLIOverrides } from "./config-resolve.js";

// SE-L3: env keys that change what runs at shell startup or inside common tools. Both backends apply
// the workspace env before the pane shell starts (Ghostty surface env, Rex `/usr/bin/env K=V … shell -l`).
// Same config, trust and fs mocks as config-resolve.test.ts.
const mockReadKVFile = vi.fn((_path: string) => new Map<string, string>());
vi.mock("./config.js", () => ({
  listConfig: vi.fn(() => new Map<string, string>()),
  listProjects: vi.fn(() => new Map<string, string>()),
  readKVFile: (path: string) => mockReadKVFile(path),
  readKVFromString: (text: string) => new Map(text.split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as [string, string])),
  readCustomLayout: vi.fn(() => null),
  isCustomLayout: vi.fn(() => false),
  CONFIG_DIR: "/mock/.config/summon",
  STATUS_DIR: "/mock/.config/summon/status",
  LAYOUT_NAME_RE: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  realpathSync: vi.fn((path: string) => path),
  readFileSync: vi.fn(() => {
    throw new Error("fixture absent");
  }),
}));

vi.mock("./trust.js", () => ({
  assertTrusted: vi.fn(),
  assertTrustedContent: vi.fn(),
}));

const { resolveConfig } = await import("./config-resolve.js");
const { listConfig } = await import("./config.js");

function resolveWith(summon: Map<string, string>, overrides: CLIOverrides = {}): ReturnType<typeof resolveConfig> {
  return resolveConfig("/tmp/workspace", overrides, [...summon].map(([key, value]) => `${key}=${value}`).join("\n"));
}

const NEWLY_DENIED = [
  "ENV",
  "SHELL",
  "PS1",
  "PROMPT",
  "PERL5OPT",
  "RUBYOPT",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "LESSOPEN",
  "LESSCLOSE",
];

// Already denied before SE-L3; pinned here so the startup-hook set stays complete.
const ALREADY_DENIED = ["BASH_ENV", "NODE_OPTIONS", "PYTHONSTARTUP", "PROMPT_COMMAND"];

let stderr: MockInstance<typeof process.stderr.write>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listConfig).mockReturnValue(new Map<string, string>([["editor", "vim"]]));
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderr.mockRestore();
});

describe("env denylist: shell startup and tool hooks (SE-L3)", () => {
  it.each([...NEWLY_DENIED, ...ALREADY_DENIED])("drops %s from a .summon file with the denylist warning", (envKey) => {
    const result = resolveWith(new Map([[`env.${envKey}`, "/tmp/evil"], ["env.KEEP", "1"]]));
    expect(result.envVars).toEqual({ KEEP: "1" });
    expect(stderr).toHaveBeenCalledWith(`summon: warning: ignoring denylisted env var key "${envKey}" from .summon file.\n`);
  });

  it.each(NEWLY_DENIED)("drops %s from machine config with the denylist warning", (envKey) => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], [`env.${envKey}`, "/tmp/evil"]]));
    const result = resolveWith(new Map());
    expect(result.envVars).not.toHaveProperty(envKey);
    expect(stderr).toHaveBeenCalledWith(`summon: warning: ignoring denylisted env var key "${envKey}" from machine config.\n`);
  });

  it.each(NEWLY_DENIED)("drops %s from --env with the denylist warning", (envKey) => {
    const result = resolveWith(new Map(), { env: [`${envKey}=/tmp/evil`] });
    expect(result.envVars).not.toHaveProperty(envKey);
    expect(stderr).toHaveBeenCalledWith(`summon: warning: ignoring denylisted env var key "${envKey}" from --env flag.\n`);
  });
});

describe("env keys that stay allowed (SE-L3)", () => {
  // PATH and PYTHONPATH are search paths users set on purpose; HOME carries the rex-cli E2E sandbox;
  // ZDOTDIR is a user-chosen zsh startup location (the Rex E2E suites pass --env ZDOTDIR=<dir>).
  it.each(["PATH", "HOME", "PYTHONPATH", "ZDOTDIR", "GIT_AUTHOR_NAME", "LESS"])("keeps %s from every source without a warning", (envKey) => {
    vi.mocked(listConfig).mockReturnValue(new Map([["editor", "vim"], [`env.${envKey}`, "machine"]]));
    expect(resolveWith(new Map()).envVars[envKey]).toBe("machine");
    expect(resolveWith(new Map([[`env.${envKey}`, "project"]])).envVars[envKey]).toBe("project");
    expect(resolveWith(new Map(), { env: [`${envKey}=cli`] }).envVars[envKey]).toBe("cli");
    expect(stderr).not.toHaveBeenCalled();
  });
});
