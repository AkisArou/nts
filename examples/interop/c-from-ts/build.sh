#!/bin/sh
# Build the library and the C program that links it.
#
# **The pipeline is `nts build`.** This wrote out emit, the package's own C, the
# program and the link -- and never compiled the witness at all, which is how an
# emitted file went unread for as long as the example existed.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-c-from-ts"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/c-from-ts"
mkdir -p "$out"

# Emits, checks the binding against the real headers, compiles the program and
# the package's `native/`, and archives.
"$nts" build "$source/tsconfig.json" --out "$out"
built="$out/lib/linux-gnu-x86_64"

# The consumer. `-Werror` is this example's own standard, not the build's.
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/native" \
  -c "$source/consumer/caller.c" -o "$out/caller.o"
"$cc" "$out/caller.o" "$built/liblib.a" -lm -o "$out/caller"
"$out/caller"
