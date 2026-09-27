#!/bin/sh
# An application that opens files (see src/main.ts), built as a C and an LLVM
# product, plain and under reference counting, each run with GLib's criticals
# fatal: a file released once too often is one.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-open"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-open"
if ! pkg-config --exists gio-2.0; then
  echo "SKIP gtk-open: no gio-2.0 pkg-config entry"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gio-2.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-open: no Gio-2.0.gir"
  exit 0
fi
expected="open 2 a.txt,b.txt hint kept a.txt,b.txt opened 1 "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in open open-llvm; do
    log=$(env G_DEBUG=fatal-criticals timeout 30 "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-open: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "an application that opens files, the handler taking them as one array, on C and LLVM: OK"
