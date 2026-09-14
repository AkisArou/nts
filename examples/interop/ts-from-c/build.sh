#!/bin/sh
# Build and run the C program. Verified working.
#
# The `quickjs/*.c` sources are deliberately NOT on the command line:
# `nts_runtime.c` already includes them, and compiling them separately gives
# `multiple definition of js_dtoa` and forty more like it. That is a two-minute
# mistake the first time and the reason this script exists.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-ts-from-c"}
cc=${CC:-clang}
# `NTS_BIN`, like every other interop script: the gate builds the compiler into
# its own worktree and this one reached past it to `$root/target`, which in a
# fresh worktree does not exist. It was the one script of nine that did not, so
# it was also the one the new interop step failed on first.
nts=${NTS_BIN:-"$root/target/release/nts"}
"$nts" emit-c "$root/examples/interop/ts-from-c" --out "$out"
"$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$out" -c \
   "$root/examples/interop/ts-from-c/native/caller.c" -o "$out/caller.o"
"$cc" -std=c11 -O2 -I"$out" -o "$out/caller" "$out/caller.o" \
   "$out/program.c" "$out/nts_runtime.c" -lm
"$out/caller"
