#!/bin/sh
# Build GTK4 programs whose classes extend GObject classes, as a C and an
# LLVM product, run each plain and under reference counting, and check the
# log (see src/main.ts).
#
# The arms that make a passing run mean something are in the program: a
# subclass registered as a plain parent -- which is what `new` built before
# subclasses were registered -- logs `clicked 0` without the `!`, its type as
# `GtkButton`, and `measure 0 0`, since nothing answers GTK's call.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-subclass"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-subclass"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-subclass: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-subclass: no xvfb-run on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-subclass: no Gtk-4.0.gir"
  exit 0
fi

expected="clicked 0! clicked 0!! type Nts_Counter count 2 seen 0|0! plain p measure 42 17 square Nts_Square "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in subclass subclass-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 xvfb-run -a "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-subclass: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "GObject subclasses written in TypeScript, on C and LLVM: OK"
