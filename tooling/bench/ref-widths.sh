#!/bin/sh
# Does each `ref.java` compute in the same width the program does?
#
#     sh tooling/bench/ref-widths.sh            # report every case
#     sh tooling/bench/ref-widths.sh --mismatch # only the ones that disagree
#
# # The rule, and why reading it off the emission is the only honest check
#
# The suite's rule is **no field narrower than the f64 a TypeScript `number`
# is**, and it exists because a reference that computes in `int` where the
# program computes in `double` is not a slower or faster implementation of the
# same thing -- it is a different program, and the ratio stops being about code
# generation. `array-methods` published at 3.28x with an `int[]` reference and
# at 1.71x with a `double[]` one, and **none of that difference was ours**.
#
# The rule is easy to state and hard to apply by eye, because `int` is often
# right. A loop counter is an `int` in both languages. An index is. What may not
# be an `int` is a value standing in for a TypeScript `number`, and whether a
# given one does is a question about what the middle end proved -- not about
# what the Java looks like.
#
# So this asks the emission. `specialize` gives the whole-number path a
# signature; if it returns `I` then the middle end proved the program's result
# is an int32 and a reference returning `int` is computing the same thing. If it
# returns `D` and the reference returns `int`, the reference is narrower than
# the program and the row is measuring a representation difference.
#
# # What it found the first time it was run
#
# Three of fifty-one: `exceptions`, `fib` and `instanceof`. Forty-eight agree,
# which is the useful half of the result -- the suite is fair on this axis
# almost everywhere, and that was worth establishing once rather than doubting
# case by case forever.
#
# **A mismatch is a question, not a verdict.** On `fib` the narrow reference
# turned out to be *slower* than the wide one it should have been -- 3-4% across
# two runs -- so obeying the rule there moves the row against us. That is an
# argument for obeying it and not against, but it does mean this script reports
# and does not fail. Correcting a reference changes a published row, and that
# is a decision with a measurement attached rather than a lint.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
bin=${NTS_BIN:-$root/target-jvm/release/nts}
work=${TMPDIR:-/tmp}/nts-ref-widths.$$
only_mismatch=${1:-}

[ -x "$bin" ] || { echo "no nts at $bin -- set NTS_BIN" >&2; exit 1; }
command -v javap > /dev/null 2>&1 || { echo "SKIP: no javap" >&2; exit 0; }

mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

mismatches=0
for dir in "$root"/benches/cases/*/; do
  case=$(basename "$dir")
  [ -f "$dir/case.ts" ] && [ -f "$dir/ref.java" ] || continue
  entry=$(grep -oE "^export function [A-Za-z0-9_]+" "$dir/case.ts" | head -1 | awk '{print $3}')
  [ -n "$entry" ] || continue

  cat > "$work/$case.json" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$dir"] }
JSON
  rm -rf "${work:?}/$case"
  mkdir -p "$work/$case"
  "$bin" emit-jvm "$work/$case.json" --out "$work/$case" --entry "$entry" > /dev/null 2>&1 || continue

  # The specialised path's return type is what the middle end proved. Without a
  # `$whole` path there is nothing to compare and the case is skipped rather
  # than guessed at.
  ours=$(javap -p -cp "$work/$case" nts.gen.Program 2>/dev/null \
    | grep -oE "(double|int|long|boolean) $entry\\\$whole\(" | head -1 | awk '{print $1}')
  ref=$(grep -v "^//" "$dir/ref.java" \
    | grep -oE "static (int|double|long) $entry\(" | head -1 | awk '{print $2}')
  [ -n "$ours" ] && [ -n "$ref" ] || continue

  if [ "$ours" = "double" ] && [ "$ref" != "double" ]; then
    mismatches=$((mismatches + 1))
    printf "%-24s ours=%-7s ref=%-7s  <- reference is narrower than the program\n" \
      "$case" "$ours" "$ref"
  elif [ "$only_mismatch" != "--mismatch" ]; then
    printf "%-24s ours=%-7s ref=%s\n" "$case" "$ours" "$ref"
  fi
done

echo
echo "$mismatches case(s) where the reference computes narrower than the program."
echo "Each is a decision with a measurement attached, not a defect: see"
echo "benches/jvm-rows.md for what happened when \`fib\`'s was priced."
