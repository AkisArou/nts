#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-epoll"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-epoll"
"$nts" emit-c "$source" --out "$out"
# The witness is a check, not code: it declares no symbol and defines no
# function, so it is compiled for its assertions and never linked. It includes
# <sys/epoll.h> itself, because the binding names it.
"$cc" -std=c11 -Wall -Wextra -Werror -fsyntax-only "$out/native_witness.c"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" \
  -c "$source/native/caller.c" -o "$out/caller.o"
# `-Wall -Wextra -Werror` on the generated program too, which is not usual here.
# A packed member is the case that needs it: `&p->member` on one is
# `taking address of packed member`, a correctness warning, and the only way to
# know it is gone is to make it fatal.
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" -c "$out/$file.c" -o "$out/$file.o"
done
"$cc" "$out/nts_runtime.o" "$out/program.o" "$out/caller.o" -lm -o "$out/caller"
"$out/caller"
