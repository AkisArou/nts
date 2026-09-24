#!/bin/sh
# Build a list view over a model of a thousand rows under reference counting
# and run it (see src/main.ts). `G_DEBUG=fatal-criticals` turns any GTK
# complaint into an end; "bound nothing" would mean the factory never ran.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-list"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-list"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-list: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-list: no xvfb-run on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-list: no Gtk-4.0.gir"
  exit 0
fi

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc
log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
  timeout 30 xvfb-run -a "$out/list/linux-gnu-x86_64/list" 2>/dev/null | tr '\n' ' ' || true)
echo "log: $log"
[ "$log" = "items 1000 bound rows " ] || { echo "FAILED gtk-list: expected items 1000 bound rows" >&2; exit 1; }
echo "a list view over a GListStore, its rows bound by a factory: OK"
