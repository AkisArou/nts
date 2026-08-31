#!/usr/bin/env bash
# Every example again, with reference counting on both halves.
#
# The retains and releases in the emitted C are the compiler's own work, and
# until this existed nothing ran them. `NTS_PROVIDER_RC` appeared only in
# hand-written runtime suites; every compiled example ran under the bump
# allocator, where nothing is freed -- so a release too few leaks where nobody
# looks and a release too many is never observed.
#
# Both halves are selected together. The provider decides what the *compiler*
# emits, not only what the runtime does with it, and choosing one without the
# other compares a program that never releases against an allocator that
# expects it to. `NTS_RC=1` in the differential sets both.
set -eu
cd "$(cd "$(dirname "$0")/../.." && pwd)"

# Known to fail, and each for a stated reason. The list is a ratchet: a new
# failure breaks the gate, and fixing one of these tightens it.
#
# `invalid` and `unsupported` are not oracle cases under any provider: one does
# not typecheck and the other refuses on purpose.
#
# The other two hold objects they never give back, which the run measures: the
# driver records what is live after the first case and again at the end, forcing
# a collection at both so that what is merely awaiting the cycle collector is not
# counted as held. Growth between the two is a leak.
#
#   module-state  one object, appearing after the first case. Plausibly a module
#                 global assigned on a later case and legitimately kept, which is
#                 exactly why the baseline is taken after the first case and not
#                 before it -- but it has not been shown, so it is listed.
#   timers        fifty-eight. Pending timers hold their callbacks, and a timer
#                 that never fires holds one at exit. Not yet separated from a
#                 real leak.
#
# Four others were here and are not: `captured-by-reference` was a frame object
# whose fields nobody gave back, and `arith`, `strings` and `signatures` were
# this driver keeping every string argument it built.
known_failing="invalid module-state timers unsupported"

crowded=8
cores=$( { command -v nproc >/dev/null && nproc; } || echo 4 )
jobs=${NTS_GATE_JOBS:-$( [ "$cores" -lt "$crowded" ] && echo "$cores" || echo "$crowded" )}

results=$(mktemp)
trap 'rm -f "$results"' EXIT

NTS_RC=1 ls examples/*/tsconfig.json | NTS_RC=1 xargs -P "$jobs" -n 1 sh -c '
  d=$1
  n=$(basename "$(dirname "$d")")
  if NTS_RC=1 ./target/release/nts check "$d" >/dev/null 2>&1
    then echo "ok   $n"
    else echo "DIS  $n"
  fi
' _ > "$results"

failing=$(grep '^DIS' "$results" | awk '{print $2}' | sort | tr '\n' ' ')
expected=$(printf '%s\n' $known_failing | sort | tr '\n' ' ')
echo "$(grep -c '^ok' "$results" || true) of $(grep -c . "$results") pass under reference counting"
if [ "$failing" != "$expected" ]; then
  echo "  expected these to fail: $expected"
  echo "  actually failing:       $failing"
  exit 1
fi
echo "  known failing: $expected"
