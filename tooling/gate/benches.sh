#!/bin/sh
# Every benchmark case, emitted and compiled by both backends. Nothing runs.
#
#   tooling/gate/benches.sh          # all of them
#   tooling/gate/benches.sh fib      # one, with its output
#
# # The hole this fills
#
# `corpus` checks that arbitrary input produces C that compiles, and `examples`
# compiles and *runs* the examples against node. Neither of them touches
# `benches/cases`, so a code generation bug that only shows up there reaches a
# person through `cargo run -p nts-bench` -- which takes twenty-five minutes and
# is not part of the gate.
#
# That is not hypothetical. `hir::narrow` retyped a constant to `i32` without
# wrapping its value, and `closures` stopped compiling: "implicit conversion
# from 'long' to 'int32_t' changes value from 2654435761 to -1640531535", which
# is `-Werror` under the flags the generated file is built with. The full gate
# was **green** on that commit. The benchmark caught it.
#
# Compiling is most of the value and costs almost none of the time: the same
# `-Wall -Wextra -Werror` the benchmark uses, no linking, no running, no quiet
# machine required. What it cannot catch is a wrong *answer*, which is what the
# benchmark's checksums are for and why this does not replace them.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

NTS_TSGO=${NTS_TSGO:-$root/target/tsgo}
export NTS_TSGO

[ -x target/release/nts ] || { echo "build first: cargo build --release"; exit 1; }

# The flags `nts-bench` compiles with, minus the ones that need a link step.
# `-Werror` is the point: a warning in generated code is a bug in the emitter,
# and the benchmark already treats it as one.
CFLAGS="-O2 -Wall -Wextra -Werror -std=c11"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

only=${1:-}
fail=0
count=0

for case in benches/cases/*/; do
  name=$(basename "$case")
  [ -n "$only" ] && [ "$only" != "$name" ] && continue
  [ -f "$case/tsconfig.json" ] || continue
  count=$((count + 1))

  out="$work/$name"
  if ! ./target/release/nts emit-c "$case/tsconfig.json" --out "$out" >"$work/log" 2>&1; then
    printf '  %-22s emit-c refused\n' "$name"
    [ -n "$only" ] && cat "$work/log"
    fail=1
    continue
  fi
  # Only the program: the runtime is compiled by its own tests and compiling it
  # once per case would triple this script's cost for nothing.
  if ! clang $CFLAGS -I"$out" -c -o /dev/null "$out/program.c" >"$work/log" 2>&1; then
    printf '  %-22s C did not compile\n' "$name"
    cat "$work/log" | head -12
    fail=1
    continue
  fi

  if ! ./target/release/nts emit-llvm "$case/tsconfig.json" >"$out/program.ll" 2>"$work/log"; then
    printf '  %-22s emit-llvm refused\n' "$name"
    [ -n "$only" ] && cat "$work/log"
    fail=1
    continue
  fi
  # `-w` because the backend has no warnings to fix and clang emits one about
  # the target triple for every `-x ir` input, which `nts-bench` also suppresses.
  if ! clang -x ir -w -O2 -c -o /dev/null "$out/program.ll" >"$work/log" 2>&1; then
    printf '  %-22s LLVM IR did not compile\n' "$name"
    cat "$work/log" | head -12
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "  $count case(s) checked, at least one did not build"
  exit 1
fi
echo "  $count benchmark case(s) compile, both backends"
