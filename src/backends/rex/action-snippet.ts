/**
 * `summon keybindings rex`: print the Rex palette action, the exact bytes of
 * integrations/rex/summon-workspace.lua, which the build embeds as __REX_ACTION_LUA__.
 * Read at call time, so a unit suite can define the constant before calling.
 */
export function printRexAction(): void {
  process.stdout.write(__REX_ACTION_LUA__);
}
