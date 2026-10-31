#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
source="$root/tests/interop/native-reserved-exports"
out=${1:-"$root/target/interop-native-reserved-exports"}
nts=${NTS_BIN:-"$root/target/release/nts"}
mkdir -p "$out"
for backend in c llvm; do
  for arm in collision unused; do
    name=__nts_desc_Foo
    [ "$arm" = unused ] && name=__nts_unused
    if "$nts" "emit-$backend" "$source/$arm/tsconfig.json" --out "$out/$arm-$backend" > "$out/$arm-$backend.stdout" 2> "$out/$arm-$backend.stderr"; then
      echo "reserved public name $name unexpectedly compiled on $backend" >&2
      exit 1
    fi
    grep -F "NTS2007 export \`$name\` uses nts's reserved C namespace \`__nts_\`; rename it or select an explicit ABI name outside \`__nts_\`" "$out/$arm-$backend.stderr"
  done
done
for mode in nogc rc; do
  flag=--nogc
  [ "$mode" = rc ] && flag=--rc
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" "$flag"
  for product in c llvm privateC privateLlvm; do
    "$out/$mode/$product/linux-gnu-x86_64/$product" > "$out/$mode-$product.stdout"
    diff -u "$source/expected.txt" "$out/$mode-$product.stdout"
    cat "$out/$mode-$product.stdout"
  done
done
"$nts" hir "$source/private/tsconfig.json" > "$out/private.hir"
grep -F '__nts_desc_Foo' "$out/private.hir"
