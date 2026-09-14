#!/usr/bin/env bash
# Portable PreToolUse adapter. Intentionally fail-closed for guarded events.
# This replaces v1's fail-open/jq parser. Exit 2 + stderr denies the operation;
# exit 0 emits no native allow decision and cannot manufacture user consent.
# Claude: bash guard-bash.sh. Codex: bash guard-bash.sh codex.
set -uo pipefail

rpi_harness=${1:-claude}
case "$rpi_harness" in
  claude|codex) ;;
  *) printf '%s\n' 'BLOCKED / WHY: unsupported hook adapter. / FIX: invoke guard-bash.sh with claude or codex.' >&2; exit 2 ;;
esac
if ! command -v python3 >/dev/null 2>&1; then
  if [[ ${OSTYPE:-} == darwin* ]]; then
    rpi_repair='brew install python'
  else
    rpi_repair='sudo apt-get install python3'
  fi
  printf 'BLOCKED / WHY: Python 3 is required by the policy adapter. / FIX: %s\n' "$rpi_repair" >&2
  exit 2
fi
if ! python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
  printf '%s\n' 'BLOCKED / WHY: the policy adapter requires Python 3.11 or newer. / FIX: uv python install 3.13; launch the client through uv run --python 3.13 so its hooks use the supported runtime.' >&2
  exit 2
fi
rpi_hook_dir=${BASH_SOURCE[0]%/*}
rpi_engine="$rpi_hook_dir/../scripts/rpi-policy.py"
if [[ ! -f "$rpi_engine" ]]; then
  rpi_engine="$rpi_hook_dir/../../.rpi/scripts/rpi-policy.py"
fi
if [[ ! -f "$rpi_engine" ]]; then
  printf '%s\n' 'BLOCKED / WHY: the declared rpi-policy.py dependency is missing. / FIX: run bash scripts/install.sh --check in the cc-rpi source checkout, then review and apply an update plan for this target.' >&2
  exit 2
fi
exec python3 "$rpi_engine" --harness "$rpi_harness"
