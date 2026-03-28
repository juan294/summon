# Detach Project from cc-rpi Blueprint

You are cleanly removing cc-rpi artifacts from this project. The blueprint lives at `<path-to-your-cc-rpi-clone>/`.

This command removes all blueprint-managed files and configuration while preserving project-specific content and user work products.

## Phase 1: Verify Adoption

1. Check for `.claude/cc-rpi-sync.json` or RPI commands in `.claude/commands/` (research.md, plan.md, implement.md, validate.md).
2. If neither exists: report "This project doesn't appear to use cc-rpi. Nothing to detach." and **stop**.
3. If sync metadata exists, read it and report the current blueprint version and last sync date.

## Phase 2: Inventory Artifacts

Scan this project for all cc-rpi artifacts. Categorize each into one of four tiers.

### Tier 1: Blueprint scaffolding (always remove)

Check for these files and note which exist:

- `.claude/commands/research.md`
- `.claude/commands/plan.md`
- `.claude/commands/implement.md`
- `.claude/commands/validate.md`
- `.claude/commands/describe-pr.md`
- `.claude/commands/pre-launch.md`
- `.claude/commands/status.md`
- `.claude/commands/fix-ci.md`
- `.claude/hooks/guard-bash.sh`
- `.claude/cc-rpi-sync.json`
- `scripts/agents/cc-rpi-update.sh` (nightly sync agent, if exists)

For each command file that exists, diff it against `<cc-rpi-path>/templates/commands/<name>` to detect customization. Mark as "unmodified" or "customized."

For `guard-bash.sh`, check if content exists below the `# Project-specific guards below this line` marker. If so, mark as "customized."

### Tier 2: Blueprint-managed CLAUDE.md sections

Read the project's CLAUDE.md (or AGENTS.md for copilot-rpi projects) and identify these blueprint-managed sections by their `##` or `###` headers:

- `## RPI Workflow` (including all `###` subsections under it)
- `## Working Patterns` (including `<examples>` blocks under it)
- `## TDD Protocol`
- `## Agent Autonomy`
- `## Memory Management`
- `## Project File Locations`
- `<important if>` blocks: Push Accountability, Deployment Safety, Supabase sections

Note which sections exist. Do NOT touch any other sections -- they are project-specific.

### Tier 3: Configuration entries

Read `.claude/settings.json` and identify:

- `hooks.PreToolUse` entries referencing `guard-bash.sh` -- will remove
- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` -- will flag for user decision
- All other entries (permissions, project-specific hooks, other env vars) -- will keep

Check for a launchd plist for the cc-rpi update agent:

- `~/Library/LaunchAgents/*cc-rpi*` or `~/Library/LaunchAgents/*blueprint*`

### Tier 4: User work products

Check for and count files in:

- `docs/research/` -- research documents
- `docs/plans/` -- implementation plans
- `docs/decisions/` -- architecture decision records
- `docs/agents/` -- agent reports
- `logs/` -- agent logs

These are the user's intellectual work. Default is to **keep** them.

## Phase 3: Preview Report

Present the full inventory to the user:

```text
== Detach Preview ==

Blueprint version: <version> (synced <date>)

WILL REMOVE (blueprint scaffolding):
  [list each Tier 1 file that exists, with "unmodified" or "customized" tag]

WILL EDIT (CLAUDE.md):
  Remove sections: [list each Tier 2 section found]
  Keep sections: [list remaining sections]

WILL CLEAN (settings.json):
  Remove: [list Tier 3 entries to remove]
  Keep: [list what stays]

WILL KEEP (your work):
  [list Tier 4 directories with file counts, or "none found"]

CUSTOMIZED FILES (review recommended):
  [for each customized file, explain what custom content will be lost
   and suggest where to move it]
```

If no customized files exist, omit the CUSTOMIZED FILES section.

## Phase 4: Confirm and Execute

Ask the user three questions:

1. **"Proceed with detach?"** -- required. If no, stop.
2. **"Remove research docs and plans too?"** -- default: no. Only remove Tier 4 if user explicitly says yes.
3. **"Keep Agent Teams enabled?"** -- if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` exists. Default: keep.

For any customized files, ask: **"Keep [filename] as a custom command/hook?"** If yes, skip that file.

Then execute in order:

1. Delete Tier 1 files (skip any the user chose to keep).
2. Edit CLAUDE.md to remove Tier 2 sections. Remove each section from its `##` header through to the next `##` header (or end of file). For the `### CRITICAL` subsection, remove only that subsection, not the parent `## Key Commands`.
3. Clean Tier 3 configuration:
   - Remove the `PreToolUse` hook entry for guard-bash.sh from `.claude/settings.json`. If no other hooks remain, remove the entire `hooks` key.
   - Remove `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` from `env` if user chose to remove it. If no other env vars remain, remove the entire `env` key.
4. Handle Tier 4 per user decision (keep by default).
5. Clean up empty directories: remove `.claude/commands/` if empty, `.claude/hooks/` if empty. Do NOT remove `.claude/` itself or `.claude/settings.json`.
6. If a launchd plist was found: `launchctl unload <plist>` then delete the plist file. Ask before this step.

## Phase 5: Commit

Stage all changes and create a single atomic commit:

```text
chore: detach from cc-rpi blueprint

Removed RPI methodology commands, hooks, CLAUDE.md blueprint sections,
and sync metadata. Project-specific configuration preserved.
```

## Phase 6: Report

Present the final summary:

```text
== Detach Complete ==

Removed: [N] files, [N] CLAUDE.md sections, [N] settings.json entries
Kept: [list preserved Tier 4 directories with counts, or "no work products found"]
Commit: [hash]

This project no longer syncs with cc-rpi. The slash commands, hooks,
and methodology sections have been removed. Your project configuration,
permissions, and work products are untouched.

To re-adopt later: run /adopt
```

## Rules for This Process

- **Preview before delete.** Never remove anything without showing the user what will happen first (Phase 3).
- **Preserve project identity.** Only remove blueprint-managed content. Everything project-specific stays.
- **Keep user work products by default.** Research docs, plans, and decisions are the user's work. Only remove if explicitly asked.
- **Flag customizations.** If a command or hook has been modified from the template, warn the user before deleting it.
- **One atomic commit.** All removals go in a single commit. Don't scatter across multiple commits.
- **Idempotent.** Running on a project without cc-rpi artifacts reports "nothing to detach" and stops. Running twice produces no changes the second time.
- **Don't touch Claude Code itself.** `.claude/` directory, `settings.json` (with remaining entries), and `settings.local.json` are Claude Code's own -- they exist independently of cc-rpi.
