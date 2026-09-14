#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-callback"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-callback"
"$nts" emit-c "$source" --out "$out"
for file in caller library; do
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
    -c "$source/native/$file.c" -o "$out/$file.o"
done
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -I"$out" -c "$out/$file.c" -o "$out/$file.o"
done
# The runtime is linked because a bridge calls into it: `nts_callback_enter`
# marks the frames a throw must not jump past.
"$cc" "$out/program.o" "$out/nts_runtime.o" "$out/caller.o" "$out/library.o" \
  -lm -o "$out/caller"
"$out/caller"
