#!/bin/sh
# Build react-gtk's host config into a GTK program that drives it directly and
# run it (see src/main.ts): each logged line is one thing the reconciler will
# ask of the host, checked on real widgets. `G_DEBUG=fatal-criticals` turns
# any GTK complaint -- a widget parented twice, a source removed twice -- into
# an end. It builds with reference counting, as the GTK examples do; the
# default build passes too (since d8889f02 it sinks every widget it makes).
# Further arguments after the output directory go to `nts build`.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
out=${1:-"$root/target/react-native-gtk"}
[ $# -gt 0 ] && shift
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/runtime/react/native/gtk"

if ! pkg-config --exists gtk4; then
  echo "SKIP react-gtk: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP react-gtk: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP react-gtk: no Gtk-4.0.gir"
  exit 0
fi

expected="tree label,button
clicked first@2 after@0
rebound second
label world
inserted label,second,button
moved button,label,second
removed button,second
hidden false true
reset true>false>true clicks=none label=Text
enum 1
single true
argument 2.5@2
list a,b,c a,d,b,c c,a,d,b c,a,d
notify none>typed
controlled a typed flashed=false
object true 42
reference true
decision 1 0 asked=1
work timer"

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc "$@"
log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
  timeout 30 "$root/examples/interop/with-display.sh" "$out/host/linux-gnu-x86_64/host" 2>/dev/null || true)
if [ "$log" != "$expected" ]; then
  printf 'FAILED react-gtk: expected\n%s\ngot\n%s\n' "$expected" "$log" >&2
  exit 1
fi
echo "react-gtk's host config on GTK widgets: OK"
