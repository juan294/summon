import { resolveConfig, traditionalPaneNames } from "../launcher.js";
import { probeGhosttyDetach } from "../ghostty.js";
import { err, fail } from "../ui/output.js";
import { exitWithUsageHint } from "../utils.js";
import type { CommandContext } from "./types.js";
import { resolveBackendForLaunch } from "../backend.js";
import type { SetupOptions } from "../setup.js";

export async function handleSetupCommand(): Promise<void> {
  const { runSetup } = await import("../setup.js");
  await runSetup(detectedSetupBackend());
}

/** The wizard's backend (plan P15): under Rex it skips the Ghostty install and Accessibility steps. Detection notices are shown as for a launch. */
export function detectedSetupBackend(options: { showNotices?: boolean } = {}): SetupOptions {
  const detection = resolveBackendForLaunch();
  if (options.showNotices ?? true) for (const notice of detection.notices) err(notice);
  return detection.ok ? { backend: detection.backend } : {};
}

export async function handleCompletionsCommand({ args }: CommandContext): Promise<void> {
  const [shell] = args;
  if (!shell) {
    exitWithUsageHint("Usage: summon completions <shell>\nSupported shells: zsh, bash, fish");
  }

  if (shell !== "zsh" && shell !== "bash" && shell !== "fish") {
    exitWithUsageHint(`Unsupported shell: ${shell}\nSupported shells: zsh, bash, fish`);
  }

  const { generateZshCompletion, generateBashCompletion, generateFishCompletion } = await import("../completions.js");
  console.log(shell === "zsh" ? generateZshCompletion() : shell === "bash" ? generateBashCompletion() : generateFishCompletion());
}

export async function handleKeybindingsCommand({ values, overrides }: CommandContext): Promise<void> {
  if (values["detach-tab"]) {
    const support = probeGhosttyDetach();
    if (support.state !== "supported") {
      fail(support.reason);
      process.exit(2);
    }
  }
  const { generateKeyTableConfig } = await import("../keybindings.js");
  const { collectLeaves, resolveTreeCommands } = await import("../tree.js");
  const style = values.vim ? "vim" as const : "arrows" as const;
  const config = resolveConfig(process.cwd(), overrides);

  let paneNames: string[];
  let layoutName: string;

  if (config.treeLayout) {
    const resolved = resolveTreeCommands(config.treeLayout.tree, config.treeLayout.panes);
    paneNames = collectLeaves(resolved);
    layoutName = "tree";
  } else {
    const { planLayout } = await import("../layout.js");
    const plan = planLayout(config.opts);
    paneNames = traditionalPaneNames(plan);
    layoutName = "default";
  }

  const snippet = values["detach-tab"]
    ? generateKeyTableConfig(paneNames, layoutName, style, { detachTab: true })
    : generateKeyTableConfig(paneNames, layoutName, style);
  console.log(snippet);
}
