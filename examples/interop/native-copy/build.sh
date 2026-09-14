#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-copy"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-copy"
"$nts" emit-c "$source" --out "$out"
# The witness is a check, not code: compiled for its assertions, never linked.
"$cc" -std=c11 -Wall -Wextra -Werror -I"$source/native" -fsyntax-only "$out/native_witness.c"
for file in caller point; do
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" -I"$source/native" \
    -c "$source/native/$file.c" -o "$out/$file.o"
done
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -I"$out" -I"$source/native" -c "$out/$file.c" -o "$out/$file.o"
done
"$cc" "$out/nts_runtime.o" "$out/program.o" "$out/caller.o" "$out/point.o" -lm -o "$out/caller"
"$out/caller"
