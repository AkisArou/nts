#!/bin/sh
# Build the library and the C program that links it.
#
# **The pipeline is `nts build` now.** This ran `emit-c`, compiled the witness,
# compiled the runtime and the program, and linked -- which is not this example's
# subject, and was written out the same way in all sixteen interop examples. What
# is left is what an interop example is for: a separately compiled C consumer,
# and running it.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-uname"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-uname"

# Emits, checks the binding against the real headers with `native_witness.c`,
# compiles, and archives. `--out` because this script's caller chose where.
"$nts" build "$source/tsconfig.json" --out "$out"
built="$out/uname/linux-gnu-x86_64"

# The consumer. `-Werror` is this example's own standard, not the build's.
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" \
  -c "$source/native/caller.c" -o "$out/caller.o"
"$cc" "$out/caller.o" "$built/libuname.a" -lm -o "$out/caller"
"$out/caller"
