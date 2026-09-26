#!/bin/sh
# Build react-gtk's host config into a GTK program that drives it directly and
# run it (see src/main.ts): each logged line is one thing the reconciler will
# ask of the host, checked on real widgets. `G_DEBUG=fatal-warnings` turns
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
input 1 0 65307 97 click2 keys=1 after=0
classes true true>false true>false
interface true true true
grid ab- a-b --b
stack b B Bee
switched b b
notebook 0,1,2 two 2
bar b1>b2 e1>e2 b0>b1 b1>-
overlay true true true>false true
fixed 12,40>5,40
window true true false>true over=true closed=true
popover true true true
slot side,main side,none none,none titled=true
work timer"

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc "$@"
# The build has just written types/gir from this nts's bindings, and
# react-gtk's widgets are generated from them: generated from an older nts's,
# a prop can be missing or name a setter that is gone.
if ! node "$root/runtime/react/packages/react-gtk/tools/gen-widgets.ts" "$source/types/gir" --check >/dev/null; then
  echo "FAILED react-gtk: src/widgets.ts is stale for this nts's bindings; run tools/gen-widgets.ts ../../native/gtk/types/gir" >&2
  exit 1
fi
log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-warnings \
  timeout 30 "$root/examples/interop/with-display.sh" "$out/host/linux-gnu-x86_64/host" 2>/dev/null || true)
if [ "$log" != "$expected" ]; then
  printf 'FAILED react-gtk: expected\n%s\ngot\n%s\n' "$expected" "$log" >&2
  exit 1
fi
echo "react-gtk's host config on GTK widgets: OK"
