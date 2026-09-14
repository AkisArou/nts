#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-fd"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-fd"
"$nts" emit-c "$source" --out "$out"
for file in caller witness; do
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
    -c "$source/native/$file.c" -o "$out/$file.o"
done
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -I"$out" -c "$out/$file.c" -o "$out/$file.o"
done
# The runtime is linked because converting a count to a 64-bit C integer is a
# runtime call: `size_t` and `nfds_t` are bigint-branded on this target.
"$cc" "$out/nts_runtime.o" "$out/program.o" "$out/caller.o" "$out/witness.o" -lm -o "$out/caller"
"$out/caller"
