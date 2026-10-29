#!/usr/bin/env bash
# Portable PreToolUse adapter for the destructive-operation denylist.
# Exit 2 + stderr denies the operation; exit 0 emits no native allow decision,
# so native permissions still decide. A missing runtime warns and passes
# through: an absent denylist must not block every shell command. The engine
# checks its own Python version, so no second interpreter starts per command.
# Claude: bash guard-bash.sh. Codex: bash guard-bash.sh codex.
set -uo pipefail

rpi_skip() {
  printf 'RPI POLICY SKIPPED: %s\n' "$1" >&2
  exit 0
}

rpi_harness=${1:-claude}
case "$rpi_harness" in
  claude|codex) ;;
  *) printf '%s\n' 'BLOCKED / WHY: unsupported hook adapter. / FIX: invoke guard-bash.sh with claude or codex.' >&2; exit 2 ;;
esac
# Prefer a supported interpreter over an older default python3 (macOS ships 3.9).
rpi_python=
for rpi_candidate in python3.14 python3.13 python3.12 python3.11 python3; do
  if command -v "$rpi_candidate" >/dev/null 2>&1; then
    rpi_python=$rpi_candidate
    break
  fi
done
if [[ -z $rpi_python ]]; then
  if [[ ${OSTYPE:-} == darwin* ]]; then
    rpi_skip 'Python 3 is required by the policy adapter. FIX: brew install python'
  fi
  rpi_skip 'Python 3 is required by the policy adapter. FIX: sudo apt-get install python3'
fi
rpi_hook_dir=${BASH_SOURCE[0]%/*}
rpi_engine="$rpi_hook_dir/../scripts/rpi-policy.py"
if [[ ! -f "$rpi_engine" ]]; then
  rpi_engine="$rpi_hook_dir/../../.rpi/scripts/rpi-policy.py"
fi
if [[ ! -f "$rpi_engine" ]]; then
  rpi_skip 'the declared rpi-policy.py dependency is missing. FIX: run python3 .rpi/scripts/rpi-distribution.py check --target . and apply a reviewed update.'
fi
exec "$rpi_python" "$rpi_engine" --harness "$rpi_harness"
