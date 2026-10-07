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

# **One case per process, several at once.** Each case writes only under its own
# `target/memory/<case>.*` and the two measurements in a case are compiled from
# scratch at -O2 -- seventy cases, 140 full runtime compiles -- so the loop was
# the whole of this step's four to five minutes and the cases share nothing.
# `--case <dir>` measures one and prints its row; the rows are printed in case
# order afterwards, so the table reads as it did.
if [ "${1-}" = --case ]; then
  dir=$2
  fail=0
  one_case() {
    name=$(basename "$dir")

    measure() { # $1 = subdir, rest = arguments to `env`
      local where="$out/$name.$1"
      rm -rf "$where" && mkdir -p "$where"
      # `-u` and not `NTS_RC_NAIVE=`: an empty assignment still *sets* the
      # variable, and the compiler asks whether it is set. Setting it empty made
      # both halves of this measurement naive and the ratio a flat 1.00, which
      # reads exactly like an elision pass that does nothing.
      if ! env "${@:2}" "${NTS_BIN:-./target/release/nts}" emit-c "$dir/tsconfig.json" --out "$where" --rc \
           >/dev/null 2>&1; then
        echo "  $name: emit failed" >&2
        return 1
      fi
      # Every `.c` the emitter wrote, not a fixed pair: a case that converts case
      # gets `nts_unicode.c` beside the runtime, and one that does not still gets
      # exactly the two. Naming them here meant the first case to need a third
      # file reported "did not compile" with nothing saying which file was
      # missing.
      # **The runtime is compiled once per run, not 140 times.** `emit-c` copies
      # the same runtime C beside every program, and at -O2 it is 85% of each
      # arm's compile. With NTS_MEMORY_OBJECTS (a directory the parent makes
      # fresh for each run) every .c other than program.c is compiled to an
      # object named by the bytes of everything it could include -- every file
      # emit-c wrote except the program's own -- plus the compiler and the
      # flags, and linked as before. A runtime that included the program's
      # header would make that key wrong, so then nothing is reused.
      sources="$where/program.c"
      if [ -n "${NTS_MEMORY_OBJECTS:-}" ] && ! grep -qs '#include "program.h"' "$where"/nts_*; then
        inputs=$( { clang --version; echo "-O2 -DNTS_PROVIDER_RC"; (cd "$where" && find . -type f ! -name program.c ! -name program.h ! -name run | LC_ALL=C sort | xargs sha256sum); } | sha256sum | cut -c1-32)
        for c in "$where"/*.c; do
          [ "$c" = "$where/program.c" ] && continue
          obj="$NTS_MEMORY_OBJECTS/$inputs-$(basename "$c" .c).o"
          if [ ! -f "$obj" ]; then
            clang -O2 -I"$where" -DNTS_PROVIDER_RC -c "$c" -o "$obj.$$" 2>/dev/null && mv -f "$obj.$$" "$obj"
          fi
          sources="$sources $obj"
        done
      else
        sources="$where/*.c"
      fi
      # $sources is a list of paths without spaces, split on purpose.
      clang -O2 -I"$where" -o "$where/run" $sources \
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
    elided=$(measure elided -u NTS_RC_NAIVE) || { short "DID NOT RUN"; return; }
    naive=$(measure naive NTS_RC_NAIVE=1) || { short "DID NOT RUN under NTS_RC_NAIVE"; return; }

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
  }
  one_case
  exit "$fail"
fi

fail=0
printf '%-20s %7s %7s %7s %6s %7s %6s %6s   %s\n' \
  case naive actual ideal gone alloc floor cand ''

jobs=${NTS_MEMORY_JOBS:-${NTS_GATE_JOBS:-$(n=$(nproc 2>/dev/null || echo 4); [ "$n" -gt 8 ] && echo 8 || echo "$n")}}
rows=$(mktemp -d)
NTS_MEMORY_OBJECTS=$(mktemp -d)
export NTS_MEMORY_OBJECTS
trap 'rm -rf "$rows" "$NTS_MEMORY_OBJECTS"' EXIT
self="$PWD/tooling/memory/run.sh"
# A case's row is written aside and renamed into place when the case has ended
# (with `.failed` beside it when it failed), so a worker killed half way leaves
# no row and is counted below as not measured -- a redirect creates the file
# before the command runs, and an empty row read as a measured case. xargs stops
# starting work when a worker dies by a signal and `set -e` would end this
# script silently there; it is reported instead and the accounting decides.
# Each worker holds one of the gate's tokens (token.sh; see "Tokens" in run.mjs).
printf '%s\0' tooling/memory/cases/*/ | xargs -0 -P "$jobs" -I{} "$PWD/tooling/gate/token.sh" bash -c '
  dir=$1; rows=$2
  name=$(basename "$dir")
  if "$0" --case "$dir" > "$rows/$name.row.part" 2> "$rows/$name.err"; then :; else : > "$rows/$name.failed"; fi
  mv "$rows/$name.row.part" "$rows/$name.row"
' "$self" {} "$rows" || echo "  a worker ended abnormally (xargs exited $?); the cases it held are not measured" >&2
seen=0
for dir in tooling/memory/cases/*/; do
  name=$(basename "$dir")
  [ -f "$rows/$name.row" ] || continue
  seen=$((seen + 1))
  cat "$rows/$name.err" >&2
  cat "$rows/$name.row"
  [ -f "$rows/$name.failed" ] && fail=1
done
# An empty loop is not a clean run: every case has a row, or this measured less
# than it says.
total=$(ls -d tooling/memory/cases/*/ 2>/dev/null | wc -l)
if [ "$seen" -eq 0 ] || [ "$seen" -ne "$total" ]; then
  echo "  measured $seen of $total case(s)" >&2
  fail=1
fi


if [ "$fail" -ne 0 ]; then
  printf '\n\033[31mFAILED\033[0m: memory\n'
  exit 1
fi
printf '\n\033[32mgreen\033[0m: nothing leaked, no answer changed, every case at both floors\n'
