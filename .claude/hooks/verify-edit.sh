#!/usr/bin/env bash
# verify-edit.sh — PostToolUse hook for Write/Edit on markdown files.
#
# Post-action verification: a deterministic check that runs AFTER an edit lands
# and surfaces violations back to the agent so it fixes them immediately, instead
# of waiting for CI. Realizes "Level 1: Editor-time" from
# methodology/ci-and-guardrails.md for the Claude Code harness.
#
# Location: .claude/hooks/verify-edit.sh (in projects)
# Config:   .claude/settings.json → hooks.PostToolUse (matcher "Write|Edit")
# Input:    JSON on stdin: { "tool_name": "...", "tool_input": { "file_path": "..." } }
# Output:   exit 0 = ok, exit 2 = surface the corrective hint to the agent.
#
# NOTE: PostToolUse cannot prevent the write — the edit already landed. exit 2
# feeds the hint to the agent as "fix this now". The hard gate stays CI/pre-commit.
#
# Checks:
#   1. No emojis in docs (always on; per-file opt-out via <!-- contract:allow-emoji -->)
#   2. markdownlint — ONLY when the project ships a markdownlint config (otherwise
#      default rules flood false positives on repos that never opted into linting).

# Fail-open by design — see guard-bash.sh. Any tooling gap → allow through.
set -uo pipefail

# emit_block <reason> <why> <fix> — corrective-hint convention (BLOCKED/WHY/FIX).
emit_block() {
  printf 'BLOCKED by verify-edit.sh — %s\n\nWHY: %s\n\nFIX:\n%s\n' "$1" "$2" "$3"
}

# log_event <decision> <rule> <file> — append-only contract-metrics telemetry.
# One JSONL row per evaluated edit so the contract layer's impact can be measured
# over time (see templates/scripts/contract-metrics.py). Fail-open: any error here
# is swallowed — telemetry must never break a hook. Never logs file contents.
log_event() {
  {
    local dir="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/metrics"
    mkdir -p "$dir" 2>/dev/null || return 0
    local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || return 0
    jq -cn --arg ts "$ts" --arg sid "${SESSION_ID:-}" --arg hook "verify-edit" \
      --arg dec "$1" --arg rule "$2" --arg file "${3:-}" \
      '{ts:$ts,session_id:$sid,hook:$hook,decision:$dec,rule:$rule,file:$file}' \
      >> "$dir/contract-events.jsonl" 2>/dev/null
  } || true
}

command -v jq &>/dev/null || exit 0

read -r -d '' INPUT || true
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# Only Write/Edit on markdown files.
[[ "$TOOL" == "Write" || "$TOOL" == "Edit" ]] || exit 0
[[ "$FILE" == *.md ]] || exit 0
[[ -f "$FILE" ]] || exit 0


# ─── Check 1: emoji in documentation ──────────────────────────────────────
# Per-file opt-out for files that must show an emoji as a literal example.
if ! grep -q 'contract:allow-emoji' "$FILE" 2>/dev/null && command -v perl &>/dev/null; then
  # Ranges target true emoji/pictographs. Deliberately EXCLUDE arrows
  # (U+2190-21FF, e.g. →), em-dash (U+2014), and box-drawing (U+2500-257F),
  # all of which cc-rpi docs use legitimately.
  HITS=$(perl -CSD -ne \
    'while (/([\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}])/g) {
       printf "    line %d: U+%04X\n", $., ord($1) }' "$FILE" 2>/dev/null)
  if [[ -n "$HITS" ]]; then
    emit_block "no emojis in documentation" \
      "Project policy: docs use text equivalents (PASS, [x], ->), not emoji." \
      "  Remove the emoji at:
$HITS
  (Only if a glyph is a required literal example, add a line containing
  <!-- contract:allow-emoji --> to this file to skip this check.)"
    log_event block emoji "$FILE"
    exit 2
  fi
fi


# ─── Check 2: markdownlint (config-gated) ─────────────────────────────────
MDL_CONFIG=""
for c in .markdownlint.json .markdownlint.jsonc .markdownlint.yaml .markdownlint.yml .markdownlintrc; do
  [[ -f "$c" ]] && MDL_CONFIG="$c" && break
done
# Probe that markdownlint actually runs — otherwise a "tool not found" exit
# would be misread as lint violations and falsely block. Fail-open if absent.
if [[ -n "$MDL_CONFIG" ]] && command -v npx &>/dev/null \
   && npx --no-install markdownlint --version &>/dev/null; then
  if ! LINT=$(npx --no-install markdownlint "$FILE" 2>&1); then
    NL=$'\n'
    emit_block "markdownlint violations" \
      "Lint errors fail CI; fix them at edit time, not at push." \
      "    ${LINT//$NL/$NL    }"
    log_event block markdownlint "$FILE"
    exit 2
  fi
fi


log_event allow none "$FILE"
exit 0
