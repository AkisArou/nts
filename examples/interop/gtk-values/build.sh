#!/bin/sh
# GTK handles held where any value may go (see src/main.ts), built as a C and
# an LLVM product, plain and under reference counting, each run with GTK's
# criticals fatal: a handle released once too often is one.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-values"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-values"
if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-values: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-values: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-values: no Gtk-4.0.gir"
  exit 0
fi
for mode in plain rc; do
  watch="held alive"
  [ "$mode" = rc ] && watch="held gone"
  expected="button b|button b|number|label|object|true|true|true|b kept ac 3 walked one=b also=b same same watch $watch "
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in values values-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-values: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "GTK handles in unknown values, arrays and maps, on both backends and providers: OK"
