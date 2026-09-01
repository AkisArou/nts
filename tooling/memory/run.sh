#!/usr/bin/env bash
# How much reference counting each shape costs, and how much of it is necessary.
#
# The benchmark suite measures *time*, which mixes counting with allocation and
# with the cache. This measures the counting alone, which is the thing an
# elision pass is trying to remove -- and it needs no quiet machine and no
# calibration, so it can run in seconds rather than in half an hour.
#
# Three numbers per case, and the third is the point:
#
#   naive   what a correctness-first implementation emits, from `NTS_RC_NAIVE=1`
#   actual  what this compiler emits today
#   ideal   what a person can *justify* as necessary, written down in `expected`
#           beside the argument for it
#
# `actual / naive` is the ratio Lobster reports when it says it eliminates 95%
# of reference operations. `actual - ideal` is the work queue. Without the third
# number this is a measurement; with it, it is a claim that can be wrong.
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
printf '%-20s %8s %8s %8s %7s   %s\n' case naive actual ideal gone ''

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
    clang -O2 -I"$where" -o "$where/run" "$where/program.c" "$where/nts_runtime.c" \
          tooling/memory/harness.c -DNTS_PROVIDER_RC -lm 2>/dev/null || {
      echo "  $name: did not compile" >&2
      return 1
    }
    "$where/run"
  }

  elided=$(measure elided -u NTS_RC_NAIVE) || { fail=1; continue; }
  naive=$(measure naive NTS_RC_NAIVE=1) || { fail=1; continue; }

  read_num() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2; }
  a=$(( $(read_num "$elided" retains) + $(read_num "$elided" releases) ))
  n=$(( $(read_num "$naive" retains) + $(read_num "$naive" releases) ))
  leaked=$(read_num "$elided" leaked)
  answer=$(read_num "$elided" answer)
  naive_answer=$(read_num "$naive" answer)
  ideal=$(grep '^ideal ' "$dir/expected" | awk '{print $2}')

  note=""
  # Elision that changes the answer is not elision.
  [ "$answer" = "$naive_answer" ] || { note="ANSWER CHANGED: $naive_answer -> $answer"; fail=1; }
  [ "$leaked" = "0" ] || { note="LEAKED $leaked"; fail=1; }
  [ -z "$note" ] && [ "$a" -gt "$ideal" ] && note="$((a - ideal)) above ideal"
  [ -z "$note" ] && [ "$a" -lt "$ideal" ] && { note="BELOW ideal -- the argument in expected is wrong"; fail=1; }

  ratio="--"
  [ "$n" -gt 0 ] && ratio=$(awk -v a="$a" -v n="$n" 'BEGIN { printf "%d%%", (n - a) * 100 / n }')
  printf '%-20s %8s %8s %8s %7s   %s\n' "$name" "$n" "$a" "$ideal" "$ratio" "$note"
done

if [ "$fail" -ne 0 ]; then
  printf '\n\033[31mFAILED\033[0m: memory\n'
  exit 1
fi
printf '\n\033[32mgreen\033[0m: nothing leaked, no answer changed, none below its ideal\n'
