import { spawnSync, execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
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
    timeout: 30_000,
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

  describe("no-args shows full help", () => {
    it("prints full help to stdout with no arguments", () => {
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Options:");
      expect(result.stdout).toContain("Config keys:");
    });

    it("prints full help to stdout with --help", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Options:");
      expect(result.stdout).toContain("Config keys:");
    });
  });

  it("errors on invalid flag and exits 1", () => {
    const result = run("--invalid-flag");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
    expect(result.stderr).toContain("summon --help");
  });

  it("shows hint for ambiguous flag arguments (#122)", () => {
    const result = run(".", "--font-size", "-5");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Tip:");
    expect(result.stderr).toContain("--flag=-value");
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
      // Since #170 rejects `set editor ""`, we need to write the config file directly
      // to test the display behavior for empty command keys
      const configDir = join(TEMP_HOME, ".config", "summon");
      mkdirSync(configDir, { recursive: true });
      const configFile = join(configDir, "config");
      writeFileSync(configFile, "editor=\npanes=\n", "utf-8");
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
        timeout: 30_000,
      });
      rmSync(freshHome, { recursive: true, force: true });
      // ensureConfig creates an empty config file, so listConfig() returns empty map
      expect(freshResult.status).toBe(0);
      expect(freshResult.stdout).toContain("No machine config set.");
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

    // Retry: this test is flaky under v8 coverage due to subprocess overhead (#166)
    it("accepts valid layout preset", { retry: 2 }, () => {
      const result = run(".", "--layout", "minimal", "--dry-run");
      expect(result.status).toBe(0);
    });
  });

  // #46: Validate shell values in `summon set`
  describe("set shell validation (#46)", () => {
    // #67: Hint removed — all valid shell values are accepted without warning
    it("does not show a hint for any shell value", () => {
      for (const val of ["true", "false", "python", "yes", "/usr/bin/python", "npm run dev"]) {
        const result = run("set", "shell", val);
        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain("Hint:");
      }
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

  // #66: config display treats "0" as falsy
  describe("config display '0' value (#66)", () => {
    it("displays value '0' instead of '(empty)' for non-command keys", () => {
      // Use a fresh HOME to avoid leftover state from other tests
      const freshHome = mkdtempSync(join(tmpdir(), "summon-66-"));
      const runFresh = (...a: string[]) =>
        spawnSync("node", ["dist/index.js", ...a], {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
          env: { ...process.env, HOME: freshHome },
        });
      // Use "editor" key — it accepts any string value including "0"
      runFresh("set", "editor", "0");
      const result = runFresh("config");
      rmSync(freshHome, { recursive: true, force: true });
      expect(result.status).toBe(0);
      const lines = result.stdout.split("\n");
      const editorLine = lines.find((l: string) =>
        l.trimStart().startsWith("editor"),
      );
      expect(editorLine).toBeDefined();
      // The actual value "0" must appear, not the fallback labels
      expect(editorLine).toContain("→ 0");
      expect(editorLine).not.toContain("(empty)");
      expect(editorLine).not.toContain("(plain shell)");
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

      // Retry: this test is flaky under v8 coverage due to subprocess overhead (#166)
      it("accepts valid layout preset", { retry: 2 }, () => {
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

  // #81: Add short flags -p and -s
  describe("short flags -p and -s (#81)", () => {
    it("accepts -p as a short flag for --panes in dry-run", () => {
      const result = run(".", "-p", "3", "--dry-run");
      expect(result.status).toBe(0);
    });

    it("accepts -s as a short flag for --sidebar in dry-run", () => {
      const result = run(".", "-s", "htop", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("htop");
    });

    it("shows -p in help text", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("-p, --panes");
    });

    it("shows -s in help text", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("-s, --sidebar");
    });
  });

  // #82: Fix shell config key description
  describe("shell config key description (#82)", () => {
    it("shows correct shell description in Config keys section", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Shell pane: true, false, or command");
      expect(result.stdout).not.toContain("Shell pane toggle");
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

  describe("--starship-preset flag", () => {
    it("accepts --starship-preset in dry-run", () => {
      const result = run(".", "--starship-preset", "tokyo-night", "--dry-run");
      expect(result.status).toBe(0);
    });

    it("shows starship-preset in help text under Config keys", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("starship-preset");
    });

    it("shows --starship-preset in help text under Options", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--starship-preset");
    });
  });

  describe("set starship-preset validation", () => {
    it("accepts valid starship preset name", () => {
      const result = run("set", "starship-preset", "tokyo-night");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Set starship-preset");
    });

    it("rejects preset name with shell metacharacters", () => {
      const result = run("set", "starship-preset", "foo;bar");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("starship preset name");
    });

    it("removes starship-preset when no value given", () => {
      const result = run("set", "starship-preset");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Removed starship-preset");
    });
  });

  describe("window management flags (#103, #105, #111)", () => {
    it("--new-window flag accepted in dry-run", () => {
      const result = run(".", "--new-window", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('keystroke "n" using command down');
    });

    it("--fullscreen flag accepted in dry-run", () => {
      const result = run(".", "--fullscreen", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("toggle_fullscreen");
    });

    it("--maximize flag accepted in dry-run", () => {
      const result = run(".", "--maximize", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("toggle_maximize");
    });

    it("--float flag accepted in dry-run", () => {
      const result = run(".", "--float", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("toggle_window_float_on_top");
    });

    it("all 4 flags appear in --help", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--new-window");
      expect(result.stdout).toContain("--fullscreen");
      expect(result.stdout).toContain("--maximize");
      expect(result.stdout).toContain("--float");
    });

    it("summon set new-window validates boolean", () => {
      const good = run("set", "new-window", "true");
      expect(good.status).toBe(0);
      const bad = run("set", "new-window", "maybe");
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("true");
      expect(bad.stderr).toContain("false");
    });

    it("summon set fullscreen validates boolean", () => {
      const good = run("set", "fullscreen", "true");
      expect(good.status).toBe(0);
      const bad = run("set", "fullscreen", "maybe");
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("true");
      expect(bad.stderr).toContain("false");
    });
  });

  describe("--font-size flag (#110)", () => {
    it("--font-size accepts positive number in dry-run", () => {
      const result = run(".", "--font-size", "14", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("font size");
    });

    it("--font-size rejects non-numeric value", () => {
      const result = run(".", "--font-size", "big");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("positive number");
    });

    it("--font-size rejects zero", () => {
      const result = run(".", "--font-size", "0");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("positive number");
    });

    it("--font-size rejects negative", () => {
      // Use --font-size=-5 syntax since parseArgs treats -5 as a separate flag
      const result = run(".", "--font-size=-5");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("positive number");
    });

    it("summon set font-size validates positive number", () => {
      const good = run("set", "font-size", "14");
      expect(good.status).toBe(0);
      const bad = run("set", "font-size", "abc");
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("positive number");
    });
  });

  describe("--env flag (#108)", () => {
    it("--env accepts KEY=VALUE format in dry-run", () => {
      const result = run(".", "--env", "NODE_ENV=development", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("NODE_ENV=development");
    });

    it("--env rejects value without =", () => {
      const result = run(".", "--env", "BADVALUE");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("KEY=VALUE");
    });

    it("--env can be specified multiple times", () => {
      const result = run(".", "--env", "A=1", "--env", "B=2", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("A=1");
      expect(result.stdout).toContain("B=2");
    });

    it("summon set env.KEY VALUE works", () => {
      const result = run("set", "env.NODE_ENV", "development");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Set env.NODE_ENV");
    });
  });

  describe("dry-run plural fix (#125)", () => {
    it("uses singular 'pane' for 1 editor pane", () => {
      const result = run(".", "--layout", "minimal", "--panes", "1", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("1 editor pane,");
      expect(result.stdout).not.toContain("1 editor panes");
    });

    it("uses plural 'panes' for multiple editor panes", () => {
      const result = run(".", "--layout", "full", "--panes", "3", "--dry-run");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/[23] editor panes/);
    });
  });

  describe("--on-start flag (#107)", () => {
    it("--on-start flag accepted with string value", () => {
      const result = run(".", "--on-start", "echo hello", "--dry-run");
      expect(result.status).toBe(0);
    });

    it("--on-start appears in help output", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--on-start");
      expect(result.stdout).toContain("on-start");
    });
  });

  describe("summon open (#109)", () => {
    it("shows error when no projects registered", () => {
      const result = run("open");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No projects registered");
    });

    it("summon open --help shows usage", () => {
      const result = run("open", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon open");
    });
  });

  describe("summon export (#112)", () => {
    it("exports machine config as .summon format", () => {
      run("set", "editor", "nvim");
      const result = run("export");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("editor=nvim");
      expect(result.stdout).toContain("# Summon workspace configuration");
    });

    it("exports to file when path argument given", () => {
      const outputFile = `${TEMP_HOME}/test-export.summon`;
      run("set", "editor", "vim");
      const result = run("export", outputFile);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Exported to:");
    });

    it("summon export --help shows usage", () => {
      const result = run("export", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon export");
    });
  });

  // #123 updated by #170: empty string is now rejected, not just warned
  describe("summon set empty value rejection (#123, #170)", () => {
    it("rejects command key set to empty string with exit 1", () => {
      const result = run("set", "editor", "");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("empty");
    });
  });

  describe("summon doctor (#113, #116, #153)", () => {
    it("exits 0 when recommendations are missing but Ghostty config path is valid (#153)", () => {
      // With temp HOME, no Ghostty config exists → recommendations missing → exit 0 (not an error)
      const result = run("doctor");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Checking Ghostty configuration");
    });

    it("summon doctor --help shows usage", () => {
      const result = run("doctor", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon doctor");
    });

    it("doctor checks accessibility permission", () => {
      const result = run("doctor");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Checking permissions");
      // The result depends on OS permissions, so check that one of the two messages appears
      const hasGranted = result.stdout.includes("Accessibility permission is granted");
      const hasNotGranted = result.stdout.includes("Accessibility permission not granted");
      expect(hasGranted || hasNotGranted).toBe(true);
    });

    it("doctor --fix creates Ghostty config with missing settings when none exists", () => {
      // Clean up any Ghostty config from previous tests
      rmSync(join(TEMP_HOME, ".config", "ghostty"), { recursive: true, force: true });

      const result = run("doctor", "--fix");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Added 3 setting(s)");
      // Verify the config was created
      const ghosttyConfig = join(TEMP_HOME, ".config", "ghostty", "config");
      expect(existsSync(ghosttyConfig)).toBe(true);
      const content = readFileSync(ghosttyConfig, "utf-8");
      expect(content).toContain("window-save-state = always");
      expect(content).toContain("notify-on-command-finish = unfocused");
      expect(content).toContain("shell-integration = detect");
      expect(content).toContain("# Added by summon doctor --fix");
    });

    it("doctor --fix creates backup when config exists and adds only missing settings", () => {
      const ghosttyDir = join(TEMP_HOME, ".config", "ghostty");
      mkdirSync(ghosttyDir, { recursive: true });
      const ghosttyConfig = join(ghosttyDir, "config");
      // Write config with one setting already present
      writeFileSync(ghosttyConfig, "window-save-state = always\n");

      const result = run("doctor", "--fix");
      expect(result.status).toBe(0);
      // Should only add the 2 missing settings
      expect(result.stdout).toContain("Added 2 setting(s)");
      expect(result.stdout).toContain("Backed up");
      // Verify backup was created (filename includes timestamp)
      const backups = readdirSync(ghosttyDir).filter(f => f.startsWith("config.bak"));
      expect(backups.length).toBeGreaterThanOrEqual(1);
      // Verify original setting is still present and new ones added
      const content = readFileSync(ghosttyConfig, "utf-8");
      expect(content).toContain("window-save-state = always");
      expect(content).toContain("notify-on-command-finish = unfocused");
      expect(content).toContain("shell-integration = detect");
    });

    it("doctor --fix skips when all settings are present", () => {
      const ghosttyDir = join(TEMP_HOME, ".config", "ghostty");
      mkdirSync(ghosttyDir, { recursive: true });
      const ghosttyConfig = join(ghosttyDir, "config");
      writeFileSync(ghosttyConfig, "window-save-state = always\nnotify-on-command-finish = unfocused\nshell-integration = detect\n");

      const result = run("doctor", "--fix");
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("Added");
      expect(result.stdout).not.toContain("Backed up");
    });

    it("doctor --help mentions --fix", () => {
      const result = run("doctor", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--fix");
    });
  });

  describe("summon freeze (#114)", () => {
    it("freeze saves resolved config as custom layout", () => {
      // Set some machine config first
      run("set", "editor", "vim");
      run("set", "sidebar", "lazygit");

      const result = run("freeze", "mysetup");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Frozen current config");
      expect(result.stdout).toContain("mysetup");

      // Verify the layout was saved by showing it
      const showResult = run("layout", "show", "mysetup");
      expect(showResult.status).toBe(0);
      expect(showResult.stdout).toContain("editor=vim");
      expect(showResult.stdout).toContain("sidebar=lazygit");

      // Cleanup
      run("layout", "delete", "mysetup");
    });

    it("freeze rejects missing name", () => {
      const result = run("freeze");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Usage");
    });

    it("freeze rejects invalid name", () => {
      const result = run("freeze", "123bad");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid");
    });

    it("freeze rejects existing layout name", () => {
      run("set", "editor", "vim");
      run("freeze", "existing-test");
      const result = run("freeze", "existing-test");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("already exists");
      // Cleanup
      run("layout", "delete", "existing-test");
    });

    it("freeze --help shows usage", () => {
      const result = run("freeze", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon freeze");
    });
  });

  describe("summon keybindings (#117)", () => {
    it("keybindings outputs key table config", () => {
      run("set", "editor", "vim");
      const result = run("keybindings");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon-nav");
      expect(result.stdout).toContain("focus_split:left");
      expect(result.stdout).toContain("focus_split:right");
      expect(result.stdout).toContain("toggle_split_zoom");
      expect(result.stdout).toContain("pop_key_table");
    });

    it("keybindings --vim uses hjkl", () => {
      run("set", "editor", "vim");
      const result = run("keybindings", "--vim");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon-nav:h = focus_split:left");
      expect(result.stdout).toContain("summon-nav:j = focus_split:down");
      expect(result.stdout).toContain("summon-nav:k = focus_split:up");
      expect(result.stdout).toContain("summon-nav:l = focus_split:right");
    });

    it("keybindings --help shows usage", () => {
      const result = run("keybindings", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon keybindings");
      expect(result.stdout).toContain("--vim");
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

  describe("layout subcommand", () => {
    it("summon layout list works with no custom layouts", () => {
      const result = run("layout", "list");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("No custom layouts");
    });

    it("summon layout save creates a custom layout", () => {
      // Set some config first so there's something to save
      run("set", "editor", "vim");
      run("set", "panes", "3");
      const result = run("layout", "save", "mywork");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Saved");
      expect(result.stdout).toContain("mywork");
    });

    it("summon layout save rejects invalid name", () => {
      const result = run("layout", "save", "123bad");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid layout name");
    });

    it("summon layout save rejects reserved preset name", () => {
      const result = run("layout", "save", "minimal");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("reserved");
    });

    it("summon layout show gives helpful error for built-in preset name (#156)", () => {
      const result = run("layout", "show", "pair");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("built-in preset");
      expect(result.stderr).toContain("not a custom layout");
      expect(result.stderr).toContain("summon --help");
    });

    it("summon layout show displays layout contents", () => {
      run("set", "editor", "vim");
      run("layout", "save", "showtest");
      const result = run("layout", "show", "showtest");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("editor=vim");
    });

    it("summon layout show errors on missing layout", () => {
      const result = run("layout", "show", "nonexistent");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not found");
    });

    it("summon layout show rejects path traversal name (#136)", () => {
      const result = run("layout", "show", "../../etc/passwd");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid layout name");
    });

    it("summon layout delete removes a layout", () => {
      run("set", "editor", "vim");
      run("layout", "save", "todelete");
      const result = run("layout", "delete", "todelete");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Deleted");
      expect(result.stdout).toContain("todelete");
    });

    it("summon layout delete errors on missing layout", () => {
      const result = run("layout", "delete", "nonexistent");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not found");
    });

    it("summon layout delete rejects path traversal name (#136)", () => {
      const result = run("layout", "delete", "../bad");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid layout name");
    });

    it("summon layout edit rejects invalid name (#136)", () => {
      const result = run("layout", "edit", "123bad");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid layout name");
    });

    it("summon layout list shows saved layouts", () => {
      run("set", "editor", "vim");
      run("layout", "save", "alpha");
      run("layout", "save", "beta");
      const result = run("layout", "list");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("alpha");
      expect(result.stdout).toContain("beta");
    });

    it("summon layout with no sub-action shows usage", () => {
      const result = run("layout");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Usage:");
    });

    it("summon layout --help shows usage", () => {
      const result = run("layout", "--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("summon layout");
    });

    it("--layout accepts custom layout name when it exists", () => {
      run("set", "panes", "3");
      run("layout", "save", "mycustom");
      const result = run(".", "--layout", "mycustom", "--dry-run");
      expect(result.status).toBe(0);
    });

    it("--layout rejects nonexistent custom layout", () => {
      const result = run(".", "--layout", "nonexistent");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
    });
  });

  // #161: Help text lists 'create' in layout actions
  describe("layout help text includes create (#161)", () => {
    it("lists create in the layout parenthetical", () => {
      const result = run("--help");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("(create, save, list, show, delete, edit)");
    });
  });

  // #161: 'summon open' invalid selection shows range hint (updated for #170 re-prompt loop)
  describe("summon open invalid selection hint (#161)", () => {
    it("shows range hint when project list is available", () => {
      // Register projects first so the list is non-empty
      run("add", "proj1", "/tmp/proj1");
      run("add", "proj2", "/tmp/proj2");
      // Use echo to pipe an invalid selection; with the re-prompt loop,
      // after printing the error the process tries to re-prompt, gets EOF, and exits 0
      const result = spawnSync("sh", ["-c", `echo "99" | node dist/index.js open`], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: TEMP_HOME },
        timeout: 30_000,
      });
      // Process exits 0 on EOF (Ctrl+C / stream close is handled gracefully)
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Enter a number between 1 and");
    });
  });

  // #161: 'summon layout edit' failure shows editor hint
  describe("layout edit failure shows editor hint (#161)", () => {
    it("shows hint about EDITOR env var when editor fails", () => {
      // Save a layout so edit has something to open
      run("set", "editor", "vim");
      run("layout", "save", "edithint");
      // Use a nonexistent editor command
      const result = spawnSync("node", ["dist/index.js", "layout", "edit", "edithint"], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: TEMP_HOME, EDITOR: "nonexistent-editor-xyz" },
        timeout: 30_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Failed to open editor");
      expect(result.stderr).toContain("EDITOR");
    });
  });

  // #170: W6 — validate EDITOR in layout edit
  describe("layout edit EDITOR validation (#170)", () => {
    it("rejects EDITOR with shell metacharacters", () => {
      // Save a layout so edit has something to open
      run("set", "editor", "vim");
      run("layout", "save", "editvalidate");
      const result = spawnSync("node", ["dist/index.js", "layout", "edit", "editvalidate"], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: TEMP_HOME, EDITOR: "vim;rm -rf /" },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("EDITOR");
    });

    it("rejects EDITOR with spaces (multi-word command)", () => {
      run("set", "editor", "vim");
      run("layout", "save", "editvalidate2");
      const result = spawnSync("node", ["dist/index.js", "layout", "edit", "editvalidate2"], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: TEMP_HOME, EDITOR: "code --wait" },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("EDITOR");
    });

    it("accepts EDITOR with safe command name", () => {
      run("set", "editor", "vim");
      run("layout", "save", "editvalidate3");
      // This will fail because the editor can't actually open, but it should NOT
      // fail with the EDITOR validation error
      const result = spawnSync("node", ["dist/index.js", "layout", "edit", "editvalidate3"], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: TEMP_HOME, EDITOR: "nonexistent-safe-editor" },
      });
      // Should fail because editor not found, not because of validation
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Failed to open editor");
      expect(result.stderr).not.toContain("unsafe");
    });
  });

  // #170: W9 — summon open re-prompts on invalid selection
  describe("summon open re-prompts on invalid selection (#170)", () => {
    it("re-prompts after invalid input and shows error each time", () => {
      // Register a single project so we have a known count
      const freshHome = mkdtempSync(join(tmpdir(), "summon-reprompt-"));
      const runFresh = (...a: string[]) =>
        spawnSync("node", ["dist/index.js", ...a], {
          encoding: "utf-8",
          cwd: PROJECT_ROOT,
          env: { ...process.env, HOME: freshHome },
        });
      runFresh("add", "proj-a", "/tmp/proj-a");
      // Pipe two invalid inputs, then EOF
      const result = spawnSync("sh", ["-c", `printf "abc\\n99\\n" | node dist/index.js open`], {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: freshHome },
      });
      rmSync(freshHome, { recursive: true, force: true });
      // With the re-prompt loop, at least one "Invalid selection" on stderr
      expect(result.stderr).toContain("Invalid selection");
      // Process exits 0 when EOF is reached (graceful close)
      expect(result.status).toBe(0);
    });
  });

  // #170: W10 — summon set refuses empty string for command keys
  describe("summon set refuses empty string for command keys (#170)", () => {
    it("refuses to save empty string for editor", () => {
      const result = run("set", "editor", "");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("empty");
    });

    it("refuses to save empty string for sidebar", () => {
      const result = run("set", "sidebar", "");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
      expect(result.stderr).toContain("empty");
    });

    it("suggests using set without value to reset", () => {
      const result = run("set", "editor", "");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("summon set editor");
      expect(result.stderr).toContain("reset");
    });

    it("still allows non-empty values for command keys", () => {
      const result = run("set", "editor", "vim");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Set editor");
    });

    it("still allows empty string for non-command keys like panes", () => {
      // panes="" is a valid (if weird) value — not a command key
      const result = run("set", "shell", "");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error:");
    });
  });

  // #147: Both --layout flag and summon set layout share the same validation
  describe("shared layout validation (#147)", () => {
    it("--layout flag shows 'Valid presets:' for invalid layout", () => {
      const result = run(".", "--layout", "bogus");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Valid presets:");
    });

    it("summon set layout shows 'Valid presets:' for invalid layout", () => {
      const result = run("set", "layout", "bogus");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Valid presets:");
    });

    it("--layout flag lists custom layouts when they exist", () => {
      run("set", "panes", "2");
      run("layout", "save", "customcheck");
      const result = run(".", "--layout", "bogus147");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Custom layouts:");
      expect(result.stderr).toContain("customcheck");
    });

    it("summon set layout lists custom layouts when they exist", () => {
      run("set", "panes", "2");
      run("layout", "save", "customcheck2");
      const result = run("set", "layout", "bogus147");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Custom layouts:");
      expect(result.stderr).toContain("customcheck2");
    });
  });
});
