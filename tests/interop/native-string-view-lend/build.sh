#!/bin/sh
# Both native backends under reference counting and AddressSanitizer, each
# linked to the same host library and consumer. `control`, `subject` and
# `temporary` must all pass: `subject` was a recorded use-after-free (see
# src/main.ts), a guard since the borrow counts the view's reader, and
# `temporary` guards the view leaning on the string it lends.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-string-view-lend"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/native-string-view-lend"
mkdir -p "$out"
"$nts" emit-c "$source/tsconfig.json" --rc --out "$out/c"
"$nts" emit-llvm "$source/tsconfig.json" --rc > "$out/program.ll"
flags="-O1 -g -w -fsanitize=address -DNTS_PROVIDER_RC"
for file in "$out/c/nts_runtime.c" "$source/native/host.c" "$source/consumer/caller.c"; do
  "$cc" -std=gnu11 -D_GNU_SOURCE $flags -I"$out/c" -c "$file" -o "$out/$(basename "$file").o"
done
"$cc" -std=gnu11 -D_GNU_SOURCE $flags -I"$out/c" -c "$out/c/program.c" -o "$out/c.o"
"$cc" $flags -Wno-override-module -c "$out/program.ll" -o "$out/llvm.o"
for backend in c llvm; do
  "$cc" -fsanitize=address "$out/$backend.o" "$out/nts_runtime.c.o" "$out/host.c.o" \
    "$out/caller.c.o" -lm -lpthread -o "$out/$backend-run"
  ASAN_OPTIONS=detect_leaks=0 "$out/$backend-run" control
  ASAN_OPTIONS=detect_leaks=0 "$out/$backend-run" subject
  ASAN_OPTIONS=detect_leaks=0 "$out/$backend-run" temporary
done
