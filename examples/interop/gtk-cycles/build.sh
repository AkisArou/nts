#!/bin/sh
# Build a GTK program whose signal handlers capture their own widgets, run it
# under reference counting, and check that each cycle through a GObject was
# collected -- and that a widget kept alive only by its own emission was not
# (see src/main.ts).
#
# Under reference counting only: without it nothing is ever released, so there
# is no collector to check. The arms that fail without the collector's view of
# GObjects are in the program: `itself`, `parented`, `emitting` and `chained`
# read 0 on a compiler that does not have it, and `h2 … unlooked` would mean
# the emission arm tested nothing.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-cycles"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-cycles"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-cycles: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-cycles: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-cycles: no Gtk-4.0.gir"
  exit 0
fi

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc
log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
  timeout 30 "$root/examples/interop/with-display.sh" "$out/cycles/linux-gnu-x86_64/cycles" 2>/dev/null | tr '\n' ' ' || true)
echo "log: $log"
expected="plain 1 other 1 itself 1 parented 1 h1 e h2 e looked emitting 1 chained 2 listed 3 "
if [ "$log" != "$expected" ]; then
  echo "FAILED gtk-cycles: expected $expected" >&2
  exit 1
fi
echo "cycles through a GObject are collected, and an emitting one is not: OK"
