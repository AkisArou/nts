#!/bin/sh
# Every benchmark case run against node, through one backend.
#
#   tooling/gate/bench-agree.sh            # all of them
#   tooling/gate/bench-agree.sh absences   # one, with its output
#
# # The hole this fills, which was a wrong answer for weeks
#
# `benches.sh` compiles every case through both native backends and its header
# says what it does not do: "Nothing runs." `examples` runs the examples.
# `nts-bench` runs each case with **one seed** and compares a checksum. So
# nothing ever ran a benchmark case against the oracle on the hostile pool.
#
# On 2026-09-06 that gap held a wrong answer. `benches/cases/absences` answered
# 2,046,179,082 where node answers 2,046,179,137, for pool value 2147483647:
# the loop counter passes 2^31, the remainder is typed `u32`, and a `u32` lives
# in an `int` slot on the JVM, so `irem` took the sign of a dividend that has
# none. The C lane agreed with node because C has the type. Three green steps,
# one wrong lane, and the case's own seed is 3 so the benchmark could not see
# it either.
#
# A green step is a claim about what it looked at. This one looks at the fifty
# cases nothing else runs.
#
# # Why a floor rather than "all of them"
#
# Nine cases export nothing with scalar arguments and a scalar result, so the
# differential has nothing to build a pool for and says so. That is not a
# failure and it is not agreement either -- it is the same distinction the rest
# of this gate keeps between a refusal and an absence.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

NTS_TSGO=${NTS_TSGO:-$root/target/tsgo}
export NTS_TSGO
# `NTS_BIN` for the reason every other step takes it: three sessions build into
# different directories, and a hard-coded path measures somebody else's binary
# and reports a floor for code nobody is looking at.
nts=${NTS_BIN:-$root/target/release/nts}
[ -x "$nts" ] || { echo "  no compiler at $nts -- build first, or set NTS_BIN"; exit 1; }

backend=${NTS_BACKEND:-jvm}
export NTS_BACKEND=$backend
floor=${NTS_BENCH_AGREE_FLOOR:-41}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

only=${1:-}

# Parallel for the same reason `rc.sh` is: fifty cases, each compiling a
# program and running twenty-nine pool values through it and through node, is
# half an hour serially and two minutes at eight ways. The cap is `rc.sh`'s
# number for the same reason -- node is memory-hungry and a crowded machine
# swaps rather than finishes.
crowded=8
cores=$( { command -v nproc >/dev/null && nproc; } || echo 4 )
jobs=${NTS_GATE_JOBS:-$( [ "$cores" -lt "$crowded" ] && echo "$cores" || echo "$crowded" )}

for case in benches/cases/*/; do
  name=$(basename "$case")
  [ -n "$only" ] && [ "$only" != "$name" ] && continue
  [ -f "$case/case.ts" ] || continue
  if [ -f "$case/tsconfig.json" ]; then
    printf '%s\t%s\n' "$name" "$case/tsconfig.json"
  else
    project="$work/$name.tsconfig.json"
    printf '{ "extends": "%s/tsconfig.fixtures.json", "include": ["%s/%s"] }\n' \
      "$root" "$root" "$case" > "$project"
    printf '%s\t%s\n' "$name" "$project"
  fi
done > "$work/cases"

# One line per case, so the counting below reads a fixed vocabulary rather than
# the differential's prose: a step that greps for a sentence breaks when the
# sentence is improved, which has happened here twice.
NTS_BENCH_AGREE_NTS="$nts" xargs -P "$jobs" -n 1 -I{} sh -c '
  name=${0%%	*}
  project=${0#*	}
  if out=$("$NTS_BENCH_AGREE_NTS" check "$project" 2>&1); then
    case "$out" in
      *"nothing to check"*) printf "none\t%s\n" "$name" ;;
      *"agreed on every case"*) printf "agree\t%s\n" "$name" ;;
      *) printf "bad\t%s\t%s\n" "$name" "$(printf "%s" "$out" | tail -1)" ;;
    esac
  else
    printf "bad\t%s\t%s\n" "$name" "$(printf "%s" "$out" | tail -1)"
  fi
' {} < "$work/cases" > "$work/out" 2>&1

agreed=$(grep -c "^agree" "$work/out" || true)
nothing=$(grep -c "^none" "$work/out" || true)
bad=$(grep -c "^bad" "$work/out" || true)
grep "^bad" "$work/out" | while IFS="	" read -r _ name why; do
  printf "  %-22s %s\n" "$name" "$why"
done

echo "  $agreed of $((agreed + bad)) benchmark cases agree with node through the $backend backend"
[ "$nothing" -gt 0 ] && echo "  $nothing exported nothing with scalar arguments and a scalar result"

if [ "$bad" -ne 0 ]; then
  echo "  $bad did not agree"
  exit 1
fi
if [ -z "$only" ] && [ "$agreed" -lt "$floor" ]; then
  echo "  floor is $floor and this run agreed on $agreed"
  exit 1
fi
exit 0
