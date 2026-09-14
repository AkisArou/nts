#!/bin/sh
# Compile the TypeScript and the C library independently, then link and run.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-c-from-ts"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/c-from-ts"
"$nts" emit-c "$source" --out "$out"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$source/native" \
  -c "$source/native/counter.c" -o "$out/counter.o"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" -I"$source/native" \
  -c "$source/native/caller.c" -o "$out/caller.o"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
  -include "$source/native/counter.h" -c "$out/program.c" -o "$out/program.o"
"$cc" -std=c11 -O2 -I"$out" "$out/program.o" "$out/counter.o" \
  "$out/caller.o" "$out/nts_runtime.c" -lm -o "$out/caller"
"$out/caller"
