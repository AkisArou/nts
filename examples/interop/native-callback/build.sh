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
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" -I"$source/native" \
    -c "$source/native/$file.c" -o "$out/$file.o"
done
# `-I$source/native`: program.c includes "library.h" now, because the
# binding names it and the struct it describes is that header's.
# `-pedantic-errors` on the generated program, which is not usual here and is
# the point. A bridge used to be typed `void *`, so program.c assigned a
# function to one and passed one where `NtsFn_int_int` was wanted -- neither a
# conversion ISO C performs, both silent under `-Wall -Wextra -Werror`, and ten
# of them in this file. POSIX guarantees the representation, which is why it
# ran. This is the flag that noticed.
"$cc" -std=c11 -pedantic-errors -I"$out" -I"$source/native" -fsyntax-only "$out/program.c"
for file in program nts_runtime; do
  "$cc" -std=c11 -O2 -I"$out" -I"$source/native" -c "$out/$file.c" -o "$out/$file.o"
done
# The runtime is linked because a bridge calls into it: `nts_callback_enter`
# marks the frames a throw must not jump past.
"$cc" "$out/program.o" "$out/nts_runtime.o" "$out/caller.o" "$out/library.o" \
  -lm -o "$out/caller"
"$out/caller"
