#!/bin/sh
# Build a window of a stack, a grid, a drop-down, a switch and a widget that
# draws itself, on C and LLVM, plain and under reference counting, and run
# each (see src/main.ts).
# `G_DEBUG=fatal-criticals` turns any GTK complaint into an end.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-widgets"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-widgets"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-widgets: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-widgets: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-widgets: no Gtk-4.0.gir"
  exit 0
fi

expected="label 42.000000 notified 1 picked blue page choices request 140 drawn true width 300 "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in widgets widgets-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-widgets: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "stack, grid, drop-down, switch, a property binding and drawing, on C and LLVM: OK"
