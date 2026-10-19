#!/bin/sh
# Build both native backends, then link each to the same separate C consumer.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-pointer-bits"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/native-pointer-bits"
mkdir -p "$out"
"$nts" expect-ir "$source/tsconfig.json" --product c
"$nts" expect-ir "$source/tsconfig.json" --product c --rc
"$nts" build "$source/tsconfig.json" --out "$out"
for backend in c llvm; do
  built="$out/$backend/linux-gnu-x86_64"
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/native" \
    -c "$source/consumer/caller.c" -o "$out/caller-$backend.o"
  "$cc" "$out/caller-$backend.o" "$built/lib$backend.a" -lm -o "$out/caller-$backend"
  "$out/caller-$backend"
done
