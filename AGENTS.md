# Project: Summon

## Codex Compatibility

This project follows the cc-rpi methodology and is configured to work
with both Claude Code and Codex / GPT-5.x.

When operating in Codex, treat these files as the source of truth:

- `CLAUDE.md` -- project overview, workflow, commands, git/deploy context
- `.claude/commands/*.md` -- workflow definitions for `/research`, `/plan`,
  `/implement`, `/validate`, `/pre-launch`, `/update-docs`, `/release`,
  and related commands
- `.claude/rules/*.md` -- reusable rules and path-scoped constraints
- `.claude/skills/*/SKILL.md` -- on-demand skills and domain procedures

If the user says "make this Codex compatible", ensure this file exists
and is kept in sync with the compatibility conventions below.

## Command Dispatch

When the user invokes a slash-style workflow such as `/research`,
`/plan`, `/implement`, `/validate`, `/pre-launch`, `/update-docs`,
`/release`, `/fix-ci`, `/describe-pr`, or `/status`:

1. Check for the matching file in `.claude/commands/`.
2. Read that command file completely before acting.
3. Follow it as the workflow spec for this task.
4. Keep all outputs in the repo locations required by that command.

If the command file references a plan path or research path, read that
document fully before doing anything else.

## Claude-to-Codex Translation

The command files are written for Claude Code. In Codex, translate the
Claude-native parts to the closest equivalent behavior:

- `/simplify` -- run a dedicated post-implementation review for reuse,
  quality, and efficiency; use parallel agents when helpful
- `/batch` -- parallelize independent work with separate worktrees or
  isolated agents when the plan marks phases as `[batch-eligible]`
- `/worktree` or `EnterWorktree` -- perform implementation in an isolated
  git worktree or equivalent isolated workspace
- `Task` / `Explore` agents -- use Codex subagents or parallel research
  passes with the same role separation
- `AskUserQuestion` -- ask the user directly only when the codebase and
  docs cannot answer safely
- `/clear` and `/compact` -- treat as context-management guidance, not
  literal required commands

Preserve the methodology even when the harness differs.

## Rules Loading

Always follow `CLAUDE.md` and then load `.claude/rules/` like this:

- Always read `rpi-details.md` and `push-accountability.md` if present
- For other rule files with `paths` frontmatter, apply them when the
  files you are reading or editing match those path globs
- If a rule conflicts with a command file, the command file governs the
  workflow and the rule governs local constraints within that workflow

## Skills

Treat `.claude/skills/*/SKILL.md` as on-demand skills:

- Load a skill when the task matches its description
- Load a skill when a command or rule points to it
- Use the skill as supplemental instructions, not as a replacement for
  the command workflow

## Outputs and Gates

Preserve the standard cc-rpi artifact locations:

- `docs/research/` -- research documents
- `docs/plans/` -- implementation plans and phase files
- `docs/decisions/` -- ADRs and decision records
- `docs/agents/` -- local operational reports

Respect the phase gates:

- Stop after research and present the document
- Stop after the plan is finalized and reviewed
- Stop after each implementation phase unless the user explicitly says
  to continue

During research, follow the documentarian rule:
describe what exists; do not suggest improvements unless asked.

## Verification and Git

- Run the verification commands specified by the command file, the plan,
  or `CLAUDE.md`
- Keep verification sequential unless the workflow explicitly says work
  can be parallelized
- Preserve the project's git workflow exactly as described in
  `CLAUDE.md`
