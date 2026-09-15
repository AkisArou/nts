#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-stat"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-stat"
mkdir -p "$out"
# **The committed binding is re-derived and compared**, not taken on trust. A
# generated file that nothing regenerates is asserted rather than checked: if
# `nts bind-c` changed what it emits, or these headers changed, the file in the
# tree would go stale in silence and only a *wrong* binding would be caught, by
# the witness. This catches a stale one too, and says what to run.
derived="$out/derived-binding"
sh "$source/bind.sh" "$derived"
if ! diff -u "$root/examples/interop/native-stat/types/stat.d.ts" "$derived"; then
  echo "the committed binding is not what bind.sh produces here; run:" >&2
  echo "  sh $source/bind.sh" >&2
  exit 1
fi
"$nts" emit-c "$source" --out "$out"
# The witness is a check, not code: compiled for its assertions, never linked.
"$cc" -std=c11 -Wall -Wextra -Werror -fsyntax-only "$out/native_witness.c"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
  -c "$source/native/caller.c" -o "$out/caller.o"
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -I"$out" -c "$out/$file.c" -o "$out/$file.o"
done
"$cc" "$out/nts_runtime.o" "$out/program.o" "$out/caller.o" -lm -o "$out/caller"
"$out/caller"
