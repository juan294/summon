import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

const mockResolveCommand = vi.fn();
vi.mock("./utils.js", async () => {
  const actual = await vi.importActual<typeof import("./utils.js")>("./utils.js");
  return { ...actual, resolveCommand: (...args: unknown[]) => mockResolveCommand(...args) };
});

const fsStore = new Map<string, string>();
const mockMkdirSync = vi.fn();
const mockChmodSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (path: string) => fsStore.has(path),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
}));

import {
  isStarshipInstalled,
  listStarshipPresets,
  isValidPreset,
  ensurePresetConfig,
  getPresetConfigPath,
  resetStarshipCache,
} from "./starship.js";

beforeEach(() => {
  vi.clearAllMocks();
  fsStore.clear();
  resetStarshipCache();
  mockResolveCommand.mockReturnValue(null);
});

describe("isStarshipInstalled", () => {
  it("returns true when resolveCommand finds starship", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    expect(isStarshipInstalled()).toBe(true);
    expect(mockResolveCommand).toHaveBeenCalledWith("starship");
  });

  it("returns false when resolveCommand returns null", () => {
    mockResolveCommand.mockReturnValue(null);
    expect(isStarshipInstalled()).toBe(false);
  });
});

describe("listStarshipPresets", () => {
  it("returns parsed preset names from starship CLI output", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockReturnValue("tokyo-night\npastel-powerline\ngruvbox-rainbow\n");
    const presets = listStarshipPresets();
    expect(presets).toEqual(["tokyo-night", "pastel-powerline", "gruvbox-rainbow"]);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/local/bin/starship",
      ["preset", "--list"],
      { encoding: "utf-8" },
    );
  });

  it("returns empty array when starship not installed", () => {
    mockResolveCommand.mockReturnValue(null);
    expect(listStarshipPresets()).toEqual([]);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns empty array when starship command fails", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockImplementation(() => {
      throw new Error("command failed");
    });
    expect(listStarshipPresets()).toEqual([]);
  });

  it("filters empty lines from output", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockReturnValue("\ntokyo-night\n\npastel-powerline\n\n");
    expect(listStarshipPresets()).toEqual(["tokyo-night", "pastel-powerline"]);
  });
});

describe("isValidPreset", () => {
  beforeEach(() => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockReturnValue("tokyo-night\npastel-powerline\n");
  });

  it("returns true for valid preset name", () => {
    expect(isValidPreset("tokyo-night")).toBe(true);
  });

  it("returns false for name not in preset list", () => {
    expect(isValidPreset("nonexistent-preset")).toBe(false);
  });

  it("returns false for name failing SAFE_COMMAND_RE", () => {
    expect(isValidPreset("foo;rm -rf")).toBe(false);
  });

  it("returns false when starship not installed", () => {
    mockResolveCommand.mockReturnValue(null);
    expect(isValidPreset("tokyo-night")).toBe(false);
  });
});

describe("ensurePresetConfig", () => {
  it("returns cached path when TOML already exists", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    const expectedPath = getPresetConfigPath("tokyo-night");
    fsStore.set(expectedPath, "# cached toml");
    const result = ensurePresetConfig("tokyo-night");
    expect(result).toBe(expectedPath);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("generates TOML via starship CLI when cache miss", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    const expectedPath = getPresetConfigPath("pastel-powerline");
    mockExecFileSync.mockImplementation(
      (_cmd: string, args: string[]) => {
        if (args.includes("-o")) fsStore.set(expectedPath, "# generated toml");
        return "";
      },
    );
    const result = ensurePresetConfig("pastel-powerline");
    expect(result).toBe(expectedPath);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "/usr/local/bin/starship",
      ["preset", "pastel-powerline", "-o", expectedPath],
      { encoding: "utf-8" },
    );
  });

  it("creates STARSHIP_DIR with mode 0o700 if missing", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    const expectedPath = getPresetConfigPath("jetpack");
    mockExecFileSync.mockImplementation(
      (_cmd: string, args: string[]) => {
        if (args.includes("-o")) fsStore.set(expectedPath, "# toml");
        return "";
      },
    );
    ensurePresetConfig("jetpack");
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("starship"),
      { recursive: true, mode: 0o700 },
    );
  });

  it("throws if starship CLI fails", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockImplementation(() => {
      throw new Error("starship error");
    });
    expect(() => ensurePresetConfig("bad-preset")).toThrow(
      /Failed to generate Starship preset "bad-preset"/,
    );
  });

  it("throws if file not created after CLI call", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockReturnValue("");
    expect(() => ensurePresetConfig("ghost-preset")).toThrow(
      /did not produce a config file/,
    );
  });

  it("sets 0o600 permissions on generated TOML file", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    const expectedPath = getPresetConfigPath("tokyo-night");
    mockExecFileSync.mockImplementation(
      (_cmd: string, args: string[]) => {
        if (args.includes("-o")) fsStore.set(expectedPath, "# generated toml");
        return "";
      },
    );
    ensurePresetConfig("tokyo-night");
    expect(mockChmodSync).toHaveBeenCalledWith(expectedPath, 0o600);
  });

  it("throws for unsafe preset name (defense-in-depth)", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    expect(() => ensurePresetConfig("../../etc/evil")).toThrow(
      /Invalid Starship preset name/,
    );
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("throws when starship is not installed", () => {
    mockResolveCommand.mockReturnValue(null);
    expect(() => ensurePresetConfig("tokyo-night")).toThrow(
      /Starship is not installed/,
    );
  });
});

describe("getPresetConfigPath", () => {
  it("returns correct path for preset name", () => {
    const result = getPresetConfigPath("tokyo-night");
    expect(result).toMatch(/starship\/tokyo-night\.toml$/);
  });

  it("path is under ~/.config/summon/starship/", () => {
    const result = getPresetConfigPath("gruvbox-rainbow");
    expect(result).toContain(".config/summon/starship/");
  });
});

describe("starship path caching", () => {
  it("calls resolveCommand only once across multiple function calls", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    mockExecFileSync.mockReturnValue("tokyo-night\n");
    isStarshipInstalled();
    listStarshipPresets();
    isStarshipInstalled();
    expect(mockResolveCommand).toHaveBeenCalledTimes(1);
  });

  it("re-checks after resetStarshipCache", () => {
    mockResolveCommand.mockReturnValue("/usr/local/bin/starship");
    isStarshipInstalled();
    resetStarshipCache();
    isStarshipInstalled();
    expect(mockResolveCommand).toHaveBeenCalledTimes(2);
  });
});
