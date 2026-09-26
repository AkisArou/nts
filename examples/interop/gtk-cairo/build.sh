#!/bin/sh
# Build a program drawing with cairo -- offscreen, and in a drawing area's
# draw function -- on C and LLVM, plain and under reference counting, and run
# each (see src/main.ts). `G_DEBUG=fatal-criticals` turns any GTK complaint
# into an end.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-cairo"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-cairo"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-cairo: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-cairo: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-cairo: no Gtk-4.0.gir"
  exit 0
fi

drawn="offscreen 64x32 in true false ok true drawn true size 100x50 counted 2 kept 1"
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  # Under reference counting each frame's box is given back; without it
  # nothing is, by design.
  growth=positive
  [ "$mode" = rc ] && growth=0
  expected="$drawn frames true growth $growth "
  for product in cairo cairo-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-cairo: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "drawing with cairo: offscreen, and a drawing area's draw function, on C and LLVM: OK"
