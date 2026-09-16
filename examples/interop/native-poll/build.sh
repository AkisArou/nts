#!/bin/sh
# Build the library and the C program that links it.
#
# **The pipeline is `nts build`.** This wrote out emit, witness, the package's
# own C, the runtime, the program and the link -- none of which is this example's
# subject. What is left is what an interop example is for: a separately compiled
# C consumer, and running it.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-poll"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-poll"
mkdir -p "$out"

# The committed binding is re-derived and compared: a generated file nothing
# re-derives is asserted rather than checked.
derived="$out/derived-binding"
sh "$source/bind.sh" "$derived"
if ! diff -u "$source/types/"*.d.ts "$derived"; then
  echo "the committed binding is not what bind.sh produces here; run:" >&2
  echo "  sh $source/bind.sh" >&2
  exit 1
fi
# Emits, checks the binding against the real headers, compiles the program and
# the package's `native/`, and archives. `--out` because the caller chose where.
"$nts" build "$source/tsconfig.json" --out "$out"
built="$out/lib/linux-gnu-x86_64"

# The consumer. `-Werror` is this example's own standard, not the build's.
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/native" \
  -c "$source/consumer/caller.c" -o "$out/caller.o"
"$cc" "$out/caller.o" "$built/liblib.a" -lm -o "$out/caller"
"$out/caller"
