#!/bin/sh
# Records passed and returned by value across the C boundary, run against the
# same program written in C (`reference/main.c`).
#
# `native/geometry.h` has one record per way the ABI passes one: two doubles
# in SSE registers, four doubles and three longs in memory, an int and a char
# in one integer register. `mixed` passes more of them than there are
# registers. Two lines are the controls the output carries:
#
# - `unchanged`: C changed its copy of the argument, and ours did not follow.
#   A pointer passed where the record was wanted would show the change.
# - `result kept`: the result is its own storage. Changing the record it was
#   made from afterwards leaves it.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-byvalue"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-byvalue"
mkdir -p "$out"

log="$out/build.log"
"$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
if grep -q "refused" "$log"; then
  cat "$log" >&2
  echo "native-byvalue: nts build refused part of the program and exited 0" >&2
  exit 1
fi

"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$source/native" \
  "$source/reference/main.c" "$source/native/geometry.c" -o "$out/oracle"
"$out/oracle" >"$out/expected.txt"
[ "$(wc -l <"$out/expected.txt")" -eq 8 ] ||
  { echo "native-byvalue: the oracle printed $(wc -l <"$out/expected.txt") lines, not 8" >&2; exit 1; }

"$out/byvalue/linux-gnu-x86_64/byvalue" >"$out/actual.txt" 2>"$out/actual.err"
[ -s "$out/actual.err" ] && { cat "$out/actual.err" >&2; exit 1; }
diff -u "$out/expected.txt" "$out/actual.txt"
echo "Records cross by value as clang passes them: OK"
