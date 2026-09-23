#!/bin/sh
# Build the library and the C program that links it, and check that
# TypeScript closures -- capturing ones -- cross to C as callbacks with a
# context, and come back.
#
# What the caller checks, and the arm each has: the captured sum read back
# after C calls the closure; two closures through one C function answering
# 10 + 600, which a crossed context cannot; a closure registered by a
# function that has returned, called later; and nothing delivered after
# unsubscribe. The release under reference counting -- that unsubscribe's
# destroy function gives the closure back, and that skipping it leaks -- is
# counted in `a_capturing_closure_crosses_to_c_on_both_backends`, which
# builds this same library under both providers.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-closure"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/native-closure"
mkdir -p "$out"

"$nts" build "$source/tsconfig.json" --out "$out"
built="$out/lib/linux-gnu-x86_64"

"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/native" \
  -c "$source/consumer/caller.c" -o "$out/caller.o"
"$cc" "$out/caller.o" "$built/liblib.a" -lm -o "$out/caller"
"$out/caller"
