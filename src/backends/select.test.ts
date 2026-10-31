import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTerminalBackend } from "./select.js";
import { GhosttyBackend } from "./ghostty.js";
import { allWorkspaceBackends, workspaceBackendFor } from "./workspace.js";
import type { LaunchContext } from "../backend.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REX_CONTEXT: LaunchContext = { ok: true, backend: "rex", placement: "outside", server: "unix:///tmp/rex.sock", rexBinary: "/usr/local/bin/rex", notices: [] };

/** Runtime (non-type) relative imports, followed transitively from `entry`; paths relative to src/. */
function staticImportClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["'](\.[^"']+)["']/gm;
  const visit = (file: string): void => {
    const key = relative(SRC, file);
    if (seen.has(key)) return;
    seen.add(key);
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) visit(resolve(dirname(file), match[1]!.replace(/\.js$/, ".ts")));
  };
  visit(join(SRC, entry));
  return seen;
}

describe("backend ports (AR-M1)", () => {
  it("maps a launch context to its terminal backend, with the traits the generic launch reads", () => {
    expect(createTerminalBackend({ ok: true, backend: "ghostty", placement: "outside", notices: [] })).toBe(GhosttyBackend);
    expect(GhosttyBackend).toMatchObject({ id: "ghostty", splitsCallerWindow: true, opensSessionTabs: true });
    expect(GhosttyBackend.beforeLaunch).toBeUndefined();
    const rex = createTerminalBackend(REX_CONTEXT);
    expect(rex).toMatchObject({ id: "rex", splitsCallerWindow: false, opensSessionTabs: false });
    for (const hook of ["beforeLaunch", "watchOutput", "afterSuccess", "showAgain"] as const) expect(typeof rex[hook]).toBe("function");
  });

  it("maps a stored backend field to its record backend; a record without the field is Ghostty", () => {
    expect(workspaceBackendFor(undefined).id).toBe("ghostty");
    expect(workspaceBackendFor("ghostty").id).toBe("ghostty");
    expect(workspaceBackendFor("rex").id).toBe("rex");
    // `clean --orphans` reviews Ghostty launches before Rex launches, as it did before the port.
    expect(allWorkspaceBackends().map((b) => b.id)).toEqual(["ghostty", "rex"]);
  });

  it("a launch loads no record-side module statically, and no Rex module beyond those it loaded before the port", () => {
    const closure = staticImportClosure("launcher.ts");
    for (const recordSide of ["status.ts", "backends/workspace.ts", "backends/ghostty-workspace.ts", "backends/rex/workspace.ts", "backends/rex/read.ts", "backends/rex/reconcile.ts", "backends/rex/doctor.ts"]) {
      expect(closure.has(recordSide), recordSide).toBe(false);
    }
    // The Rex modules a launch loaded statically before AR-M1 (PE-L2 may make this list shorter, never longer).
    const before = ["app", "backend", "cli", "errors", "launch", "launcher-tab", "layout", "status", "types"].map((name) => `backends/rex/${name}.ts`);
    expect([...closure].filter((file) => file.startsWith("backends/rex/")).every((file) => before.includes(file))).toBe(true);
  });

  it("generic modules reach Rex only through the ports, with the listed exceptions", () => {
    const allowed: Record<string, string[]> = {
      // Detection itself: the `rex` lookup and the whoami probe of an inherited REX_SERVER.
      "backend.ts": ["backends/rex/cli.js"],
      // Record parsing: the stored Rex identity is validated where the record is read.
      "status-record.ts": ["backends/rex/types.js"],
      // The monitor's child read is seeded with the rex binary its parent resolved (PE-H1).
      "status.ts": ["backends/rex/read.js"],
      // The Rex section of `summon doctor`.
      "commands/doctor.ts": ["backends/rex/doctor.js"],
    };
    const generic = ["launcher.ts", "dry-run.ts", "status.ts", "status-record.ts", "workspace-focus.ts", "command-install.ts", "monitor.ts", "backend.ts", "launch-identity.ts",
      "commands/workspace.ts", "commands/doctor.ts", "commands/clean.ts", "commands/project.ts", "commands/session.ts"];
    const runtimeRex = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["'](?:\.\.?\/)+(backends\/rex\/[^"']+)["']|import\(["'](?:\.\.?\/)+(backends\/rex\/[^"']+)["']\)/gm;
    for (const file of generic) {
      const found = [...readFileSync(join(SRC, file), "utf8").matchAll(runtimeRex)].map((m) => (m[1] ?? m[2])!);
      expect(found, file).toEqual(allowed[file] ?? []);
    }
  });
});
