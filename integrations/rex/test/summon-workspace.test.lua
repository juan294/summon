-- Tests for integrations/rex/summon-workspace.lua, in plain Lua 5.1 (Rex's runtime: no jit table).
-- Usage: lua summon-workspace.test.lua <action.lua> [candidate.json]
-- The fake `rex` supplies only what the action calls; any other field it reads is recorded.
-- candidate.json, when given, is real `summon list --json` output for the registry made by
-- scripts/test-lua.mjs (demo, api, then the inadmissible "bad name!").

local action_path, candidate_path = arg[1], arg[2]
assert(action_path, "usage: lua summon-workspace.test.lua <action.lua> [candidate.json]")

local function read(path)
  local file = assert(io.open(path, "rb"))
  local text = file:read("*a")
  file:close()
  return text
end

local source = read(action_path)

-- A JSON decoder that behaves as Rex's rex.json.decode does on the planning host: an empty array
-- and an empty object are the same empty table, and a null inside an array is dropped.
local function json_decode(s)
  local pos = 1
  local escapes = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
  local function skip() pos = s:find("[^ \t\r\n]", pos) or #s + 1 end
  local function utf8(n)
    if n < 0x80 then return string.char(n) end
    if n < 0x800 then return string.char(0xC0 + math.floor(n / 64), 0x80 + n % 64) end
    return string.char(0xE0 + math.floor(n / 4096), 0x80 + math.floor(n / 64) % 64, 0x80 + n % 64)
  end
  local function str()
    pos = pos + 1
    local buf = {}
    while true do
      local c = s:sub(pos, pos)
      if c == "" then error("unterminated string") end
      if c == '"' then pos = pos + 1; return table.concat(buf) end
      if c == "\\" then
        local e = s:sub(pos + 1, pos + 1)
        if escapes[e] then buf[#buf + 1] = escapes[e]; pos = pos + 2
        elseif e == "u" then
          local n = tonumber(s:sub(pos + 2, pos + 5), 16)
          if not n then error("bad escape") end
          buf[#buf + 1] = utf8(n); pos = pos + 6
        else error("bad escape") end
      else buf[#buf + 1] = c; pos = pos + 1 end
    end
  end
  local value
  function value()
    skip()
    local c = s:sub(pos, pos)
    if c == "{" then
      pos = pos + 1
      local t = {}
      skip()
      if s:sub(pos, pos) == "}" then pos = pos + 1; return t end
      while true do
        skip()
        if s:sub(pos, pos) ~= '"' then error("expected a key") end
        local k = str()
        skip()
        if s:sub(pos, pos) ~= ":" then error("expected :") end
        pos = pos + 1
        t[k] = value()
        skip()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "}" then return t elseif d ~= "," then error("expected , or }") end
      end
    elseif c == "[" then
      pos = pos + 1
      local t = {}
      skip()
      if s:sub(pos, pos) == "]" then pos = pos + 1; return t end
      while true do
        local v = value()
        if v ~= nil then t[#t + 1] = v end
        skip()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "]" then return t elseif d ~= "," then error("expected , or ]") end
      end
    elseif c == '"' then return str()
    elseif s:sub(pos, pos + 3) == "null" then pos = pos + 4; return nil
    elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
    end
    local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
    if not num or num == "" then error("unexpected character at " .. pos) end
    pos = pos + #num
    return tonumber(num)
  end
  local v = value()
  skip()
  if pos <= #s then error("trailing characters") end
  return v
end

local SERVER_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

local function json_rows(rows)
  local parts = {}
  for i, row in ipairs(rows) do
    parts[i] = string.format('{"name":"%s","directory":"%s"}', row[1], row[2])
  end
  return "[" .. table.concat(parts, ",") .. "]\n"
end

local function ok_list(stdout)
  return function() return { code = 0, stdout = stdout, stderr = "", timed_out = false, ok = true } end
end

local DEFAULT_LIST = json_rows({ { "demo", "/tmp/demo = one" }, { "api", "/tmp/api" } })

-- A fresh action with a fake rex. `o` scripts the answers: exec, pick, window, env, no_ui, decode.
local function setup(o)
  o = o or {}
  local calls = { exec = {}, pick = {}, window = {}, queue = {}, other = {}, printed = {} }
  local fake = { calls = calls }
  local session = {
    new_window = function(spec)
      calls.window[#calls.window + 1] = spec
      if o.window then return o.window(spec) end
      return { window_id = "window:new", block_ids = { "block:new" }, revision = 1 }
    end,
  }
  setmetatable(session, { __index = function(_, k) calls.other[#calls.other + 1] = "session." .. k end })
  local rex = {
    -- Field types as the real rex.action checks them (keywords must be a string, preview.21).
    action = function(def)
      assert(type(def.name) == "string" and def.name:find("^[a-z0-9_]+$"), "rex.action: bad name")
      assert(type(def.title) == "string", "rex.action: title must be a string")
      assert(type(def.run) == "function", "rex.action: run must be a function")
      for _, field in ipairs({ "description", "category", "keywords" }) do
        assert(def[field] == nil or type(def[field]) == "string", "rex.action: field " .. field .. " must be a string")
      end
      fake.action = def
    end,
    exec = function(argv, opts)
      calls.exec[#calls.exec + 1] = { argv = argv, opts = opts }
      return (o.exec or ok_list(DEFAULT_LIST))(argv, opts)
    end,
    json = { decode = o.decode or json_decode },
    layout = { block = function(spec) return { block = spec } end },
    session = session,
  }
  if not o.no_client then
    -- rex.client.queue: client actions that run after `run` returns; it raises without a client.
    rex.client = { queue = function(name, args) calls.queue[#calls.queue + 1] = { name = name, args = args } end }
  else
    rex.client = { queue = function() error("rex.client.queue: no client") end }
  end
  -- Rex cannot show a prompt inside pcall: the action's pcall is tracked, and a pick inside it fails.
  local pcall_depth = 0
  local function tracked_pcall(f, ...)
    pcall_depth = pcall_depth + 1
    local results = { pcall(f, ...) }
    pcall_depth = pcall_depth - 1
    return unpack(results)
  end
  fake.pcall = tracked_pcall
  if not o.no_ui then
    rex.ui = {
      pick = function(spec)
        if pcall_depth > 0 then error("rex.ui.pick called inside pcall: Rex returns nil, \"failed\" there") end
        calls.pick[#calls.pick + 1] = spec
        if o.pick then return o.pick(spec) end
        return spec.items[1].id
      end,
    }
  end
  setmetatable(rex, { __index = function(_, k) calls.other[#calls.other + 1] = k end })
  local env_vars = o.env or { SHELL = "/bin/zsh", PATH = SERVER_PATH }
  local fake_os = { getenv = function(name) return env_vars[name] end }
  local env = setmetatable({
    rex = rex,
    pcall = fake.pcall,
    os = (not o.no_os) and fake_os or false,
    print = function(...) calls.printed[#calls.printed + 1] = table.concat({ ... }, " ") end,
  }, { __index = _G })
  local chunk = assert(loadfile(action_path))
  setfenv(chunk, env)
  fake.module = chunk()
  fake.loaded = { exec = #calls.exec, pick = #calls.pick, window = #calls.window, other = #calls.other }
  return fake
end

local CTX = { session_id = "session:origin", block_id = "block:origin", client_id = "client:app", origin = "palette" }

-- Run the action: returns true and its result, or false and the error message.
local function run(fake, ctx)
  if ctx == nil then ctx = CTX end
  return pcall(fake.action.run, ctx, {})
end

-- Tiny test runner.
local passed, failed = 0, {}
local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1 else failed[#failed + 1] = name .. ": " .. tostring(err) end
end
local function eq(actual, expected, what)
  if actual ~= expected then
    error(string.format("%s: expected %q, got %q", what or "value", tostring(expected), tostring(actual)), 2)
  end
end
local function has(text, part, what)
  if type(text) ~= "string" or not text:find(part, 1, true) then
    error(string.format("%s: %q does not contain %q", what or "text", tostring(text), part), 2)
  end
end
local function same_list(actual, expected, what)
  eq(type(actual), "table", what)
  eq(#actual, #expected, (what or "list") .. " length")
  for i = 1, #expected do eq(actual[i], expected[i], (what or "list") .. "[" .. i .. "]") end
end
local ERROR_SCRIPT = 'printf "%s\\n\\n%s\\n" "$1" "Close this tab when you have read it."; exit 1'

-- Windows that open a workspace (not the error tab).
local function opens(fake)
  local n = 0
  for _, spec in ipairs(fake.calls.window) do
    if spec.window_label ~= "Summon · error" then n = n + 1 end
  end
  return n
end

-- The action shows `part` in one error tab, brings it forward and ends quietly. Returns the message.
local function fails_with(fake, part, ctx)
  local before, queued = #fake.calls.window, #fake.calls.queue
  local ok, result = run(fake, ctx)
  eq(ok, true, "an error shown in a tab does not raise (" .. tostring(result) .. ")")
  eq(result, nil, "result")
  eq(#fake.calls.window, before + 1, "error tab created")
  local spec = fake.calls.window[#fake.calls.window]
  eq(spec.session_id, CTX.session_id, "error tab session")
  eq(spec.focus, true, "error tab focus")
  eq(spec.window_label, "Summon · error", "error tab label")
  local options = spec.layout.block.options
  local message = options.command[5]
  same_list(options.command, { "/bin/sh", "-c", ERROR_SCRIPT, "summon-workspace", message }, "error tab command")
  has(message, part, "error")
  eq(options.shell, "none", "error tab shell")
  eq(options.exit.on_completion, false, "error tab stays")
  eq(#fake.calls.queue, queued + 1, "one queued client action")
  local q = fake.calls.queue[#fake.calls.queue]
  eq(q.name, "session.select", "queued action")
  eq(q.args.session_id, CTX.session_id, "queued session")
  eq(q.args.window_id, "window:new", "queued window")
  eq(opens(fake), 0, "workspace tabs")
  return message
end

-- The action fails without any tab, because there is no session to put one in.
local function fails_quietly(fake, part, ctx)
  local ok, err = run(fake, ctx)
  eq(ok, false, "action fails")
  has(err, part, "error")
  eq(#fake.calls.window, 0, "windows created")
  return err
end

test("the picker is never called inside pcall", function()
  local fake = setup()
  assert(run(fake))
  eq(#fake.calls.pick, 1, "picked")
end)

-- Source checks ------------------------------------------------------------------------------

test("the action uses no LuaJIT-only feature", function()
  for _, word in ipairs({ "ffi", "bit", "goto", "jit" }) do
    if source:find("%f[%w_]" .. word .. "%f[^%w_]") then error("the action mentions " .. word) end
  end
end)

test("loading registers one named action and does nothing else", function()
  local fake = setup()
  eq(fake.action.name, "summon_open_workspace", "name")
  eq(fake.action.title, "Summon: Open workspace…", "title")
  eq(type(fake.action.run), "function", "run")
  eq(fake.loaded.exec + fake.loaded.pick + fake.loaded.window + fake.loaded.other, 0, "calls while loading")
  eq(type(fake.module.settings), "table", "settings exported")
  eq(fake.module.settings.executable, "summon", "default executable")
end)

test("loading works without picker support", function()
  local fake = setup({ no_ui = true })
  eq(fake.action.name, "summon_open_workspace", "name")
end)

-- Context and capability -----------------------------------------------------------------------

test("no context: explains, lists nothing, opens no tab", function()
  local fake = setup()
  fails_quietly(fake, "Run this from an open Rex session", false)
  eq(#fake.calls.exec, 0, "exec calls")
end)

test("context without a session: explains, lists nothing", function()
  local fake = setup()
  fails_quietly(fake, "Run this from an open Rex session", { origin = "cli" })
  eq(#fake.calls.exec, 0, "exec calls")
end)

test("no picker API: explains API 17 and the terminal fallback, lists nothing", function()
  local fake = setup({ no_ui = true })
  local err = fails_with(fake, "API 17 or later")
  has(err, "summon open", "fallback")
  eq(#fake.calls.exec, 0, "exec calls")
end)

-- Listing command ----------------------------------------------------------------------------

test("default listing: login zsh, fixed script, positional executable, 5 second timeout", function()
  local fake = setup()
  assert(run(fake))
  eq(#fake.calls.exec, 1, "exec calls")
  same_list(fake.calls.exec[1].argv, { "/bin/zsh", "-lc", 'exec "$0" "$@"', "summon", "list", "--json" }, "argv")
  eq(fake.calls.exec[1].opts.timeout, 5, "timeout")
  eq(fake.calls.exec[1].opts.env, nil, "env")
end)

test("the shell defaults to the server's SHELL", function()
  local fake = setup({ env = { SHELL = "/bin/bash", PATH = SERVER_PATH } })
  assert(run(fake))
  eq(fake.calls.exec[1].argv[1], "/bin/bash", "shell")
end)

test("the shell falls back to /bin/zsh without SHELL", function()
  local fake = setup({ env = { PATH = SERVER_PATH } })
  assert(run(fake))
  eq(fake.calls.exec[1].argv[1], "/bin/zsh", "shell")
end)

test("settings change the shell, executable and PATH of both calls", function()
  local fake = setup()
  local settings = fake.module.settings
  settings.shell = "/bin/sh"
  settings.executable = "/Users/me/My Tools/summon"
  settings.path_prepend = { "/opt/node/bin", "/Users/me/.volta/bin" }
  assert(run(fake))
  same_list(fake.calls.exec[1].argv,
    { "/bin/sh", "-lc", 'exec "$0" "$@"', "/Users/me/My Tools/summon", "list", "--json" }, "argv")
  eq(fake.calls.exec[1].opts.env.PATH, "/opt/node/bin:/Users/me/.volta/bin:" .. SERVER_PATH, "listing PATH")
  local options = fake.calls.window[1].layout.block.options
  same_list(options.command, { "/Users/me/My Tools/summon", "open", "demo" }, "command")
  same_list(options.path_prepend, { "/opt/node/bin", "/Users/me/.volta/bin" }, "path_prepend")
end)

test("no prepend list: no PATH option on either call", function()
  local fake = setup()
  assert(run(fake))
  eq(fake.calls.exec[1].opts.env, nil, "listing env")
  eq(fake.calls.window[1].layout.block.options.path_prepend, nil, "path_prepend")
end)

test("the shell cannot start: names the shell setting", function()
  local fake = setup({ exec = function() return nil, "exec: /bin/nosh: no such file" end })
  fake.module.settings.shell = "/bin/nosh"
  local err = fails_with(fake, 'Could not start the shell "/bin/nosh"')
  has(err, "summon.settings.shell", "setting")
  eq(#fake.calls.pick, 0, "pickers")
end)

test("listing times out", function()
  local fake = setup({ exec = function()
    return { code = -1, signal = "SIGTERM", stdout = "", stderr = "", timed_out = true, ok = false }
  end })
  fails_with(fake, "did not finish in 5 seconds")
end)

test("node missing from the login PATH: says an absolute Summon path alone does not help", function()
  local fake = setup({ exec = function()
    return { code = 127, stdout = "", stderr = "env: node: No such file or directory\n", timed_out = false, ok = false }
  end })
  local err = fails_with(fake, "`node` is not on the login PATH of /bin/zsh")
  has(err, "path_prepend", "setting")
  has(err, "an absolute Summon path alone does not help", "absolute path")
end)

test("summon not found: names the three settings and exit code", function()
  local fake = setup({ exec = function()
    return { code = 127, stdout = "", stderr = "zsh:1: command not found: summon\n", timed_out = false, ok = false }
  end })
  local err = fails_with(fake, "failed with exit 127 (zsh:1: command not found: summon)")
  has(err, "summon.settings.executable", "executable")
  has(err, "summon.settings.shell", "shell")
  has(err, "summon.settings.path_prepend", "path")
end)

test("copied diagnostics are bounded and lose control characters", function()
  local fake = setup({ exec = function()
    return { code = 1, stdout = "", stderr = "\27[31mboom\r\n" .. string.rep("x", 500), timed_out = false, ok = false }
  end })
  local err = fails_with(fake, "boom")
  if err:find("%c") then error("control character in message") end
  if #err > 600 then error("message is not bounded: " .. #err) end
end)

test("old human output: asks to update Summon, without copying the registry", function()
  local fake = setup({ exec = ok_list("Registered projects:\n  demo → /tmp/secret-dir\n") })
  local err = fails_with(fake, "printed text instead of JSON")
  if err:find("secret%-dir") or err:find("demo") then error("registry text copied: " .. err) end
end)

test("a failed listing, then a valid retry, opens normally", function()
  local attempts = 0
  local fake = setup({ exec = function(argv, opts)
    attempts = attempts + 1
    if attempts == 1 then return { code = 1, stdout = "", stderr = "x", timed_out = false, ok = false } end
    return ok_list(DEFAULT_LIST)(argv, opts)
  end })
  fails_with(fake, "failed with exit 1")
  assert(run(fake))
  eq(#fake.calls.exec, 2, "a fresh list per run")
  eq(opens(fake), 1, "workspace tabs")
end)

test("wrong setting types are reported, not ignored", function()
  local cases = {
    { "path_prepend", "/opt/homebrew/bin", "summon.settings.path_prepend must be a list" },
    { "path_prepend", { "/a", 7 }, "summon.settings.path_prepend must be a list of directory strings" },
    { "executable", "", "summon.settings.executable must be a non-empty string" },
    { "executable", 42, "summon.settings.executable must be a non-empty string" },
    { "shell", false, "summon.settings.shell must be nil or a non-empty string" },
  }
  for _, case in ipairs(cases) do
    local fake = setup()
    fake.module.settings[case[1]] = case[2]
    fails_with(fake, case[3])
    eq(#fake.calls.exec, 0, "exec calls for " .. case[1])
  end
end)

test("a replaced settings table takes effect, missing fields keep their defaults", function()
  local fake = setup()
  fake.module.settings = { path_prepend = { "/opt/homebrew/bin" } }
  assert(run(fake))
  same_list(fake.calls.exec[1].argv, { "/bin/zsh", "-lc", 'exec "$0" "$@"', "summon", "list", "--json" }, "argv")
  eq(fake.calls.exec[1].opts.env.PATH, "/opt/homebrew/bin:" .. SERVER_PATH, "PATH")
  local broken = setup()
  broken.module.settings = "oops"
  fails_with(broken, "summon.settings.table must be a table")
end)

test("no os table: defaults still work", function()
  local fake = setup({ no_os = true })
  assert(run(fake))
  eq(fake.calls.exec[1].argv[1], "/bin/zsh", "shell")
end)

-- Listing contents ----------------------------------------------------------------------------

test("malformed JSON", function()
  fails_with(setup({ exec = ok_list('[{"name":"demo",') }), "unexpected list")
  fails_with(setup({ exec = ok_list('[{"name":"demo","directory":"/x"},}]') }), "unexpected list")
end)

test("a decoder that returns nil and an error is treated as malformed", function()
  -- Rex preview.21: rex.json.decode returns nil, "rex.json.decode: text is not valid JSON" without raising.
  fails_with(setup({ decode = function() return nil, "rex.json.decode: text is not valid JSON" end }), "not valid JSON")
end)

test("a decoder that raises is treated as malformed", function()
  fails_with(setup({ decode = function() error("bad json") end }), "not valid JSON")
end)

test("an object instead of a list", function()
  fails_with(setup({ exec = ok_list('{}') }), "it is not a list")
  fails_with(setup({ exec = ok_list('{"name":"demo","directory":"/x"}') }), "it is not a list")
end)

test("a null row is noticed although the decoder drops it", function()
  fails_with(setup({ exec = ok_list('[{"name":"demo","directory":"/x"},null]') }), "a row is null or missing")
  fails_with(setup({ exec = ok_list('[null]') }), "a row is null or missing")
end)

test("a row that is not an object", function()
  fails_with(setup({ exec = ok_list('[{"name":"demo","directory":"/x"},1]') }), "row 2 is not an object")
end)

test("a field that is not text", function()
  fails_with(setup({ exec = ok_list('[{"name":7,"directory":"/x"}]') }), "row 1 has no text name and directory")
  fails_with(setup({ exec = ok_list('[{"name":"demo"}]') }), "row 1 has no text name and directory")
end)

test("a duplicate name", function()
  fails_with(setup({ exec = ok_list(json_rows({ { "demo", "/a" }, { "demo", "/b" } })) }), "appears twice")
end)

test("brackets, commas and quotes inside strings do not confuse the row count", function()
  local fake = setup({ exec = ok_list('[{"name":"demo","directory":"/tmp/a,b]}[{\\"c\\""}]') })
  assert(run(fake))
  eq(#fake.calls.pick[1].items, 1, "items")
end)

test("an empty registry: suggests summon add", function()
  local fake = setup({ exec = ok_list("[]\n") })
  fails_with(fake, "summon add <name> <path>")
  eq(#fake.calls.pick, 0, "pickers")
end)

test("inadmissible names are skipped and counted in the placeholder", function()
  local fake = setup({ exec = ok_list(json_rows({
    { "bad name!", "/a" }, { "demo", "/b" }, { "-dash", "/c" }, { string.rep("a", 65), "/d" }, { "", "/e" },
    { "caf\195\169", "/f" }, { "ok.name_1-2", "/g" }, { string.rep("b", 64), "/h" },
  })) })
  assert(run(fake))
  local spec = fake.calls.pick[1]
  eq(#spec.items, 3, "offered")
  eq(spec.items[1].id, "demo", "first")
  eq(spec.items[2].id, "ok.name_1-2", "second")
  eq(spec.items[3].id, string.rep("b", 64), "third")
  has(spec.placeholder, "5 skipped", "placeholder")
  has(spec.placeholder, "summon list", "placeholder hint")
end)

test("no skipped name: a plain placeholder", function()
  local fake = setup()
  assert(run(fake))
  eq(fake.calls.pick[1].placeholder, "Filter projects", "placeholder")
end)

test("every name inadmissible: explains with the count", function()
  local fake = setup({ exec = ok_list(json_rows({ { "bad name!", "/a" }, { "x y", "/b" } })) })
  fails_with(fake, "(2 skipped)")
  eq(#fake.calls.pick, 0, "pickers")
end)

local function many(n)
  local rows = {}
  for i = 1, n do rows[i] = { "p" .. i, "/tmp/p" .. i } end
  return json_rows(rows)
end

test("2,000 projects are offered", function()
  local fake = setup({ exec = ok_list(many(2000)) })
  assert(run(fake))
  eq(#fake.calls.pick[1].items, 2000, "items")
end)

test("2,001 projects are refused, never truncated", function()
  local fake = setup({ exec = ok_list(many(2001)) })
  fails_with(fake, "There are 2001 registered projects")
  eq(#fake.calls.pick, 0, "pickers")
end)

-- Picker --------------------------------------------------------------------------------------

test("the picker offers names in registry order, as ids and titles", function()
  local fake = setup()
  assert(run(fake))
  local spec = fake.calls.pick[1]
  eq(spec.title, "Open Summon workspace", "title")
  eq(spec.items[1].id, "demo", "id 1")
  eq(spec.items[1].title, "demo", "title 1")
  eq(spec.items[2].id, "api", "id 2")
  eq(spec.multiple, nil, "multiple")
  eq(spec.allow_other, nil, "allow_other")
end)

test("cancel: quiet, nothing opened", function()
  local fake = setup({ pick = function() return nil, "cancelled" end })
  local ok, result = run(fake)
  eq(ok, true, "no error")
  eq(result, nil, "result")
  eq(#fake.calls.window, 0, "windows")
  eq(#fake.calls.printed, 0, "printed")
end)

for reason, part in pairs({
  timeout = "timed out",
  busy = "Another Rex question is open",
  no_client = "No connected Rex app can show the picker",
  unsupported = "cannot show pickers",
}) do
  test("picker " .. reason, function()
    fails_with(setup({ pick = function() return nil, reason end }), part)
  end)
end

test("after each picker failure, a new run lists again and opens the choice", function()
  for _, reason in ipairs({ "cancelled", "timeout", "busy", "no_client", "unsupported", "failed" }) do
    local n = 0
    local fake = setup({ pick = function(spec) n = n + 1; if n == 1 then return nil, reason end; return spec.items[2].id end })
    run(fake)
    eq(opens(fake), 0, reason .. ": no workspace tab after the failure")
    eq(#fake.calls.window, reason == "cancelled" and 0 or 1, reason .. ": error tab unless cancelled")
    assert(run(fake))
    eq(#fake.calls.exec, 2, reason .. ": a fresh list")
    eq(opens(fake), 1, reason .. ": one workspace tab after the retry")
    local last = fake.calls.window[#fake.calls.window]
    eq(last.layout.block.options.command[3], "api", reason .. ": the retried choice")
  end
end)

test("after a malformed list, a valid list opens normally", function()
  local outputs = { '[{"name":"demo",', DEFAULT_LIST }
  local n = 0
  local fake = setup({ exec = function(argv, opts) n = n + 1; return ok_list(outputs[n])(argv, opts) end })
  fails_with(fake, "unexpected list")
  assert(run(fake))
  eq(opens(fake), 1, "workspace tabs")
end)

test("an error tab carries the message as one argument, metacharacters included", function()
  local fake = setup({ pick = function() return nil, "failed", "$(touch /tmp/x); `id` \"q\" 'p'" end })
  fails_with(fake, "$(touch /tmp/x); `id`")
  has(fake.calls.window[1].layout.block.options.command[5], "$(touch /tmp/x); `id` \"q\" 'p'", "message argument")
end)

test("without a client to bring it forward, the error is raised and points to the tab", function()
  local fake = setup({ no_client = true, exec = ok_list("[]\n") })
  local ok, err = run(fake)
  eq(ok, false, "raises")
  eq(err, 'Details are in the "Summon · error" tab. ' .. fake.module.messages.empty, "message")
  eq(#fake.calls.window, 1, "error tab")
end)

test("an opened workspace tab is brought forward", function()
  local fake = setup({ pick = function() return "api" end })
  assert(run(fake))
  eq(#fake.calls.queue, 1, "queued")
  eq(fake.calls.queue[1].name, "session.select", "action")
  eq(fake.calls.queue[1].args.session_id, "session:origin", "session")
  eq(fake.calls.queue[1].args.window_id, "window:new", "window")
end)

test("an opened workspace tab without a client still succeeds", function()
  local fake = setup({ no_client = true })
  local ok, result = run(fake)
  eq(ok, true, "no error")
  eq(result, nil, "result")
  eq(opens(fake), 1, "workspace tab")
end)

test("an error tab that cannot be created still raises the message", function()
  local fake = setup({ pick = function() return nil, "busy" end, window = function() return nil, "conflict" end })
  local ok, err = run(fake)
  eq(ok, false, "fails")
  eq(err, "Another Rex question is open. Answer or close it, then retry.", "message without a tab pointer")
  eq(#fake.calls.window, 1, "one attempt")
end)

test("picker failed: shows the bounded detail", function()
  local err = fails_with(setup({ pick = function() return nil, "failed", "renderer\0 crashed" end }),
    "The picker failed (renderer  crashed)")
  has(err, "summon open", "fallback")
end)

test("an id that was not offered is refused", function()
  fails_with(setup({ pick = function() return "other" end }), "was not offered")
  fails_with(setup({ pick = function() return { text = "demo" } end }), "was not offered")
end)

-- Handoff -------------------------------------------------------------------------------------

test("a choice makes one focused tab that runs summon open <name>", function()
  local fake = setup({ pick = function() return "api" end })
  local ok, result = run(fake)
  eq(ok, true, "no error")
  eq(result, nil, "result")
  eq(#fake.calls.window, 1, "windows")
  local spec = fake.calls.window[1]
  eq(spec.session_id, "session:origin", "session")
  eq(spec.focus, true, "focus")
  eq(spec.window_label, "Summon · api", "label")
  local block = spec.layout.block
  eq(block.flavor, "com.superlogical.terminal.shell", "flavor")
  same_list(block.options.command, { "summon", "open", "api" }, "command")
  eq(block.options.exit.on_completion, false, "exit.on_completion")
  eq(block.options.shell, nil, "shell left at default")
  eq(block.options.interactive, nil, "interactive left unset")
  eq(block.options.cwd, nil, "cwd")
  eq(#fake.calls.other, 0, "other rex calls (send, close, ...)")
  eq(#fake.calls.printed, 0, "printed")
end)

test("a name that looks like a command stays one argument", function()
  local fake = setup({ exec = ok_list(json_rows({ { "rm", "/a" }, { "_.-", "/b" } })), pick = function() return "_.-" end })
  assert(run(fake))
  same_list(fake.calls.window[1].layout.block.options.command, { "summon", "open", "_.-" }, "command")
end)

test("the choice can change between runs", function()
  local picks = { "demo", "api" }
  local n = 0
  local fake = setup({ pick = function() n = n + 1; return picks[n] end })
  assert(run(fake))
  assert(run(fake))
  eq(fake.calls.window[1].layout.block.options.command[3], "demo", "first")
  eq(fake.calls.window[2].layout.block.options.command[3], "api", "second")
  eq(#fake.calls.exec, 2, "lists")
end)

test("a failed tab creation explains, and is not retried", function()
  local fake = setup({ window = function() return nil, "session_not_found" end })
  local ok, err = run(fake)
  eq(fake.calls.window[1].window_label, "Summon · demo", "only the workspace tab was requested")
  eq(ok, false, "fails")
  has(err, "Rex did not confirm the new tab for demo (session_not_found)", "message")
  has(err, '"Summon · demo" tab appeared', "inspect guidance")
  eq(#fake.calls.window, 1, "one create")
end)

test("a lost reply is not retried either", function()
  local fake = setup({ window = function() return nil, "timeout" end })
  local ok, err = run(fake)
  eq(ok, false, "fails")
  has(err, "(timeout)", "message")
  eq(#fake.calls.window, 1, "one create")
end)

test("success never claims the workspace is ready", function()
  local fake = setup()
  local _, result = run(fake)
  eq(result, nil, "result")
  for _, line in ipairs(fake.calls.printed) do
    if line:lower():find("ready") then error("printed " .. line) end
  end
end)

test("every message names a condition and is used", function()
  local fake = setup()
  local by_reason = { timeout = true, busy = true, no_client = true, unsupported = true }
  for key in pairs(fake.module.messages) do
    if not by_reason[key] and not source:find('fail%("' .. key .. '"') and not source:find("messages%." .. key) then
      error("message " .. key .. " is never raised")
    end
  end
end)

-- Real CLI output -----------------------------------------------------------------------------

if candidate_path then
  test("real summon list --json output", function()
    local stdout = read(candidate_path)
    local fake = setup({ exec = ok_list(stdout), pick = function(spec) return spec.items[2].id end })
    assert(run(fake))
    local spec = fake.calls.pick[1]
    eq(#spec.items, 2, "offered")
    eq(spec.items[1].id, "demo", "first")
    eq(spec.items[2].id, "api", "second")
    has(spec.placeholder, "1 skipped", "placeholder")
    same_list(fake.calls.window[1].layout.block.options.command, { "summon", "open", "api" }, "command")
  end)
end

print(string.format("%d passed, %d failed (%s)", passed, #failed, _VERSION))
for _, line in ipairs(failed) do print("FAIL " .. line) end
if #failed > 0 then os.exit(1) end
