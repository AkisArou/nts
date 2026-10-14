#!/bin/sh
# Dictionary members C is told were given or not (`Given<T>`, c:types), run
# against the same calls written in C (`reference/main.c`).
#
# `native/options.h` holds two such members -- a boolean and a number, the
# two whose zero is a value -- and one plain member. Each line of output is
# one call, and the lines that carry the feature are:
#
# - `false` and `zero`: a member written as its zero is given. A plain
#   struct cannot tell them from a member left out.
# - `undefined`, `decided absent` and `held zero`: a member whose value is
#   `undefined` is not given, as WebIDL's "present" says -- written in the
#   literal, decided at run time, and read from an object the program holds.
#
# Then the same program from the LLVM backend, which lays the untagged pairs
# out itself, linked with the C build's runtime and main.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-given"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/native-given"
mkdir -p "$out"

log="$out/build.log"
"$nts" build "$source/tsconfig.json" --out "$out" >"$log" 2>&1 || { cat "$log" >&2; exit 1; }
if grep -q "refused" "$log"; then
  cat "$log" >&2
  echo "native-given: nts build refused part of the program and exited 0" >&2
  exit 1
fi

"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$source/native" \
  "$source/reference/main.c" "$source/native/options.c" -o "$out/oracle"
"$out/oracle" >"$out/expected.txt"
[ "$(wc -l <"$out/expected.txt")" -eq 10 ] ||
  { echo "native-given: the oracle printed $(wc -l <"$out/expected.txt") lines, not 10" >&2; exit 1; }

"$out/given/linux-gnu-x86_64/given" >"$out/actual.txt" 2>"$out/actual.err"
[ -s "$out/actual.err" ] && { cat "$out/actual.err" >&2; exit 1; }
diff -u "$out/expected.txt" "$out/actual.txt"
echo "C: each member is given exactly when its value is not undefined"

llvm="$out/llvm"
c_out="$out/given/linux-gnu-x86_64"
mkdir -p "$llvm"
"$nts" emit-llvm "$source/tsconfig.json" >"$llvm/program.ll" 2>"$llvm/emit.log" ||
  { cat "$llvm/emit.log" >&2; exit 1; }
if grep -q "NTS[0-9]" "$llvm/emit.log"; then
  cat "$llvm/emit.log" >&2
  echo "native-given: emit-llvm refused part of the program" >&2
  exit 1
fi
"$cc" -x ir -w -O2 -c "$llvm/program.ll" -o "$llvm/program.o"
for unit in main nts_runtime nts_uv_host; do
  "$cc" -std=c11 -O2 -w -I"$c_out" -c "$c_out/$unit.c" -o "$llvm/$unit.o"
done
"$cc" -std=c11 -O2 -w -I"$source/native" -c "$source/native/options.c" -o "$llvm/options.o"
"$cc" "$llvm"/*.o -luv -lm -o "$llvm/given"
"$llvm/given" >"$llvm/actual.txt"
diff -u "$out/expected.txt" "$llvm/actual.txt"
echo "LLVM: the same, the untagged pairs laid out as clang lays them out"
