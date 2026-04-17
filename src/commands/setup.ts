import { resolveConfig, traditionalPaneNames } from "../launcher.js";
import { exitWithUsageHint } from "../utils.js";
import type { CommandContext } from "./types.js";

export async function handleSetupCommand(): Promise<void> {
  const { runSetup } = await import("../setup.js");
  await runSetup();
}

export async function handleCompletionsCommand({ args }: CommandContext): Promise<void> {
  const [shell] = args;
  if (!shell) {
    exitWithUsageHint("Usage: summon completions <shell>\nSupported shells: zsh, bash");
  }

  if (shell !== "zsh" && shell !== "bash") {
    exitWithUsageHint(`Error: Unsupported shell: ${shell}\nSupported shells: zsh, bash`);
  }

  const { generateZshCompletion, generateBashCompletion } = await import("../completions.js");
  console.log(shell === "zsh" ? generateZshCompletion() : generateBashCompletion());
}

export async function handleKeybindingsCommand({ values, overrides }: CommandContext): Promise<void> {
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

  console.log(generateKeyTableConfig(paneNames, layoutName, style));
}
