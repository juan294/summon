import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

const TEST_STATUS_DIR = join(tmpdir(), `summon-launch-identity-${process.pid}`);

vi.mock("./paths.js", () => ({
  STATUS_DIR: TEST_STATUS_DIR,
  CONFIG_DIR: join(tmpdir(), `summon-config-${process.pid}`),
}));

const {
  LAUNCH_ID_RE,
  newLaunchId,
  isLaunchId,
  launchArtifactPaths,
  launchArtifactFiles,
  launchFileList,
  launchesDir,
  bootstrapLine,
  paneFileLine,
  cleanupTrapLine,
  clearSelfInvocation,
  registerSelfInvocation,
  parseLaunchManifest,
  writeLaunchManifest,
  readLaunchManifest,
  listLaunchManifests,
} = await import("./launch-identity.js");
import type { LaunchManifest } from "./launch-identity.js";

const ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const OTHER = "1a1a1a1a-1a1a-4a1a-9a1a-1a1a1a1a1a1a";

beforeEach(() => rmSync(TEST_STATUS_DIR, { recursive: true, force: true }));
afterEach(() => rmSync(TEST_STATUS_DIR, { recursive: true, force: true }));

describe("launch ids", () => {
  it("newLaunchId produces a UUID v4 that matches LAUNCH_ID_RE", () => {
    const id = newLaunchId();
    expect(id).toMatch(LAUNCH_ID_RE);
    expect(isLaunchId(id)).toBe(true);
    expect(newLaunchId()).not.toBe(id);
  });

  it("isLaunchId rejects uppercase, other versions and non-strings", () => {
    expect(isLaunchId(ID.toUpperCase())).toBe(false);
    expect(isLaunchId("0f0f0f0f-0f0f-1f0f-8f0f-0f0f0f0f0f0f")).toBe(false);
    expect(isLaunchId(42)).toBe(false);
  });
});

describe("launchArtifactPaths", () => {
  it("places every artifact under STATUS_DIR/<project>.launches", () => {
    const paths = launchArtifactPaths("chapa", ID);
    const dir = join(TEST_STATUS_DIR, "chapa.launches");
    expect(paths.dir).toBe(dir);
    expect(paths.manifest).toBe(join(dir, `${ID}.json`));
    expect(paths.pid).toBe(join(dir, `${ID}.pid`));
    expect(paths.active).toBe(join(dir, `${ID}.active`));
    expect(paths.pane("editor")).toEqual({ file: join(dir, `${ID}.pane.editor`), tmp: join(dir, `${ID}.pane.editor.tmp`) });
  });

  it("confines the project and pane names to STATUS_DIR", () => {
    expect(() => launchArtifactPaths("../../etc/evil", ID)).toThrow("Invalid status path");
    expect(() => launchesDir(`..${sep}x`)).toThrow("Invalid status path");
    expect(() => launchArtifactPaths("chapa", ID).pane("x/../../y")).toThrow("Invalid pane path");
  });

  it("rejects an invalid launch id", () => {
    expect(() => launchArtifactPaths("chapa", "not-a-uuid")).toThrow('Invalid launch id: "not-a-uuid"');
  });
});

describe("shell fragments", () => {
  const dir = `$HOME/.config/summon/status/chapa.launches`;

  it("bootstrapLine creates the launch dir and writes pid then active, every path carrying the launch id", () => {
    const line = bootstrapLine("chapa", ID);
    expect(line).toBe(
      `mkdir -p "${dir}" && chmod 700 "${dir}"`
      + ` && printf '%s\\n' "$$" > "${dir}/${ID}.pid"`
      + ` && printf '%s\\n' '${ID}' > "${dir}/${ID}.active"`,
    );
    const paths = line.match(/"\$HOME[^"]*"/g) ?? [];
    expect(paths.length).toBe(4);
    for (const p of paths.slice(2)) expect(p).toContain(ID);
  });

  it("paneFileLine names only that pane's file and its .tmp and publishes atomically", () => {
    const line = paneFileLine("chapa", ID, "sidebar");
    expect(line).toBe(
      `printf '%s\\n%s\\n' "$REX_SESSION" "$REX_BLOCK" > "${dir}/${ID}.pane.sidebar.tmp"`
      + ` && mv -f "${dir}/${ID}.pane.sidebar.tmp" "${dir}/${ID}.pane.sidebar"`,
    );
    expect(line).not.toContain("pane.editor");
    expect(line).not.toContain(".pid");
    expect(line).not.toContain(".active");
  });

  it("routes names through shellDoubleQuote", () => {
    expect(bootstrapLine('my"proj', ID)).toContain('my\\"proj.launches');
    expect(paneFileLine('my"proj', ID, "editor")).toContain(`my\\"proj.launches/${ID}.pane.editor`);
  });

  it("cleanupTrapLine removes only its own pid and active files and passes --launch to snapshot save", () => {
    const line = cleanupTrapLine("chapa", ID, { onStop: "echo bye", targetDir: "/tmp/chapa", layout: "full" });
    expect(line.startsWith("__summon_cleanup() { ")).toBe(true);
    expect(line.endsWith("; }; trap '__summon_cleanup' EXIT HUP")).toBe(true);
    expect(line).toContain(`echo bye </dev/null >> "$HOME/.config/summon/logs/cleanup-chapa.log" 2>&1`);
    expect(line).toContain(`summon snapshot save --dir '/tmp/chapa' --project "chapa" --layout "full" --launch '${ID}' </dev/null >/dev/null 2>&1`);
    expect(line).toContain(`rm -f "${dir}/${ID}.pid" "${dir}/${ID}.active" 2>/dev/null`);
    // Never named: pane files, manifest, shared record, legacy paths.
    expect(line).not.toContain(".pane.");
    expect(line).not.toContain(`${ID}.json`);
    expect(line).not.toContain("chapa.json");
    expect(line).not.toContain("status/chapa.active");
    expect(line).not.toContain("status/chapa.pid");
    expect(line.indexOf("rm -f")).toBeLessThan(line.indexOf("echo bye"));
    expect(line.indexOf("echo bye")).toBeLessThan(line.indexOf("snapshot save"));
  });

  it("cleanupTrapLine detaches the snapshot save and the on-stop hook from the terminal", () => {
    // The trap runs after `rex kill` or a window close, when the pane's pty is already hung up. Node aborts at
    // startup (PlatformInit saves the tty modes of fds 0-2; tcgetattr fails with EIO) when any standard
    // descriptor is such a pty, so the programs the trap starts must not inherit them (guide §4 F9).
    const line = cleanupTrapLine("chapa", ID, { onStop: "echo bye", targetDir: "/tmp/chapa", layout: "full" });
    const parts = line.slice(line.indexOf("{ ") + 2, line.lastIndexOf("; }")).split("; ");
    const snapshotPart = parts.find((part) => part.includes("snapshot save"))!;
    expect(snapshotPart.endsWith(" </dev/null >/dev/null 2>&1")).toBe(true);
    const onStopPart = parts.find((part) => part.startsWith("echo bye"))!;
    expect(onStopPart).toBe(`echo bye </dev/null >> "$HOME/.config/summon/logs/cleanup-chapa.log" 2>&1`);
  });

  it("cleanupTrapLine removes the liveness files before the slower hook and snapshot (F21)", () => {
    // A terminal kills the pane's processes shortly after the hangup. Removing the pid and active
    // files first keeps liveness right even when the trap is cut short; the snapshot follows.
    const line = cleanupTrapLine("chapa", ID, { onStop: "echo bye", targetDir: "/tmp/chapa", layout: "full" });
    const parts = line.slice(line.indexOf("{ ") + 2, line.lastIndexOf("; }")).split("; ");
    const rmIndex = parts.findIndex((part) => part.startsWith("rm -f "));
    expect(rmIndex).toBeGreaterThanOrEqual(0);
    expect(rmIndex).toBeLessThan(parts.findIndex((part) => part.startsWith("echo bye")));
    expect(rmIndex).toBeLessThan(parts.findIndex((part) => part.includes("snapshot save")));
  });

  it("cleanupTrapLine omits on-stop and snapshot parts when not configured", () => {
    const line = cleanupTrapLine("chapa", ID);
    expect(line).not.toContain("snapshot save");
    expect(line).not.toContain("cleanup-chapa.log");
    expect(line).toContain(`rm -f "${dir}/${ID}.pid"`);
  });

  it("paneFileLine rejects a pane name that is not an identifier (no paths, no traversal)", () => {
    for (const bad of ["../x", "a/b", "a b", "", "1abc"]) {
      expect(() => paneFileLine("chapa", ID, bad)).toThrow(`Invalid pane name: ${JSON.stringify(bad)}`);
    }
  });

  it("every fragment rejects an invalid launch id (ids are never user text)", () => {
    expect(() => bootstrapLine("chapa", "x")).toThrow("Invalid launch id");
    expect(() => paneFileLine("chapa", "x", "editor")).toThrow("Invalid launch id");
    expect(() => cleanupTrapLine("chapa", "x")).toThrow("Invalid launch id");
  });
});

function manifest(overrides: Partial<LaunchManifest> = {}): LaunchManifest {
  return {
    version: 1,
    launchId: ID,
    project: "chapa",
    directory: "/tmp/chapa",
    layout: "default",
    panes: ["editor", "sidebar"],
    paneOrder: ["editor", "sidebar"],
    blockLabels: { editor: "editor · nvim", sidebar: "sidebar · lazygit" },
    backend: "rex",
    server: "unix:///tmp/rex.sock",
    startedAt: "2026-10-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("launchArtifactFiles", () => {
  it("groups the liveness sidecars, the pane files and the manifest, and lists them as one", () => {
    const paths = launchArtifactPaths("chapa", ID);
    const files = launchArtifactFiles("chapa", ID, ["editor", "shell"]);
    expect(files).toEqual({ liveness: [paths.pid, paths.active], panes: [paths.pane("editor").tmp, paths.pane("shell").file, paths.pane("shell").tmp], manifest: paths.manifest, token: paths.pane("editor").file });
    expect(launchFileList(files)).toEqual([...files.liveness, ...files.panes, paths.manifest, paths.pane("editor").file]);
    expect(launchFileList({ liveness: files.liveness, panes: [] })).toEqual(files.liveness);
  });
});

describe("launch manifests", () => {
  it("round-trips through write and read", () => {
    writeLaunchManifest(manifest());
    expect(readLaunchManifest("chapa", ID)).toEqual(manifest());
    expect(existsSync(join(TEST_STATUS_DIR, "chapa.launches", `${ID}.json`))).toBe(true);
    expect(readFileSync(launchArtifactPaths("chapa", ID).manifest, "utf-8").endsWith("\n")).toBe(true);
  });

  it("returns null for a missing, malformed or mismatching manifest", () => {
    expect(readLaunchManifest("chapa", ID)).toBeNull();
    mkdirSync(join(TEST_STATUS_DIR, "chapa.launches"), { recursive: true });
    writeFileSync(join(TEST_STATUS_DIR, "chapa.launches", `${ID}.json`), "{not json");
    expect(readLaunchManifest("chapa", ID)).toBeNull();
    writeFileSync(join(TEST_STATUS_DIR, "chapa.launches", `${ID}.json`), JSON.stringify(manifest({ launchId: OTHER })));
    expect(readLaunchManifest("chapa", ID)).toBeNull();
  });

  it.each([
    ["version", { version: 2 }],
    ["launchId", { launchId: "nope" }],
    ["project", { project: 1 }],
    ["panes", { panes: ["a", 2] }],
    ["paneOrder", { paneOrder: "a" }],
    // BE-L3: a pane name is an identifier, never a path: `x/../<id>` would name a sibling launch's file.
    ["panes path", { panes: ["editor", `x/../${OTHER}`] }],
    ["paneOrder path", { paneOrder: ["editor", `x/../${OTHER}`] }],
    ["paneOrder empty name", { paneOrder: [""] }],
    ["blockLabels array", { blockLabels: ["a"] }],
    ["blockLabels value", { blockLabels: { a: 1 } }],
    ["backend", { backend: "zsh" }],
    ["server", { server: 5 }],
    ["startedAt", { startedAt: "yesterday" }],
  ])("parseLaunchManifest rejects an invalid %s", (_label, patch) => {
    expect(parseLaunchManifest({ ...manifest(), ...patch })).toBeNull();
  });

  it("parseLaunchManifest keeps the launch ids of keeps (F12) and drops a malformed list, never the manifest", () => {
    const other = "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f";
    expect(parseLaunchManifest({ ...manifest(), keeps: [other, "not-an-id", 7] })).toEqual(manifest());
    expect(parseLaunchManifest({ ...manifest(), keeps: [other, "not-an-id"] })).toEqual({ ...manifest(), keeps: [other] });
    expect(parseLaunchManifest({ ...manifest(), keeps: "nope" })).toEqual(manifest());
  });

  it("parseLaunchManifest accepts a manifest without server and drops unknown keys", () => {
    const { server: _server, ...withoutServer } = manifest();
    expect(parseLaunchManifest({ ...withoutServer, extra: true })).toEqual(withoutServer);
    expect(parseLaunchManifest(null)).toBeNull();
  });

  it("listLaunchManifests returns valid manifests oldest first and ignores other files", () => {
    expect(listLaunchManifests("chapa")).toEqual([]);
    writeLaunchManifest(manifest({ launchId: OTHER, startedAt: "2026-10-29T11:00:00.000Z" }));
    writeLaunchManifest(manifest());
    const dir = join(TEST_STATUS_DIR, "chapa.launches");
    writeFileSync(join(dir, `${ID}.pid`), "123\n");
    writeFileSync(join(dir, "stray.json"), "{}");
    writeFileSync(join(dir, "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b.json"), "{broken");
    expect(listLaunchManifests("chapa").map((m) => m.launchId)).toEqual([ID, OTHER]);
  });
});

describe("the trap runs the binary that created the launch (guide F4)", () => {
  afterEach(() => clearSelfInvocation());

  it("types the registered node and script paths, single-quoted, instead of a bare summon", () => {
    registerSelfInvocation("/usr/local/bin/node", "/opt/my 'tools'/summon/dist/index.js");
    const line = cleanupTrapLine("chapa", ID, { targetDir: "/tmp/chapa", layout: "full" });
    expect(line).toContain(`'/usr/local/bin/node' '/opt/my '\\''tools'\\''/summon/dist/index.js' snapshot save --dir '/tmp/chapa' --project "chapa" --layout "full" --launch '${ID}' </dev/null >/dev/null 2>&1`);
    expect(line).not.toMatch(/[;{] *summon snapshot/);
  });

  it("falls back to summon on PATH when no invocation is registered (library use, tests)", () => {
    const line = cleanupTrapLine("chapa", ID, { targetDir: "/tmp/chapa" });
    expect(line).toContain(`; summon snapshot save --dir '/tmp/chapa'`);
  });

  it("single-quotes paths so history expansion (!) and $ never apply in the interactive login shell (SE-L1)", () => {
    registerSelfInvocation("/opt/node!22/bin/node", "/opt/$HOME/summon!/index.js");
    const line = cleanupTrapLine("chapa", ID, { targetDir: "/tmp/wow!$x`y`" });
    expect(line).toContain(`'/opt/node!22/bin/node' '/opt/$HOME/summon!/index.js' snapshot save --dir '/tmp/wow!$x\`y\`' --project`);
  });

  it.each([
    ["the project directory", "/tmp/a\u001b[201~b", undefined],
    ["the project directory (newline)", "/tmp/a\nb", undefined],
    ["the node binary", "/tmp/chapa", "/usr/local/bin/no\u0007de"],
    ["the node binary (C1)", "/tmp/chapa", "/usr/local/bin/no\u009bde"],
  ])("rejects a control character in %s with a clear error (SE-L1)", (_label, targetDir, execPath) => {
    if (execPath) registerSelfInvocation(execPath, "/opt/summon/dist/index.js");
    expect(() => cleanupTrapLine("chapa", ID, { targetDir })).toThrow(/contains a control character/);
  });

  it("ignores a registration without a script path", () => {
    registerSelfInvocation("/usr/local/bin/node", undefined);
    expect(cleanupTrapLine("chapa", ID, { targetDir: "/tmp/chapa" })).toContain("; summon snapshot save");
  });
});
