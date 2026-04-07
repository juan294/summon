#!/usr/bin/env bash
# commit-reports.sh — commits all agent reports in docs/agents/ to git.
# Runs nightly at 10:30 after all agents have completed.
# Uses --no-verify: only docs/agents/*.md are staged (markdown-only, no code).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "$(git status --short docs/agents/ 2>/dev/null)" ]; then
    echo "[commit-reports] No changes in docs/agents/ — nothing to commit"
    exit 0
fi

DATE="$(date +%Y-%m-%d)"
git add docs/agents/
git commit --no-verify -m "chore(agents): update reports ${DATE}"
echo "[commit-reports] Committed agent reports for ${DATE}"
