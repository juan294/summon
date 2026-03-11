#!/bin/bash
# scripts/agents/cc-rpi-update.sh
#
# Scheduled agent that syncs this project with the latest cc-rpi blueprint.
# Designed to run nightly via launchd (macOS) or cron (Linux).
#
# The key trick: this script reads the update instructions from cc-rpi itself
# at runtime. When cc-rpi improves the /update command, all projects
# automatically get the new logic on the next scheduled run.
#
# ── Setup ──
#
# 1. Copy this script to your project: scripts/agents/cc-rpi-update.sh
# 2. Set CC_RPI_PATH below to your cc-rpi clone location
# 3. Make executable: chmod +x scripts/agents/cc-rpi-update.sh
# 4. Create required directories: mkdir -p docs/agents logs
# 5. Schedule with launchd or cron (see examples below)
#
# ── macOS launchd ──
#
#   Create ~/Library/LaunchAgents/com.summon.agent.cc-rpi-update.plist:
#
#   <?xml version="1.0" encoding="UTF-8"?>
#   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
#     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
#   <plist version="1.0">
#   <dict>
#     <key>Label</key>
#     <string>com.summon.agent.cc-rpi-update</string>
#     <key>ProgramArguments</key>
#     <array>
#       <string>/bin/bash</string>
#       <string>-c</string>
#       <string>exec /bin/bash /Users/juan/Documents/code/summon/scripts/agents/cc-rpi-update.sh</string>
#     </array>
#     <key>StartCalendarInterval</key>
#     <dict>
#       <key>Hour</key>
#       <integer>3</integer>
#       <key>Minute</key>
#       <integer>0</integer>
#     </dict>
#     <key>HardResourceLimits</key>
#     <dict>
#       <key>NumberOfFiles</key>
#       <integer>122880</integer>
#     </dict>
#     <key>SoftResourceLimits</key>
#     <dict>
#       <key>NumberOfFiles</key>
#       <integer>122880</integer>
#     </dict>
#     <key>EnvironmentVariables</key>
#     <dict>
#       <key>HOME</key>
#       <string>/Users/juan</string>
#       <key>TERM</key>
#       <string>xterm-256color</string>
#       <key>PATH</key>
#       <string>/usr/local/bin:/opt/homebrew/bin:/Users/juan/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
#     </dict>
#     <key>StandardOutPath</key>
#     <string>/Users/juan/Documents/code/summon/logs/cc-rpi-update.log</string>
#     <key>StandardErrorPath</key>
#     <string>/Users/juan/Documents/code/summon/logs/cc-rpi-update.error.log</string>
#   </dict>
#   </plist>
#
#   One-time setup (run interactively before scheduling):
#     claude setup-token
#
#   Install: launchctl load ~/Library/LaunchAgents/com.summon.agent.cc-rpi-update.plist
#   Test:    launchctl start com.summon.agent.cc-rpi-update
#   Remove:  launchctl unload ~/Library/LaunchAgents/com.summon.agent.cc-rpi-update.plist
#
# ── Linux cron ──
#
#   # Run nightly at 3:00 AM:
#   0 3 * * * /Users/juan/Documents/code/summon/scripts/agents/cc-rpi-update.sh \
#     >> /Users/juan/Documents/code/summon/logs/cc-rpi-update.log 2>&1
#

set -euo pipefail

# ── Configuration ──
CC_RPI_PATH="/Users/juan/Documents/code/cc-rpi"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"

# ── Environment setup (required for launchd) ──
export HOME="${HOME:-$(eval echo ~"$(whoami)")}"
export TERM="${TERM:-xterm-256color}"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

AGENT_NAME="cc-rpi-update"
REPORT_FILE="docs/agents/${AGENT_NAME}-report.md"
UPDATE_INSTRUCTIONS="$CC_RPI_PATH/templates/commands/update.md"

# ── File descriptor check ──
ulimit -n 122880 2>/dev/null
FD_LIMIT=$(ulimit -n)
if [ "$FD_LIMIT" -lt 10000 ]; then
  echo "[$(date)] FATAL: File descriptor limit too low ($FD_LIMIT)."
  echo "  launchd hard limit is 256 by default — ulimit can't raise above it."
  echo "  Fix: Add HardResourceLimits + SoftResourceLimits to your .plist:"
  echo "    <key>HardResourceLimits</key>"
  echo "    <dict><key>NumberOfFiles</key><integer>122880</integer></dict>"
  echo "    <key>SoftResourceLimits</key>"
  echo "    <dict><key>NumberOfFiles</key><integer>122880</integer></dict>"
  echo "  Then: launchctl unload + load the plist to apply."
  exit 1
fi

# ── Preflight checks ──

if [ ! -d "$CC_RPI_PATH" ]; then
  echo "[$(date)] ERROR: cc-rpi not found at $CC_RPI_PATH"
  exit 1
fi

if [ ! -f "$UPDATE_INSTRUCTIONS" ]; then
  echo "[$(date)] ERROR: Update command not found at $UPDATE_INSTRUCTIONS"
  exit 1
fi

if [ ! -x "$CLAUDE_BIN" ]; then
  echo "[$(date)] ERROR: claude binary not found at $CLAUDE_BIN"
  echo "[$(date)] Set CLAUDE_BIN in this script or export it as an env var."
  echo "[$(date)] Common locations: \$HOME/.local/bin/claude, /usr/local/bin/claude"
  exit 1
fi

# ── Authentication preflight ──
if ! "$CLAUDE_BIN" -p "echo ok" --output-format text >/dev/null 2>&1; then
  echo "[$(date)] FATAL: Claude CLI auth failed in non-interactive mode."
  echo "  launchd has no TTY/browser — interactive OAuth won't work."
  echo "  Fix: Run 'claude setup-token' from an interactive terminal first."
  exit 1
fi

# ── Build the prompt ──

PROMPT="You are the cc-rpi-update scheduled agent for this project.

Your job: sync this project with the latest cc-rpi blueprint.

Read and follow the instructions in: $UPDATE_INSTRUCTIONS

Important context:
- The cc-rpi blueprint is at: $CC_RPI_PATH
- This project is at: $PROJECT_ROOT
- Apply all updates non-interactively. Do not ask for confirmation.
- Commit changes when done.
- Write your final summary as your text output (it becomes the report).

If there are no changes needed, just output: 'cc-rpi sync: already up to date as of <version>.'"

# ── Run with retry ──

MAX_RETRIES=2
RETRY_COUNT=0

cd "$PROJECT_ROOT"
echo "[$(date)] Starting $AGENT_NAME agent..."
echo "[$(date)] Project: $PROJECT_ROOT"
echo "[$(date)] Blueprint: $CC_RPI_PATH"

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if "$CLAUDE_BIN" -p "$PROMPT" \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash(git *)" \
    --output-format text \
    > "$REPORT_FILE" 2>&1; then
    echo "[$(date)] $AGENT_NAME complete. Report: $REPORT_FILE"
    exit 0
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "[$(date)] Attempt $RETRY_COUNT failed. Retrying in 10s..."
  sleep 10
done

echo "[$(date)] $AGENT_NAME FAILED after $MAX_RETRIES attempts" | tee -a "$REPORT_FILE"
exit 1
