# Phase 2: AppleScript Generator

## Scope

Create `script.ts` -- a pure function that generates AppleScript strings from a `LayoutPlan`.

## Files to Create

### `src/script.ts`

New file. Exports:

```typescript
export function generateAppleScript(plan: LayoutPlan, targetDir: string): string
```

The generated AppleScript follows this structure:

```applescript
tell application "Ghostty"
    activate

    set cfg to new surface configuration
    set initial working directory of cfg to "<targetDir>"

    set win to new window with configuration cfg
    set paneRoot to terminal 1 of selected tab of win

    -- Split sidebar (right side)
    set paneSidebar to split paneRoot direction right with configuration cfg

    -- Split right column from root (if right column has panes)
    set paneRightCol to split paneRoot direction right with configuration cfg

    -- Split left column vertically for additional editor panes
    set paneLeft2 to split paneRoot direction down with configuration cfg
    -- ... more left panes

    -- Split right column vertically for additional editors + server
    set paneRight2 to split paneRightCol direction down with configuration cfg
    -- ... more right panes

    -- Send commands to each pane
    input text "<editor>" to paneRoot
    send key "enter" to paneRoot

    input text "<sidebar>" to paneSidebar
    send key "enter" to paneSidebar

    -- ... commands for each pane

    -- Focus the root editor pane
    focus paneRoot
end tell
```

### Implementation Details

**Pane naming convention:**
- `paneRoot` -- first editor (top-left)
- `paneSidebar` -- sidebar (far right)
- `paneRightCol` -- first pane in right column
- `paneLeftN` -- additional left column panes (N = 2, 3, ...)
- `paneRightN` -- additional right column panes (N = 2, 3, ...)

**Command sending:**
- Only send commands for non-empty command strings
- For server pane with `hasServer: true` and `serverCommand: null`, don't send any command (plain shell)
- For server pane with a custom command, send it

**Edge cases:**
- `minimal` preset (1 pane, no server): only root + sidebar, no right column
- Empty editor string: don't send command to editor panes
- Empty sidebar string: don't send command to sidebar

### `src/script.test.ts`

Test the pure function by verifying the generated AppleScript string contains expected elements:

```pseudo
describe("generateAppleScript")
  test("generates valid AppleScript structure")
    -- Contains "tell application \"Ghostty\""
    -- Contains "new surface configuration"
    -- Contains "new window"
    -- Contains "end tell"

  test("sets working directory")
    -- Contains the target directory path

  test("full preset creates correct splits")
    -- Contains 1 sidebar split (direction right)
    -- Contains 1 right column split (direction right)
    -- Contains left column vertical splits (direction down)
    -- Contains right column vertical splits (direction down)
    -- Contains commands for 3 editor panes + sidebar + server area

  test("minimal preset creates minimal splits")
    -- Contains sidebar split only
    -- No right column split
    -- No vertical splits

  test("pair preset creates correct splits")
    -- Sidebar + right column + server split

  test("sends editor command to editor panes")
    -- Contains: input text "claude" to paneRoot
    -- Contains: send key "enter" to paneRoot

  test("sends sidebar command")
    -- Contains: input text "lazygit" to paneSidebar

  test("sends custom server command")
    -- plan with serverCommand = "npm run dev"
    -- Contains: input text "npm run dev" to server pane

  test("skips command for plain shell server")
    -- plan with hasServer true, serverCommand null
    -- No input text to server pane

  test("skips command for empty editor")
    -- plan with editor = ""
    -- No input text to editor panes

  test("mtop preset uses secondary editor in right column")
    -- Right column editor panes get "mtop" command
    -- Left column panes get primary editor command

  test("focuses root pane")
    -- Contains: focus paneRoot
```

## Success Criteria

### Automated
- [x] `pnpm typecheck` -- no errors
- [x] `pnpm lint` -- no errors
- [x] `pnpm test` -- all script tests pass
- [x] Generated AppleScript is syntactically valid (verified by structure checks in tests)

### Manual
None for this phase. The generated script will be tested against real Ghostty in Phase 5.
