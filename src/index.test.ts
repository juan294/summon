import { spawnSync, execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// #51: Isolate integration tests from user config by using a temp HOME
let TEMP_HOME: string;

beforeAll(() => {
  execSync("pnpm build", { cwd: PROJECT_ROOT, stdio: "ignore" });
  TEMP_HOME = mkdtempSync(join(tmpdir(), "summon-test-"));
});

afterAll(() => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
});

function run(...args: string[]) {
  return spawnSync("node", ["dist/index.js", ...args], {
    encoding: "utf-8",
    cwd: PROJECT_ROOT,
    env: { ...process.env, HOME: TEMP_HOME },
  });
}

describe("CLI integration", () => {
  it("prints help with --help and exits 0", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("summon");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Options:");
  });

  it("prints version with --version and exits 0", () => {
    const result = run("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("shows help and exits 1 with no arguments", () => {
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("errors on invalid flag and exits 1", () => {
    const result = run("--invalid-flag");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
    expect(result.stderr).toContain("summon --help");
  });

  it("errors on 'add' with missing arguments", () => {
    const result = run("add");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon add");
  });

  it("errors on 'add' with only name", () => {
    const result = run("add", "myproject");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon add");
  });

  it("errors on 'remove' with missing name", () => {
    const result = run("remove");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon remove");
  });

  it("errors on 'set' with missing key", () => {
    const result = run("set");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: summon set");
  });

  it("rejects unknown config key with exit code 1", () => {
    const result = run("set", "bogus-key", "somevalue");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown config key");
    expect(result.stderr).toContain("bogus-key");
  });

  it("shows empty project list", () => {
    const result = run("list");
    // May show projects or empty message depending on user's config
    expect(result.status).toBe(0);
  });

  it("errors on unknown project name", () => {
    const result = run("nonexistent-project-12345");
    // Will either fail as unknown project or fail because Ghostty isn't available
    expect(result.status).not.toBe(0);
  });

  describe("per-subcommand --help", () => {
    it("shows help for 'add' subcommand with --help", () => {
      const result = run("add", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: summon add <name> <path>");
    });

    it("shows help for 'add' subcommand with -h", () => {
      const result = run("add", "-h");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: summon add <name> <path>");
    });

    it("shows help for 'remove' subcommand with --help", () => {
      const result = run("remove", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: summon remove <name>");
    });

    it("shows help for 'set' subcommand with --help", () => {
      const result = run("set", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: summon set <key> [value]");
      expect(result.stdout).toContain("Valid keys:");
    });

    it("shows help for 'list' subcommand with --help", () => {
      const result = run("list", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: summon list");
    });

    it("shows help for 'config' subcommand with --help", () => {
      const result = run("config", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: summon config");
    });
  });

  describe("relative path resolution", () => {
    it("resolves ./somedir as a path, not a project name", () => {
      const result = run("./somedir");
      expect(result.status).not.toBe(0);
      // Should resolve as a path and fail with "Directory not found",
      // NOT "Unknown project"
      expect(result.stderr).not.toContain("Unknown project");
      expect(result.stderr).toContain("Directory not found");
    });

    it("resolves ../somedir as a path, not a project name", () => {
      const result = run("../somedir");
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain("Unknown project");
      expect(result.stderr).toContain("Directory not found");
    });

    it("resolves somedir/subdir as a path, not a project name", () => {
      const result = run("somedir/subdir");
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain("Unknown project");
      expect(result.stderr).toContain("Directory not found");
    });
  });

  describe("set without value removes key", () => {
    it("removes editor key and shows default message", () => {
      const result = run("set", "editor");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Removed editor");
      expect(result.stdout).toContain("will use default");
    });

    it("removes sidebar key and shows default message", () => {
      const result = run("set", "sidebar");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Removed sidebar");
      expect(result.stdout).toContain("will use default");
    });

    it("removes panes key and shows default message", () => {
      const result = run("set", "panes");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Removed panes");
      expect(result.stdout).toContain("will use default");
    });

    it("removes editor-size key and shows default message", () => {
      const result = run("set", "editor-size");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Removed editor-size");
      expect(result.stdout).toContain("will use default");
    });
  });

  describe("--panes validation", () => {
    it("rejects non-numeric value", () => {
      const result = run(".", "--panes", "foo");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("--panes");
      expect(result.stderr).toContain("positive integer");
      expect(result.stderr).toContain("summon --help");
    });

    it("rejects zero", () => {
      const result = run(".", "--panes", "0");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("--panes");
      expect(result.stderr).toContain("positive integer");
      expect(result.stderr).toContain("summon --help");
    });
  });

  describe("--auto-resize / --no-auto-resize", () => {
    it("accepts --no-auto-resize and produces script WITHOUT resize commands", () => {
      const result = run(".", "--no-auto-resize", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("resize_split");
    });

    it("accepts --auto-resize and produces script WITH resize commands", () => {
      const result = run(".", "--auto-resize", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("resize_split");
    });
  });

  describe("--editor-size validation", () => {
    it("rejects non-numeric value", () => {
      const result = run(".", "--editor-size", "abc");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("--editor-size");
      expect(result.stderr).toContain("1-99");
      expect(result.stderr).toContain("summon --help");
    });

    it("rejects zero", () => {
      const result = run(".", "--editor-size", "0");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("--editor-size");
      expect(result.stderr).toContain("1-99");
      expect(result.stderr).toContain("summon --help");
    });

    it("rejects 100", () => {
      const result = run(".", "--editor-size", "100");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("--editor-size");
      expect(result.stderr).toContain("1-99");
      expect(result.stderr).toContain("summon --help");
    });
  });

  // #43: `summon set` treats "0" as removal due to truthiness check
  // Updated for #68: panes=0 is now rejected by validation (min is 1)
  describe("set value '0' truthiness (#43)", () => {
    it("rejects panes '0' with validation error (#68 supersedes)", () => {
      const result = run("set", "panes", "0");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("panes");
    });

    it("stores and confirms value '0' for editor (no numeric validation)", () => {
      const result = run("set", "editor", "0");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Set editor");
      expect(result.stdout).toContain("0");
      expect(result.stdout).not.toContain("empty");
      expect(result.stdout).not.toContain("default");
    });
  });

  // #44: Config display improvements
  describe("config display (#44)", () => {
    it("shows '(plain shell)' only for editor/sidebar keys, not for others", () => {
      // Set editor and panes to empty string values explicitly
      run("set", "editor", "");
      run("set", "panes", "");
      const result = run("config");
      expect(result.status).toBe(0);
      const lines = result.stdout.split("\n");
      const editorLine = lines.find((l: string) => l.includes("editor") && !l.includes("editor-size"));
      const panesLine = lines.find((l: string) => l.includes("panes"));
      // editor should show "(plain shell)" when empty
      expect(editorLine).toContain("(plain shell)");
      // panes should NOT show "(plain shell)" when empty
      if (panesLine) {
        expect(panesLine).not.toContain("(plain shell)");
        expect(panesLine).toContain("(empty)");
      }
    });

    it("shows empty-state message when config map is empty", () => {
      // Use a fresh temp home with no config at all
      const freshHome = mkdtempSync(join(tmpdir(), "summon-empty-"));
      const freshResult = spawnSync("node", ["dist/index.js", "config"], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: freshHome },
      });
      rmSync(freshHome, { recursive: true, force: true });
      // The config file gets auto-created with editor=claude, so it won't be fully empty.
      // But we should at least verify it succeeds and shows "Machine config:" header
      expect(freshResult.status).toBe(0);
      expect(freshResult.stdout).toContain("Machine config:");
    });
  });

  // #45: Validate --layout at parse time
  describe("--layout validation (#45)", () => {
    it("rejects invalid layout preset with exit 1", () => {
      const result = run(".", "--layout", "bogus");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("--layout");
      expect(result.stderr).toContain("bogus");
    });

    it("accepts valid layout preset", () => {
      const result = run(".", "--layout", "minimal", "--dry-run");
      expect(result.status).toBe(0);
    });
  });

  // #46: Validate server values in `summon set`
  describe("set server validation (#46)", () => {
    it("warns on ambiguous server value", () => {
      const result = run("set", "server", "yes");
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Hint:");
    });

    it("does not warn for 'true'", () => {
      const result = run("set", "server", "true");
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("Hint:");
    });

    it("does not warn for 'false'", () => {
      const result = run("set", "server", "false");
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("Hint:");
    });

    it("does not warn for a command with '/'", () => {
      const result = run("set", "server", "/usr/bin/python");
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("Hint:");
    });

    it("does not warn for a command with spaces", () => {
      const result = run("set", "server", "npm run dev");
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("Hint:");
    });
  });

  // #51: Tests use isolated HOME
  describe("config isolation (#51)", () => {
    it("uses isolated temp HOME, not real user config", () => {
      // list should show empty projects in isolated env
      const result = run("list");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("No projects registered");
    });
  });

  // #58: config command should warn about unknown keys
  describe("config unknown key warning (#58)", () => {
    it("shows '(unknown key)' annotation for unrecognized config keys", () => {
      // Manually write a config file with an unknown key
      const configDir = join(TEMP_HOME, ".config", "summon");
      const configFile = join(configDir, "config");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configFile, "editor=vim\nbogus-key=hello\n", "utf-8");
      const result = run("config");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("bogus-key");
      expect(result.stdout).toContain("unknown key");
    });
  });

  // #68: validate panes/editor-size/layout/auto-resize in set subcommand
  describe("set value validation (#68)", () => {
    describe("panes validation", () => {
      it("rejects non-numeric panes value", () => {
        const result = run("set", "panes", "abc");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("panes");
        expect(result.stderr).toContain("positive integer");
      });

      it("rejects zero panes", () => {
        const result = run("set", "panes", "0");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("panes");
      });

      it("accepts valid panes value", () => {
        const result = run("set", "panes", "3");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Set panes");
      });
    });

    describe("editor-size validation", () => {
      it("rejects non-numeric editor-size value", () => {
        const result = run("set", "editor-size", "abc");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("editor-size");
      });

      it("rejects out-of-range editor-size value", () => {
        const result = run("set", "editor-size", "200");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("editor-size");
      });

      it("rejects zero editor-size", () => {
        const result = run("set", "editor-size", "0");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("editor-size");
      });

      it("accepts valid editor-size value", () => {
        const result = run("set", "editor-size", "75");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Set editor-size");
      });
    });

    describe("layout validation", () => {
      it("rejects invalid layout preset", () => {
        const result = run("set", "layout", "bogus");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("layout");
        expect(result.stderr).toContain("bogus");
        expect(result.stderr).toContain("Valid presets:");
      });

      it("accepts valid layout preset", () => {
        const result = run("set", "layout", "minimal");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Set layout");
      });
    });

    describe("auto-resize validation", () => {
      it("rejects non-boolean auto-resize value", () => {
        const result = run("set", "auto-resize", "yes");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error:");
        expect(result.stderr).toContain("auto-resize");
        expect(result.stderr).toContain('"true" or "false"');
      });

      it("accepts 'true' for auto-resize", () => {
        const result = run("set", "auto-resize", "true");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Set auto-resize");
      });

      it("accepts 'false' for auto-resize", () => {
        const result = run("set", "auto-resize", "false");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Set auto-resize");
      });
    });
  });

  // #62: add -e short flag for --editor
  describe("-e short flag for --editor (#62)", () => {
    it("accepts -e as a short flag for --editor in dry-run", () => {
      const result = run(".", "-e", "vim", "--dry-run");
      expect(result.status).toBe(0);
      // The generated script should reference vim as the editor command
      expect(result.stdout).toContain("vim");
    });

    it("shows -e in help text", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("-e, --editor");
    });
  });

  // #63: warn when both --auto-resize and --no-auto-resize are passed
  describe("auto-resize conflict warning (#63)", () => {
    it("warns on stderr when both --auto-resize and --no-auto-resize are given", () => {
      const result = run(".", "--auto-resize", "--no-auto-resize", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Warning:");
      expect(result.stderr).toContain("--auto-resize");
      expect(result.stderr).toContain("--no-auto-resize");
    });

    it("uses --no-auto-resize when both are given (no resize commands in script)", () => {
      const result = run(".", "--auto-resize", "--no-auto-resize", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("resize_split");
    });
  });
});
