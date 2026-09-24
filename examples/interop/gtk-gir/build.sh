#!/bin/sh
# Build a GTK4 program whose GTK declarations are generated from GIR by
# `nts build` itself, run it, and check its log (see src/main.ts).
#
# The arm that makes a passing run mean something is inside the program:
# `asGtkLabel` of a box must answer null. A checked cast that answered the
# object whatever it was would log `cast-wrong`, and the order below would
# not match.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-gir"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-gir"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-gir: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-gir: no xvfb-run on PATH"
  exit 0
fi
# The GIR files are a separate package on some distributions.
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-gir: no Gtk-4.0.gir"
  exit 0
fi

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out"
log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
  timeout 30 xvfb-run -a "$out/gir/linux-gnu-x86_64/gir" 2>/dev/null | tr '\n' ' ' || true)
echo "log: $log"
expected="ymd=2026-9 keyfile 1 5 no-error error-set 0 thrown split=a|b|c sha256=ba7816bf cast-ok cast-null clicked 1 idle label=tick 3 status=0 ticks=3 kind=2 "
if [ "$log" != "$expected" ]; then
  echo "FAILED gtk-gir: expected $expected" >&2
  exit 1
fi
echo "GTK on bindings generated from GIR: OK"
