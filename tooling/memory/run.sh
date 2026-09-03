#!/usr/bin/env bash
# How much reference counting each shape costs, and how much of it is necessary.
#
# The benchmark suite measures *time*, which mixes counting with allocation and
# with the cache. This measures the counting alone, which is the thing an
# elision pass is trying to remove -- and it needs no quiet machine and no
# calibration, so it can run in seconds rather than in half an hour.
#
# Two measurements, each against a floor that is an argument rather than a
# number, and the arguments are the point:
#
#   naive   what a correctness-first implementation emits, from `NTS_RC_NAIVE=1`
#   actual  the reference-counting operations this compiler emits today
#   ideal   what a person can *justify* as necessary, written down in `expected`
#           beside the argument for it
#   alloc   heap allocations of every kind in the measured run
#   floor   the same, for allocation: `allocated` in `expected`
#
# Counting was the first question and is nearly answered. Allocation is the
# second and is untouched by any of it: `awfy-bounce` spends five counting
# operations in the whole program and makes a hundred objects an iteration, so
# no elision could ever have reached it. A suite whose cases are all at their
# floor on one column has stopped being a ratchet, which is why there are two.
#
# `actual / naive` is the ratio Lobster reports when it says it eliminates 95%
# of reference operations. `actual - ideal` is the work queue. Without the third
# number this is a measurement; with it, it is a claim that can be wrong.
#
# Both columns are now at their floor on every case, which is what the sentence
# above warned about, twice over. So the work queue is empty and neither column
# ratchets *upward* any more -- and being above a floor used to be a note, which
# meant neither ratcheted downward either: a case could double its allocations
# and this exited green with a number nobody read. Above a floor is now a
# failure. That gives the suite back the half of a ratchet it can still do,
# which is refusing a regression; the other half -- marking progress -- needs a
# question these two columns no longer ask, and there is not one here yet.
#
# What it costs: a case whose floor is an argument the compiler has not yet
# reached cannot be committed. That is the ratchet working rather than a defect
# in it -- `string-append` and `readonly-anchor` were both written above their
# floor and closed in the same sitting -- but it is a real constraint on the
# order the work has to happen in, so it is written down rather than discovered.
#
# And every count is paired with a leak check, because zero operations is
# trivially reachable and catastrophically wrong. A case that counts less and
# leaks fails. That check earned itself on its second day: `store-elsewhere`
# leaked one object per call, at every chain length above two, in a collector
# that had been green on every other suite -- and no count disagreed, because
# the counts balanced perfectly while one object was never freed.
#
# What is counted is *operations emitted*, not objects touched: a retain or a
# release of null is a call and a branch that ran, and proving a reference
# non-null is the compiler's job too. So these numbers are larger than the
# object graph, and they should be.
set -eu
cd "$(cd "$(dirname "$0")/../.." && pwd)"

NTS_TSGO=${NTS_TSGO:-$PWD/target/tsgo}
export NTS_TSGO
out=target/memory
mkdir -p "$out"

fail=0
printf '%-20s %7s %7s %7s %6s %7s %6s %6s   %s\n' \
  case naive actual ideal gone alloc floor cand ''

for dir in tooling/memory/cases/*/; do
  name=$(basename "$dir")

  measure() { # $1 = subdir, rest = arguments to `env`
    local where="$out/$name.$1"
    rm -rf "$where" && mkdir -p "$where"
    # `-u` and not `NTS_RC_NAIVE=`: an empty assignment still *sets* the
    # variable, and the compiler asks whether it is set. Setting it empty made
    # both halves of this measurement naive and the ratio a flat 1.00, which
    # reads exactly like an elision pass that does nothing.
    if ! env "${@:2}" ./target/release/nts emit-c "$dir/tsconfig.json" --out "$where" --rc \
         >/dev/null 2>&1; then
      echo "  $name: emit failed" >&2
      return 1
    fi
    # Every `.c` the emitter wrote, not a fixed pair: a case that converts case
    # gets `nts_unicode.c` beside the runtime, and one that does not still gets
    # exactly the two. Naming them here meant the first case to need a third
    # file reported "did not compile" with nothing saying which file was
    # missing.
    clang -O2 -I"$where" -o "$where/run" "$where"/*.c \
          tooling/memory/harness.c -DNTS_PROVIDER_RC -lm 2>/dev/null || {
      echo "  $name: did not compile" >&2
      return 1
    }
    # Not `"$where/run"` bare. A case whose program *crashes* used to fail this
    # function without saying anything, and the loop below then skipped it
    # entirely -- so `global-array` segfaulted on a null module global and the
    # report simply had one fewer row than the suite had cases. A missing row
    # is the quietest way a check can not happen.
    out=$("$where/run") || {
      echo "  $name: the program exited $? without reporting" >&2
      return 1
    }
    echo "$out"
  }

  # Every case directory gets a row, whatever happened to it.
  short() {
    printf '%-20s %7s %7s %7s %6s %7s %6s   %s\n' \
      "$name" "?" "?" "?" "--" "?" "?" "$1"
    fail=1
  }
  elided=$(measure elided -u NTS_RC_NAIVE) || { short "DID NOT RUN"; continue; }
  naive=$(measure naive NTS_RC_NAIVE=1) || { short "DID NOT RUN under NTS_RC_NAIVE"; continue; }

  read_num() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2; }
  a=$(( $(read_num "$elided" retains) + $(read_num "$elided" releases) ))
  n=$(( $(read_num "$naive" retains) + $(read_num "$naive" releases) ))
  leaked=$(read_num "$elided" leaked)
  answer=$(read_num "$elided" answer)
  naive_answer=$(read_num "$naive" answer)
  alloc=$(read_num "$elided" allocated)
  # The third counter, and the only one that is optional. A case says
  # `candidates N` in `expected` when it is *about* the cycle collector; the
  # rest say nothing and are not checked, because most of them would be
  # asserting a zero they never come near.
  cand=$(read_num "$elided" candidates)
  want_cand=$(grep '^candidates ' "$dir/expected" | awk '{print $2}')
  ideal=$(grep '^ideal ' "$dir/expected" | awk '{print $2}')
  floor=$(grep '^allocated ' "$dir/expected" | awk '{print $2}')

  note=""
  # Elision that changes the answer is not elision.
  [ "$answer" = "$naive_answer" ] || { note="ANSWER CHANGED: $naive_answer -> $answer"; fail=1; }
  [ "$leaked" = "0" ] || { note="LEAKED $leaked"; fail=1; }
  [ -n "$floor" ] || { note='no "allocated" line in expected'; fail=1; }
  # The two floors are not independent. Nothing on the frame has a count to
  # change, so an allocation floor of zero forces an operation floor of zero --
  # and six `expected` files said otherwise, because they were written when
  # every object in them was a heap object.
  [ -z "$note" ] && [ "$floor" = "0" ] && [ "$ideal" != "0" ] &&
    { note="expected contradicts itself: 0 allocations cannot need $ideal operations"; fail=1; }
  # Below a floor means the argument beside it is wrong, not the measurement.
  # Four ideals in this suite were too high before anyone noticed, and every one
  # was caught here rather than by reading them again.
  [ -z "$note" ] && [ "$a" -lt "$ideal" ] && { note="BELOW ideal -- the argument in expected is wrong"; fail=1; }
  [ -z "$note" ] && [ -n "$floor" ] && [ "$alloc" -lt "$floor" ] && { note="BELOW allocation floor -- the argument in expected is wrong"; fail=1; }
  if [ -z "$note" ]; then
    over=""
    [ "$a" -gt "$ideal" ] && over="$((a - ideal)) ops"
    [ -n "$floor" ] && [ "$alloc" -gt "$floor" ] && over="${over:+$over, }$((alloc - floor)) allocations"
    [ -n "$want_cand" ] && [ "$cand" -ne "$want_cand" ] &&
      over="${over:+$over, }$cand candidates against $want_cand"
    [ -n "$over" ] && { note="$over above"; fail=1; }
  fi

  ratio="--"
  [ "$n" -gt 0 ] && ratio=$(awk -v a="$a" -v n="$n" 'BEGIN { printf "%d%%", (n - a) * 100 / n }')
  printf '%-20s %7s %7s %7s %6s %7s %6s %6s   %s\n' \
    "$name" "$n" "$a" "$ideal" "$ratio" "$alloc" "$floor" "${want_cand:+$cand}" "$note"
done

if [ "$fail" -ne 0 ]; then
  printf '\n\033[31mFAILED\033[0m: memory\n'
  exit 1
fi
printf '\n\033[32mgreen\033[0m: nothing leaked, no answer changed, every case at both floors\n'
