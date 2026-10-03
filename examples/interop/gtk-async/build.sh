#!/bin/sh
# Build a GTK4 program whose signal handlers are `async`, as a C and an LLVM
# product, run each plain and under reference counting, and check the log
# (see src/main.ts).
#
# Refused where the program's loop does not checkpoint after a callback; a
# GTK program's does, so these handlers are bridged, and the log says their
# continuations ran, in order, before the program quit.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-async"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-async"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-async: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-async: no xvfb-run on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-async: no Gtk-4.0.gir"
  exit 0
fi

expected="direct c1 after c2 a1 b1 emitted a2 b2 caught boom "
mkdir -p "$out"
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in async async-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 xvfb-run -a "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-async: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "async signal handlers on GLib's loop, on C and LLVM: OK"
