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
#   timers        Was 29 cases times 2 objects -- a pending 60-second timer and
#                 the callback it had not run. The note here said "not a leak",
#                 which was true and was not a separation: a pending timer is
#                 the *host's* state, and the check claims to measure what the
#                 program still holds. The driver now drains the host before it
#                 measures, so the number means what it says and this is 0.
#
# Both stay listed rather than excused: the check cannot tell state a program
# still needs from state it has lost, and a *change* in either number is worth
# stopping for even though the numbers themselves are correct.
#
# Five others were here and are not. `captured-by-reference` was a frame object
# whose fields nobody gave back; `arith`, `strings` and `signatures` were the
# differential's own driver keeping every string argument it built.
#
# `module-state` was the fifth, and it was not a baseline artifact after all --
# the note here said it was. `let history: number[] = []` at module scope had
# its initializer *refused* and silently dropped, so the array first appeared
# when `replaced` ran: one object more at the end than after the first case,
# exactly as a leak looks. Initializing it where the source says to made the
# count stable, and the explanation written here for two months was wrong.
#
# One example was passing this check while segfaulting on every case:
# `map-and-set`. The driver crashed before flushing a line, so the run had
# nothing to compare and `agreed()` did not ask whether anything had been
# checked. It does now, which is what surfaced `nts_map_set` handing back the
# table without retaining it.
known_failing=""

crowded=8
cores=$( { command -v nproc >/dev/null && nproc; } || echo 4 )
jobs=${NTS_GATE_JOBS:-$( [ "$cores" -lt "$crowded" ] && echo "$cores" || echo "$crowded" )}

results=$(mktemp)
trap 'rm -f "$results"' EXIT

NTS_RC=1 ls examples/*/tsconfig.json | NTS_RC=1 xargs -P "$jobs" -n 1 sh -c '
  d=$1
  n=$(basename "$(dirname "$d")")
  case "$n" in
    invalid|unsupported)
      # Fixtures that must *refuse* something, asked exactly as `gate.sh` asks
      # it. Listing them as "known failing under reference counting" said
      # nothing about reference counting: one does not typecheck and the other
      # is a refused construct, and neither would pass under any provider.
      #
      # Not "must fail to compile" -- see `gate.sh` for why that inversion was
      # satisfied by the node parser rather than by the compiler. (No
      # apostrophes in this block: it is the body of `sh -c` inside single
      # quotes, and one closes the string. The comment fifteen lines up says so,
      # and I wrote `node` with an apostrophe anyway.)
      if NTS_RC=1 ./target/release/nts check "$d" 2>&1 | grep -q "refused:\|does not typecheck"
        then echo "ok   $n (not an oracle case)"
        else echo "DIS  $n (refused nothing)"
      fi ;;
    *)
      # An example with nothing for the differential to drive exits 0 without
      # comparing an answer, so counting it as a pass overstates this number
      # exactly as it overstated the one in gate.sh.
      #
      # No apostrophes in here: this whole block is the body of `sh -c` inside
      # single quotes, and one closes the string.
      out=$(NTS_RC=1 ./target/release/nts check "$d" 2>&1)
      if [ $? -ne 0 ]
        then echo "DIS  $n"
      elif [ "${out#*nothing to check}" != "$out" ]
        then echo "bare $n"
        else echo "ok   $n"
      fi ;;
  esac
' _ > "$results"

failing=$(grep '^DIS' "$results" | awk '{print $2}' | sort | tr '\n' ' ')
# Guarded: `printf '%s\n'` with no arguments still prints a newline, so an
# empty list would compare as " " against an empty result.
expected=""
[ -n "$known_failing" ] && expected=$(printf '%s\n' $known_failing | sort | tr '\n' ' ')
bare=$(grep -c '^bare' "$results" || true)
echo "$(grep -c '^ok' "$results" || true) of $(($(grep -c . "$results") - bare)) pass under reference counting"
[ "$bare" -gt 0 ] && echo "  $bare compared nothing"
if [ "$failing" != "$expected" ]; then
  echo "  expected these to fail: $expected"
  echo "  actually failing:       $failing"
  exit 1
fi
[ -n "$expected" ] && echo "  known failing: $expected"
exit 0
