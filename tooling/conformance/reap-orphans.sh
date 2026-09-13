#!/usr/bin/env bash
# Kill node test processes that have been orphaned to PPID 1.
#
#   tooling/conformance/reap-orphans.sh [--dry-run]
#
# # Why this exists
#
# A test that is *waiting* rather than failing does not stop when the runner gives
# up on it. `execFileSync`'s timeout signals the direct child -- `run-one.mjs` --
# and every node process that child had spawned is reparented to init and keeps
# its memory. Idle, so no core is burning and nothing draws attention to it.
#
# Measured on 2026-09-13, after one deliberately broken handshake and a day of
# lanes: **459 orphaned drivers, roughly 25 hours old, holding 34 GB of RSS.**
# Available memory came back to 21 GB and load fell 7.65 -> 3.00 when they went.
# `NTS_CONFORMANCE_TIMEOUT_MS` reduces how many get made; nothing reaped the ones
# already made, and at PPID 1 they outlive every session that could have.
#
# # Why PPID 1 and not a name
#
# Three sessions share this box and run these same files concurrently. A pattern
# match on `run-one.mjs` or `test-cluster-` would kill a peer's live test, and
# `pgrep -f` additionally matches the pattern's own command line. **PPID 1 is the
# whole of the safety argument**: a live runner's children have a live parent, so
# they cannot be selected, and anything selected has no parent to report to.
set -uo pipefail
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

# `ps` rather than `pgrep`, because the parent pid is the selector and pgrep
# cannot express it. Fields: pid, ppid, rss(KiB), command.
mapfile -t victims < <(
  ps -eo pid=,ppid=,rss=,args= |
    awk '$2 == 1 && /node/ && (/conformance\/run-one\.mjs/ || /third_party\/node\/test\// || /cp-work\/third_party\/node\/test\//) { print }'
)

if [ "${#victims[@]}" -eq 0 ]; then
  echo "no orphaned node test processes"
  exit 0
fi

rss=0
for line in "${victims[@]}"; do
  kb=$(printf '%s\n' "$line" | awk '{print $3}')
  rss=$((rss + kb))
done
printf '%s orphaned node test process(es), %s MiB resident\n' \
  "${#victims[@]}" "$((rss / 1024))"

if [ "$dry" -eq 1 ]; then
  printf '%s\n' "${victims[@]}" | head -10 | sed 's/^/  /'
  [ "${#victims[@]}" -gt 10 ] && echo "  ... and $(( ${#victims[@]} - 10 )) more"
  exit 0
fi

for line in "${victims[@]}"; do
  pid=$(printf '%s\n' "$line" | awk '{print $1}')
  # SIGKILL, not SIGTERM: these are already unreachable by the thing that would
  # have asked them politely, and a handler that waits is what made them.
  kill -9 "$pid" 2>/dev/null || true
done
echo "reaped"
