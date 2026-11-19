-- Summon workspace picker for Rex.
--
-- Adds "Summon: Open workspace..." to the Rex palette. It lists the projects registered with
-- `summon add`, and opens the one you choose in a new tab of the current session, which runs
-- `summon open <name>`: a live workspace is focused, a stopped one is launched (with the usual
-- trust and confirmation prompts in that tab).
--
-- Install: save this file beside your Rex config as summon-workspace.lua, for example with
--   summon keybindings rex > ~/.config/rex/summon-workspace.lua
-- then add this line to ~/.config/rex/init.lua and run `rex config reload`:
--   require("summon-workspace")
--
-- Settings: change them in init.lua, after the require, so a new copy of this file keeps them:
--   local summon = require("summon-workspace")
--   summon.settings.executable = "/opt/homebrew/bin/summon"
--   summon.settings.shell = "/bin/zsh"
--   summon.settings.path_prepend = { "/opt/homebrew/bin" }
--
-- Optional key binding, also in init.lua:
--   rex.bind("shift+cmd+o", "summon_open_workspace")
--
-- Needs a Rex server with API revision 17 or later and a Rex app that can show pickers.

local settings = {
  -- The Summon command. An absolute path is allowed (spaces too).
  executable = "summon",
  -- The shell that runs the project listing as a login shell (`-lc`), so it finds Summon and
  -- Node on your login PATH. nil means the server's SHELL, else /bin/zsh. Use a POSIX-style
  -- shell: a fish user sets "/bin/zsh".
  shell = nil,
  -- Directories put at the front of PATH for the listing and the new tab. Use this when Node or
  -- Summon is set up only in interactive startup files such as ~/.zshrc.
  path_prepend = {},
}

-- The module table `require` returns: init.lua changes `settings` through it, and the action
-- reads it when it runs, so even a replaced `summon.settings` table takes effect.
local M = { settings = settings }

local MAX_ITEMS = 2000
local LIST_TIMEOUT = 5
local SHELL_FLAVOR = "com.superlogical.terminal.shell"
local TERMINAL_HINT = " Or run `summon open` in a terminal."

-- Every message the action can show, in one place.
local messages = {
  no_session = "Run this from an open Rex session." .. TERMINAL_HINT,
  no_picker = "This Rex cannot show pickers. Update the Rex app and server (API 17 or later)." .. TERMINAL_HINT,
  no_client = "No connected Rex app can show the picker. Open or update the Rex app, then retry." .. TERMINAL_HINT,
  unsupported = "The connected Rex app cannot show pickers. Update the Rex app, then retry." .. TERMINAL_HINT,
  busy = "Another Rex question is open. Answer or close it, then retry.",
  timeout = "The picker timed out. Run the action again to retry.",
  pick_failed = "The picker failed (%s)." .. TERMINAL_HINT,
  shell_failed = "Could not start the shell %q to list projects (%s). Set summon.settings.shell in init.lua." .. TERMINAL_HINT,
  list_timeout = "`summon list --json` did not finish in %d seconds. Run it in a terminal to check, then retry.",
  node_missing = "Summon was found, but `node` is not on the login PATH of %s (%s). Set summon.settings.path_prepend"
    .. " to the directory that holds node; an absolute Summon path alone does not help." .. TERMINAL_HINT,
  list_failed = "`summon list --json` failed with exit %s (%s). Check summon.settings.executable (an absolute path is"
    .. " allowed), summon.settings.shell and summon.settings.path_prepend." .. TERMINAL_HINT,
  old_cli = "`summon list --json` printed text instead of JSON. Update Summon to a version with list --json, then retry.",
  malformed = "`summon list --json` printed an unexpected list (%s). Run `summon list` in a terminal and repair"
    .. " ~/.config/summon/projects if needed.",
  empty = "No projects are registered. Run `summon add <name> <path>` in a terminal, then retry.",
  none_valid = "No registered project has a name Summon can open (%d skipped). Run `summon list` in a terminal and"
    .. " re-add them with `summon add <name> <path>`.",
  too_many = "There are %d registered projects, more than the picker can show (%d)." .. TERMINAL_HINT,
  unexpected_choice = "The picker returned a project that was not offered. Run the action again.",
  window_failed = "Rex did not confirm the new tab for %s (%s). If a %q tab appeared, use it; otherwise retry.",
  bad_setting = "summon.settings.%s must be %s. Fix it in ~/.config/rex/init.lua and run `rex config reload`.",
}
M.messages = messages

local placeholder = "Filter projects"
local placeholder_skipped = "Filter projects (%d skipped: run summon list)"

-- Text safe to show: control characters become spaces, and it is cut to a bounded length.
local function bounded(text)
  text = tostring(text or ""):gsub("%c", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if #text > 200 then text = text:sub(1, 200) .. "..." end
  if text == "" then text = "no output" end
  return text
end

local function fail(condition, ...)
  error(string.format(messages[condition], ...), 0)
end

-- A project name Summon accepts (src/validation.ts PROJECT_NAME_RE), in ASCII classes and bytes.
local function admissible(name)
  return #name >= 1 and #name <= 64 and name:find("^[A-Za-z0-9_][A-Za-z0-9_.%-]*$") ~= nil
end

-- The number of top-level elements of the JSON array `text` (which starts with "["), so a row
-- that the decoder drops (a null) is noticed. Returns nil when the brackets do not balance.
local function wire_rows(text)
  local depth, in_string, escaped, count, seen = 0, false, false, 0, false
  for i = 1, #text do
    local c = text:sub(i, i)
    if in_string then
      if escaped then escaped = false
      elseif c == "\\" then escaped = true
      elseif c == '"' then in_string = false end
    elseif c == '"' then
      in_string = true
      if depth == 1 then seen = true end
    elseif c == "[" or c == "{" then
      depth = depth + 1
      if depth == 2 then seen = true end
    elseif c == "]" or c == "}" then
      depth = depth - 1
      if depth < 0 then return nil end
      if depth == 0 and i ~= #text then return nil end
    elseif depth == 1 and c == "," then
      count = count + 1
    elseif depth == 1 and not c:find("%s") then
      seen = true
    end
  end
  if depth ~= 0 or in_string then return nil end
  if not seen then return 0 end
  return count + 1
end

local function getenv(name)
  if type(os) ~= "table" or type(os.getenv) ~= "function" then return nil end
  return os.getenv(name)
end

-- The settings as the action uses them, checked: a wrong type is reported, never ignored.
local function current_settings()
  local s = M.settings
  if type(s) ~= "table" then fail("bad_setting", "table", "a table") end
  local executable = s.executable
  if executable == nil then executable = settings.executable end
  if type(executable) ~= "string" or executable == "" then fail("bad_setting", "executable", "a non-empty string") end
  local shell = s.shell
  if shell ~= nil and (type(shell) ~= "string" or shell == "") then fail("bad_setting", "shell", "nil or a non-empty string") end
  if shell == nil then shell = getenv("SHELL") end
  if shell == nil or shell == "" then shell = "/bin/zsh" end
  local dirs = s.path_prepend
  if dirs ~= nil then
    if type(dirs) ~= "table" then fail("bad_setting", "path_prepend", "a list of directories, such as { \"/opt/homebrew/bin\" }") end
    for i = 1, #dirs do
      if type(dirs[i]) ~= "string" or dirs[i] == "" then fail("bad_setting", "path_prepend", "a list of directory strings") end
    end
    if #dirs == 0 then dirs = nil end
  end
  return { executable = executable, shell = shell, path_prepend = dirs }
end

-- Run `summon list --json` through the login shell and return its stdout.
local function list_output(config)
  local shell = config.shell
  local argv = { shell, "-lc", 'exec "$0" "$@"', config.executable, "list", "--json" }
  local opts = { timeout = LIST_TIMEOUT }
  if config.path_prepend then
    local path = getenv("PATH") or "/usr/bin:/bin:/usr/sbin:/sbin"
    opts.env = { PATH = table.concat(config.path_prepend, ":") .. ":" .. path }
  end
  local result, err = rex.exec(argv, opts)
  if not result then fail("shell_failed", shell, bounded(err)) end
  if result.timed_out then fail("list_timeout", LIST_TIMEOUT) end
  if not result.ok then
    local stderr = result.stderr or ""
    if stderr:find("env: node: No such file or directory", 1, true) then
      fail("node_missing", shell, bounded(stderr))
    end
    fail("list_failed", tostring(result.code), bounded(stderr ~= "" and stderr or result.stdout))
  end
  return result.stdout or ""
end

-- Parse and check the listing: the names to offer, in registry order, and how many were skipped.
local function choices(stdout)
  local text = stdout:gsub("^%s+", ""):gsub("%s+$", "")
  if text:sub(1, 1) == "{" then fail("malformed", "it is not a list") end
  if text:sub(1, 1) ~= "[" then fail("old_cli") end
  local expected = wire_rows(text)
  if not expected then fail("malformed", "the JSON array does not close") end
  local ok, rows = pcall(rex.json.decode, text)
  if not ok or type(rows) ~= "table" then fail("malformed", "it is not valid JSON") end
  local decoded = 0
  for _ in pairs(rows) do decoded = decoded + 1 end
  if decoded ~= expected or #rows ~= expected then fail("malformed", "a row is null or missing") end
  local names, seen, skipped = {}, {}, 0
  for i = 1, #rows do
    local row = rows[i]
    if type(row) ~= "table" then fail("malformed", "row " .. i .. " is not an object") end
    if type(row.name) ~= "string" or type(row.directory) ~= "string" then
      fail("malformed", "row " .. i .. " has no text name and directory")
    end
    if seen[row.name] then fail("malformed", "a project name appears twice") end
    seen[row.name] = true
    if admissible(row.name) then names[#names + 1] = row.name else skipped = skipped + 1 end
  end
  if expected == 0 then fail("empty") end
  if #names == 0 then fail("none_valid", skipped) end
  if #names > MAX_ITEMS then fail("too_many", #names, MAX_ITEMS) end
  return names, skipped
end

local function open_workspace(ctx)
  if type(ctx) ~= "table" or type(ctx.session_id) ~= "string" or ctx.session_id == "" then fail("no_session") end
  if type(rex.ui) ~= "table" or type(rex.ui.pick) ~= "function" then fail("no_picker") end

  local config = current_settings()
  local names, skipped = choices(list_output(config))
  local items, offered = {}, {}
  for i, name in ipairs(names) do
    items[i] = { id = name, title = name, icon = "folder" }
    offered[name] = true
  end

  -- Called directly from run: Rex cannot show a picker from inside pcall.
  local choice, reason, detail = rex.ui.pick{
    title = "Open Summon workspace",
    placeholder = skipped > 0 and string.format(placeholder_skipped, skipped) or placeholder,
    items = items,
  }
  if choice == nil then
    if reason == "cancelled" then return nil end
    if reason == "timeout" or reason == "busy" or reason == "no_client" or reason == "unsupported" then fail(reason) end
    fail("pick_failed", bounded(detail or reason))
  end
  if type(choice) ~= "string" or not offered[choice] then fail("unexpected_choice") end

  local label = "Summon · " .. choice
  local window, err = rex.session.new_window{
    session_id = ctx.session_id,
    focus = true,
    window_label = label,
    layout = rex.layout.block{
      flavor = SHELL_FLAVOR,
      options = {
        command = { config.executable, "open", choice },
        exit = { on_completion = false },
        path_prepend = config.path_prepend,
      },
    },
  }
  if not window then fail("window_failed", choice, bounded(err), label) end
  return nil
end

rex.action{
  name = "summon_open_workspace",
  title = "Summon: Open workspace…",
  description = "Choose a project registered with summon add, and focus or launch its workspace in a new tab.",
  category = "Summon",
  keywords = "summon workspace project open switch",
  run = open_workspace,
}

return M
