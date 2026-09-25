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
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-gir: no Xvfb on PATH"
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
  timeout 30 "$root/examples/interop/with-display.sh" "$out/gir/linux-gnu-x86_64/gir" 2>/dev/null | tr '\n' ' ' || true)
echo "log: $log"
expected="ymd=2026-9 values=2026/9/24 markup=bold x|none keyfile true 5 no-error error-set 0 thrown split=a|b|c sha256=ba7816bf iter hello world|orld 7 6 11 bounds 0-11 11 rgba true rgb(255,128,0) font Sans made press false dup-target true buffer ab true entry typed! 0 bounds true 1 3 cast-ok cast-null clicked 1 order=ab idle label=tick 3 status=0 ticks=3 kind=2 made=true again=rejected removed=true contents=6 "
if [ "$log" != "$expected" ]; then
  echo "FAILED gtk-gir: expected $expected" >&2
  exit 1
fi

# The same program under reference counting, where every GObject is counted
# (`g_object_ref_sink`/`g_object_unref` through their NULL guards), a promise
# of one holds it in a box, and `G_DEBUG=fatal-criticals` turns a count on a
# freed or NULL object into an abort. Same log.
"$nts" build "$source/tsconfig.json" --out "$out/rc" --rc
rc=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
  timeout 30 "$root/examples/interop/with-display.sh" "$out/rc/gir/linux-gnu-x86_64/gir" 2>/dev/null | tr '\n' ' ' || true)
echo "rc:  $rc"
if [ "$rc" != "$expected" ]; then
  echo "FAILED gtk-gir: under --rc, expected $expected" >&2
  exit 1
fi
echo "GTK on bindings generated from GIR: OK"
