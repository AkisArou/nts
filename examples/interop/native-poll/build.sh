#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-poll"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-poll"
mkdir -p "$out"
# **The committed binding is re-derived and compared**, not taken on trust. A
# generated file that nothing regenerates is asserted rather than checked: if
# `nts bind-c` changed what it emits, or these headers changed, the file in the
# tree would go stale in silence and only a *wrong* binding would be caught, by
# the witness. This catches a stale one too, and says what to run.
derived="$out/derived-binding"
sh "$source/bind.sh" "$derived"
if ! diff -u "$root/examples/interop/native-poll/types/poll.d.ts" "$derived"; then
  echo "the committed binding is not what bind.sh produces here; run:" >&2
  echo "  sh $source/bind.sh" >&2
  exit 1
fi
"$nts" emit-c "$source" --out "$out"
# The witness is a check, not code: it declares no symbol and defines no
# function, so it is compiled for its assertions and never linked. It includes
# the real headers itself -- the binding names them -- so nothing here decides
# what it is compared against.
"$cc" -std=c11 -Wall -Wextra -Werror -fsyntax-only "$out/native_witness.c"
for file in caller layout; do
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
    -c "$source/native/$file.c" -o "$out/$file.o"
done
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -I"$out" -c "$out/$file.c" -o "$out/$file.o"
done
# The runtime is linked because converting a count to a 64-bit C integer is a
# runtime call: `size_t` and `nfds_t` are bigint-branded on this target.
"$cc" "$out/nts_runtime.o" "$out/program.o" "$out/caller.o" "$out/layout.o" -lm -o "$out/caller"
"$out/caller"
