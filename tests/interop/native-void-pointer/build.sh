#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-void-pointer"}
cc=${CC:-clang}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/tests/interop/native-void-pointer"
mkdir -p "$out"
for provider in nogc rc; do
  set --
  if [ "$provider" = rc ]; then set -- --rc; fi
  "$nts" expect-ir "$source/tsconfig.json" --product c "$@"
  "$nts" build "$source/tsconfig.json" --out "$out/$provider" "$@"
  for backend in c llvm; do
    built="$out/$provider/$backend/linux-gnu-x86_64"
    "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" -I"$source/native" \
      -c "$source/consumer/caller.c" -o "$out/caller-$provider-$backend.o"
    "$cc" "$out/caller-$provider-$backend.o" "$built/lib$backend.a" -lm -o "$out/caller-$provider-$backend"
    "$out/caller-$provider-$backend"
  done
done
