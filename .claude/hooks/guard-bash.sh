#!/usr/bin/env bash
# guard-bash.sh — PreToolUse hook for Bash tool calls
# Blocks known-bad command patterns before they execute.
# Runs on every Bash tool call — keep guards fast.
#
# Location: .claude/hooks/guard-bash.sh (in projects)
# Config:   .claude/settings.json → hooks.PreToolUse
# Input:    JSON on stdin: { "tool_name": "Bash", "tool_input": { "command": "..." } }
# Output:   exit 0 = allow, exit 2 = block (stdout shown to agent as reason)
#
# Add project-specific guards at the bottom of this file.

# Intentionally no `set -e` — this script is fail-open by design.
# If any check fails unexpectedly (jq missing, git not in PATH, etc.),
# execution falls through to exit 0 and the command is allowed.
# A guard hook must never block legitimate work due to its own bugs.
set -uo pipefail

# Require jq for JSON parsing — allow through if unavailable
if ! command -v jq &>/dev/null; then
  exit 0
fi

read -r -d '' INPUT || true
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0

# Fast path: skip all guards for non-git commands (~90% of invocations)
[[ "$COMMAND" != *git* ]] && exit 0


# ─── Guard: git pull --rebase with uncommitted changes (Error #33) ────────
# The #1 most-repeated agent error (37% of all observed errors in one batch).
# Agent edits files, then runs git pull --rebase without committing first.
if [[ "$COMMAND" == *"git pull"* ]] && [[ "$COMMAND" == *"--rebase"* ]]; then
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "BLOCKED by guard-bash.sh — Error #33: uncommitted changes"
    echo ""
    echo "git pull --rebase will fail with a dirty working tree."
    echo "Commit or stash first, then pull:"
    echo ""
    echo "  git add <files> && git commit -m \"msg\""
    echo "  git pull --rebase && git push"
    exit 2
  fi
fi


# ─── Guards: git push risks (Error #44, Error #48) ───────────────────────
# Consolidated: both guards share the outer "git push" check.
if [[ "$COMMAND" == *"git push"* ]]; then

  # Error #44: --tags pushes ALL local tags, not just the new one.
  # Old tags that already exist on remote cause a non-zero exit code.
  if [[ "$COMMAND" == *"--tags"* ]] && [[ "$COMMAND" != *"--follow-tags"* ]]; then
    echo "BLOCKED by guard-bash.sh — Error #44: --tags pushes all local tags"
    echo ""
    echo "--tags pushes every tag, not just new ones. Old tags cause failures."
    echo "Push specific tags or use --follow-tags:"
    echo ""
    echo "  git push origin main && git push origin v1.0.0"
    echo "  git push origin main --follow-tags"
    exit 2
  fi

  # Error #48: direct push to main/master instead of a non-production path.
  # Matches "main" or "master" anywhere in the push args (handles flags like -u
  # appearing before the remote name: git push -u origin main).
  # Allows --follow-tags (release flow).
  if [[ "$COMMAND" =~ (^|[[:space:]])(main|master)($|[[:space:]]|:) ]] \
     && [[ "$COMMAND" != *"--follow-tags"* ]]; then
    echo "BLOCKED by guard-bash.sh — Error #48: direct push to protected branch"
    echo ""
    echo "Pushing directly to main/master is a high-stakes action."
    echo "If this is intentional (e.g., a release), ask the user first."
    echo ""
    echo "For normal development, push to a non-production branch, for example:"
    echo "  git push origin develop                 # develop/main topology"
    echo "  git push -u origin feature/my-change    # main-only or PR flow"
    echo ""
    echo "For releases with tags:"
    echo "  git push origin main --follow-tags"
    exit 2
  fi

fi


# ─── Project-specific guards below this line ──────────────────────────────

# Example: block bare python3 (uncomment for Python/uv projects)
# if [[ "$COMMAND" =~ ^python3?[[:space:]] ]] && [[ "$COMMAND" != *"uv run"* ]] && [[ "$COMMAND" != *"poetry run"* ]]; then
#   echo "BLOCKED — use 'uv run python' instead of bare 'python3'"
#   echo "System Python doesn't have project dependencies."
#   exit 2
# fi


exit 0
