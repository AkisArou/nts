#!/bin/sh
# Every example, compiled and run and compared against node.
#
#   tooling/gate/gate.sh           # all of them, in parallel
#   tooling/gate/gate.sh cycles    # one, with its output
#   NTS_GATE_JOBS=4 tooling/gate/gate.sh
#
# This is the correctness gate. The corpus in `nts-suite` checks that arbitrary
# input does not produce invalid IR, and the profile in `runtime/node` measures
# how much real code lowers -- neither of them runs anything. Only this compares
# an answer against node's, case by case, which is why a green run here is what
# "it works" means.
#
# Parallel because it is 73 independent subprocess trees and the feedback is
# worth having in two minutes rather than forty. Each `nts check` bounds its own
# children in time and memory -- see `MEMORY` in tooling/differential -- so the
# only thing to size here is how many run at once.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

[ -x target/release/nts ] || { echo "build first: cargo build --release"; exit 1; }
[ -e "${NTS_TSGO:-$root/target/tsgo}" ] || { echo "no tsgo: tooling/bootstrap/bootstrap.sh"; exit 1; }
NTS_TSGO=${NTS_TSGO:-$root/target/tsgo}
export NTS_TSGO

# One example, named on the command line: run it plainly so its output is the
# point rather than a tally.
if [ $# -gt 0 ]; then
  exec ./target/release/nts check "examples/$1/tsconfig.json"
fi

# Capped, not `nproc`. Every worker starts a frontend of its own, and enough of
# them at once kills one inside Go's collector: at 32 this reported 73 of 73 on
# one run and 72 on the next, with the odd one out passing in isolation. A gate
# that is fast and occasionally wrong is worth less than one that is slow and
# never is -- the same reason `CROWDED` exists in tooling/suite, and the same
# number.
crowded=8
cores=$( { command -v nproc >/dev/null && nproc; } || echo 4 )
jobs=${NTS_GATE_JOBS:-$( [ "$cores" -lt "$crowded" ] && echo "$cores" || echo "$crowded" )}

results=$(mktemp)
trap 'rm -f "$results"' EXIT

# Inline in `sh -c` rather than a shell function: `export -f` is a bashism and
# this runs under whatever /bin/sh is.
ls examples/*/tsconfig.json | xargs -P "$jobs" -n 1 sh -c '
  d=$1
  n=$(basename "$(dirname "$d")")
  case "$n" in
    invalid|unsupported)
      if ./target/release/nts check "$d" >/dev/null 2>&1
        then echo "DIS  $n (should not have passed)"
        else echo "ok   $n (not an oracle case)"
      fi ;;
    *)
      # Kept, not discarded: an example with no exported function taking and
      # returning scalars has nothing for the differential to drive, and
      # `nts check` says so and exits 0. Six of them did, and they counted
      # toward "91 of 91 agree with node" while agreeing about nothing.
      #
      # They are not failures -- `classes` holds an `enum` and `jsx` holds JSX,
      # and node will not run either, so there can be no oracle for them. They
      # are lowering fixtures, and the point is that the headline should not
      # call them agreements.
      out=$(./target/release/nts check "$d" 2>&1)
      if [ $? -ne 0 ]
        then echo "DIS  $n"
      elif [ "${out#*nothing to check}" != "$out" ]
        then echo "bare $n"
        else echo "ok   $n"
      fi ;;
  esac
' _ > "$results"

sort "$results" | grep '^DIS' || true
agreed=$(grep -c '^ok' "$results" || true)
bare=$(grep -c '^bare' "$results" || true)
total=$(grep -c . "$results" || true)
echo "$agreed of $((total - bare)) agree with node"
if [ "$bare" -gt 0 ]; then
  echo "  $bare compared nothing (no exported function with scalar arguments and a\
 scalar result):$(grep '^bare' "$results" | awk '{printf " %s", $2}')"
fi
[ "$agreed" = "$((total - bare))" ]
