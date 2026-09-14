#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-poll"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-poll"
"$nts" emit-c "$source" --out "$out"
for file in caller layout; do
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
    -c "$source/native/$file.c" -o "$out/$file.o"
done
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
  -c "$out/program.c" -o "$out/program.o"
"$cc" "$out/program.o" "$out/caller.o" "$out/layout.o" -o "$out/caller"
"$out/caller"
