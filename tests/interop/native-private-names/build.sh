#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-native-private-names"}
nts=${NTS_BIN:-"$root/target/release/nts"}
cc=${CC:-clang}
source="$root/tests/interop/native-private-names"
mkdir -p "$out"
# A conflicting published contract is a deliberate hard compiler refusal.
# Both backends must name that conflict, rather than silently rename it.
for backend in c llvm; do
  if "$nts" "emit-$backend" "$source/refusal/tsconfig.json" --out "$out/refusal-$backend" \
      > "$out/refusal-$backend.stdout" 2> "$out/refusal-$backend.stderr"; then
    echo "published/header collision unexpectedly compiled on $backend" >&2
    exit 1
  fi
  grep -F 'NTS2007 foreign symbol `tcgetpgrp` collides with a runtime or compiled function' \
    "$out/refusal-$backend.stderr"
done
# Native libraries select RC. Exercise those real products once.
"$nts" build "$source/tsconfig.json" --out "$out/rc"
for backend in c llvm; do
  built="$out/rc/$backend/linux-gnu-x86_64"
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" \
    -c "$source/consumer/caller.c" -o "$out/caller-rc-$backend.o"
  "$cc" "$out/caller-rc-$backend.o" "$built/lib$backend.a" -lm \
    -o "$out/caller-rc-$backend"
  "$out/caller-rc-$backend" > "$out/rc-$backend.stdout"
  diff -u "$source/expected.txt" "$out/rc-$backend.stdout"
  cat "$out/rc-$backend.stdout"
done
# The raw emitters have an explicit NoGC mode (no --rc), independently of
# library packaging. Its witness is compiled on its own before execution.
for backend in c llvm; do
  built="$out/nogc/$backend"
  mkdir -p "$built"
  "$nts" "emit-$backend" "$source/tsconfig.json" --product "$backend" --out "$built" > "$built/emit.stdout"
  if grep -q 'compile the runtime with -DNTS_PROVIDER_RC' "$built/emit.stdout"; then
    echo "NoGC emission unexpectedly selected RC" >&2
    exit 1
  fi
  "$cc" -std=c11 -Werror -I"$built" -fsyntax-only "$built/native_witness.c"
  if [ "$backend" = c ]; then input="$built/program.c"; else input="$built/program.ll"; fi
  "$cc" -std=c11 -O2 -Wall -Wextra -Werror -I"$built" \
    -c "$source/consumer/caller.c" -o "$out/caller-nogc-$backend.o"
  "$cc" -O2 -I"$built" "$input" "$out/caller-nogc-$backend.o" \
    "$built/nts_runtime.c" -lm -o "$out/caller-nogc-$backend"
  "$out/caller-nogc-$backend" > "$out/nogc-$backend.stdout"
  diff -u "$source/expected.txt" "$out/nogc-$backend.stdout"
  cat "$out/nogc-$backend.stdout"
done
