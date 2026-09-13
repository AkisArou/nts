#!/bin/sh
# Build and run the C program. Verified working.
#
# The `quickjs/*.c` sources are deliberately NOT on the command line:
# `nts_runtime.c` already includes them, and compiling them separately gives
# `multiple definition of js_dtoa` and forty more like it. That is a two-minute
# mistake the first time and the reason this script exists.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-/tmp/ts-from-c}
cc=${CC:-clang}
"$root/target/release/nts" emit-c "$root/examples/interop/ts-from-c" --out "$out"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" -c \
   "$root/examples/interop/ts-from-c/native/caller.c" -o "$out/caller.o"
"$cc" -std=c11 -O2 -I"$out" -o "$out/caller" "$out/caller.o" \
   "$out/program.c" "$out/nts_runtime.c" -lm
"$out/caller"
