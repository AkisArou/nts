#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-callback"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-callback"
"$nts" emit-c "$source" --out "$out"
# The witness is a check, not code: it declares no symbol and defines no
# function, so it is compiled for its assertions and never linked. It includes
# the real headers itself -- the binding names them -- so nothing here decides
# what it is compared against.
"$cc" -std=c11 -Wall -Wextra -Werror -I"$source/native" -fsyntax-only "$out/native_witness.c"
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
