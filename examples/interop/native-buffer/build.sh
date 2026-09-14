#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-buffer"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-buffer"
"$nts" emit-c "$source" --out "$out"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
  -c "$source/native/caller.c" -o "$out/caller.o"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
  -c "$out/program.c" -o "$out/program.o"
"$cc" "$out/program.o" "$out/caller.o" -o "$out/caller"
"$out/caller"
