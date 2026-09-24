#!/bin/sh
# Build the notes application under reference counting and run it twice from
# an empty file: the second run must load what the first saved (see
# src/main.ts). `G_DEBUG=fatal-criticals` turns any GTK complaint into an end.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-notes"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-notes"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-notes: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-notes: no xvfb-run on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-notes: no Gtk-4.0.gir"
  exit 0
fi

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc
file=/tmp/nts-gtk-notes.txt
rm -f "$file"
run() {
  env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
    timeout 30 xvfb-run -a "$out/notes/linux-gnu-x86_64/notes" 2>/dev/null | tr '\n' ' ' || true
}
first=$(run)
second=$(run)
saved=$(tr '\n' ' ' < "$file")
rm -f "$file"
echo "first:  $first"
echo "second: $second"
echo "saved:  $saved"
[ "$first" = "loaded 0 added milk,bread,tea count 3 notes saved 3 " ] || { echo "FAILED gtk-notes: first run" >&2; exit 1; }
[ "$second" = "loaded 3 added milk,bread,tea count 6 notes saved 6 " ] || { echo "FAILED gtk-notes: second run" >&2; exit 1; }
[ "$saved" = "milk bread tea milk bread tea " ] || { echo "FAILED gtk-notes: the saved file" >&2; exit 1; }
echo "a notes application on GIR bindings, its file loaded and saved: OK"
