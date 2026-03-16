// keybindings.ts — Generate Ghostty key table configuration for workspace navigation

/**
 * Generate Ghostty key table configuration text.
 * Output can be appended to ~/.config/ghostty/config.
 */
export function generateKeyTableConfig(
  paneNames: string[],
  layoutName: string,
  style: "arrows" | "vim" = "arrows",
): string {
  const tableName = "summon-nav";
  const lines: string[] = [];

  // Header comment
  lines.push(`# Summon workspace navigation — ${layoutName} layout`);
  lines.push(`# Pane mapping:`);
  for (let i = 0; i < paneNames.length; i++) {
    lines.push(`#   [${i}] ${paneNames[i]}`);
  }
  lines.push(`#`);
  lines.push(`# Activate with: keybind = alt+s = key_table:${tableName}`);
  lines.push(``);

  // Directional navigation
  if (style === "vim") {
    lines.push(`keybind = ${tableName}:h = focus_split:left`);
    lines.push(`keybind = ${tableName}:j = focus_split:down`);
    lines.push(`keybind = ${tableName}:k = focus_split:up`);
    lines.push(`keybind = ${tableName}:l = focus_split:right`);
  } else {
    lines.push(`keybind = ${tableName}:left = focus_split:left`);
    lines.push(`keybind = ${tableName}:down = focus_split:down`);
    lines.push(`keybind = ${tableName}:up = focus_split:up`);
    lines.push(`keybind = ${tableName}:right = focus_split:right`);
  }

  // Numeric pane access (1..N)
  for (let i = 0; i < Math.min(paneNames.length, 9); i++) {
    lines.push(`keybind = ${tableName}:${i + 1} = focus_split:${i}`);
  }

  // Utility bindings
  lines.push(`keybind = ${tableName}:z = toggle_split_zoom`);
  lines.push(`keybind = ${tableName}:escape = pop_key_table`);

  return lines.join("\n") + "\n";
}
