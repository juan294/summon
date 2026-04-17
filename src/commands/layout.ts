import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  LAYOUTS_DIR,
  deleteCustomLayout,
  listConfig,
  listCustomLayouts,
  readCustomLayout,
  saveCustomLayout,
} from "../config.js";
import { isPresetName } from "../layout.js";
import { SAFE_COMMAND_RE, exitWithUsageHint } from "../utils.js";
import { parseTreeDSL } from "../tree.js";
import { renderLayoutPreview } from "../ui/layout-preview.js";
import type { CommandContext } from "./types.js";
import {
  layoutNotFoundOrExit,
  treeToGrid,
  validateLayoutNameOrExit,
} from "./layout-support.js";

export async function handleLayoutCommand({ args }: CommandContext): Promise<void> {
  const [action, layoutName] = args;
  if (!action) {
    exitWithUsageHint("Usage: summon layout <create|save|list|show|delete|edit> [name]");
  }

  switch (action) {
    case "create": {
      if (!layoutName) {
        exitWithUsageHint("Usage: summon layout create <name>");
      }
      validateLayoutNameOrExit(layoutName);
      const { runLayoutBuilder } = await import("../setup.js");
      await runLayoutBuilder(layoutName);
      return;
    }

    case "save": {
      if (!layoutName) {
        exitWithUsageHint("Usage: summon layout save <name>");
      }
      validateLayoutNameOrExit(layoutName);
      const config = listConfig();
      if (config.size === 0) {
        console.warn("Warning: saving layout with empty config. Set values first with: summon set <key> <value>");
      }
      saveCustomLayout(layoutName, config);
      console.log(`Saved custom layout: ${layoutName}`);
      return;
    }

    case "list": {
      const layouts = listCustomLayouts();
      if (layouts.length === 0) {
        console.log("No custom layouts saved. Use: summon layout save <name>");
        return;
      }

      console.log(`Custom layouts (${layouts.length}):\n`);
      for (const [index, name] of layouts.entries()) {
        const data = readCustomLayout(name);
        if (!data) {
          console.log(`  \x1b[1m${name}\x1b[0m`);
        } else {
          const paneMap = new Map<string, string>();
          let tree = "";
          const other: string[] = [];
          for (const [key, value] of data) {
            if (key === "tree") {
              tree = value;
            } else if (key.startsWith("pane.") && !key.endsWith(".cwd")) {
              paneMap.set(key.slice(5), value);
            } else {
              other.push(`${key}=${value}`);
            }
          }

          console.log(`  \x1b[1m${name}\x1b[0m`);
          if (tree && paneMap.size > 0) {
            try {
              const node = parseTreeDSL(tree);
              const grid = treeToGrid(node, paneMap);
              const preview = renderLayoutPreview(grid);
              for (const line of preview.split("\n")) {
                console.log(`    ${line}`);
              }
            } catch {
              const paneList = [...paneMap.entries()].map(([key, value]) => `${key}=\x1b[36m${value}\x1b[0m`);
              console.log(`    Panes:  ${paneList.join("  ")}`);
              console.log(`    Tree:   ${tree}`);
            }
          } else if (paneMap.size > 0) {
            const paneList = [...paneMap.entries()].map(([key, value]) => `${key}=\x1b[36m${value}\x1b[0m`);
            console.log(`    Panes:  ${paneList.join("  ")}`);
          }
          if (other.length > 0) {
            console.log(`    Config: ${other.join(", ")}`);
          }
        }

        if (index < layouts.length - 1) {
          console.log();
        }
      }
      return;
    }

    case "show": {
      if (!layoutName) {
        exitWithUsageHint("Usage: summon layout show <name>");
      }
      if (isPresetName(layoutName)) {
        console.error(`Error: "${layoutName}" is a built-in preset, not a custom layout. Run 'summon --help' to see preset descriptions.`);
        process.exit(1);
      }
      validateLayoutNameOrExit(layoutName);
      const data = readCustomLayout(layoutName);
      if (!data) {
        layoutNotFoundOrExit(layoutName);
      }
      console.log(`Layout: ${layoutName}`);
      for (const [key, value] of data) {
        console.log(`  ${key}=${value}`);
      }
      return;
    }

    case "delete": {
      if (!layoutName) {
        exitWithUsageHint("Usage: summon layout delete <name>");
      }
      validateLayoutNameOrExit(layoutName);
      const deleted = deleteCustomLayout(layoutName);
      if (deleted) {
        console.log(`Deleted custom layout: ${layoutName}`);
        return;
      }
      layoutNotFoundOrExit(layoutName);
      return;
    }

    case "edit": {
      if (!layoutName) {
        exitWithUsageHint("Usage: summon layout edit <name>");
      }
      validateLayoutNameOrExit(layoutName);
      const data = readCustomLayout(layoutName);
      if (!data) {
        layoutNotFoundOrExit(layoutName);
      }
      const editorCmd = process.env.EDITOR || "vi";
      if (!SAFE_COMMAND_RE.test(editorCmd)) {
        console.error(`Error: unsafe EDITOR value "${editorCmd}".`);
        console.error("EDITOR must be a simple command name (e.g. vim, nano, code).");
        console.error("Set a valid editor: export EDITOR=vim");
        process.exit(1);
      }
      const filePath = join(LAYOUTS_DIR, layoutName);
      try {
        execFileSync(editorCmd, [filePath], { stdio: "inherit" });
      } catch {
        console.error(`Failed to open editor: ${editorCmd}`);
        console.error("Check your EDITOR environment variable or ensure the editor is installed.");
        process.exit(1);
      }
      return;
    }

    default:
      exitWithUsageHint(`Error: Unknown layout action: ${action}\nUsage: summon layout <create|save|list|show|delete|edit> [name]`);
  }
}
