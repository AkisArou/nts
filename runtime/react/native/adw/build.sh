#!/bin/sh
# Build react-gtk's libadwaita widgets (react-gtk/adw) into a program that
# drives them directly, as native/gtk does GTK's, and run it (see src/main.ts).
# `G_DEBUG=fatal-warnings` turns any GTK or libadwaita complaint into an end.
# The desktop's settings cannot add one: XDG_CONFIG_HOME is empty, and
# `GDK_DEBUG=no-portals` keeps GTK from reading the colour scheme through the
# settings portal, which libadwaita warns about when it is dark (and so only
# some hours of the day, on a desktop that switches).
# Further arguments after the output directory go to `nts build`.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
out=${1:-"$root/target/react-native-adw"}
[ $# -gt 0 ] && shift
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/runtime/react/native/adw"

if ! pkg-config --exists gtk4 libadwaita-1; then
  echo "SKIP react-gtk/adw: no gtk4 or libadwaita-1 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP react-gtk/adw: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Adw-1.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP react-gtk/adw: no Adw-1.gir"
  exit 0
fi

expected="props true true
slot true true
signal 1
controlled kept
group A,X,B B,A,X B,X suffix=true
toolbar true true
row p1>p2 s1>s2 e1>e2
application true true
unknown true true
reset true true"

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc "$@"
# The build has just written types/gir from this nts's bindings, and
# react-gtk/adw's widgets are generated from them.
if ! node "$root/runtime/react/packages/react-gtk/tools/gen-widgets.ts" "$source/types/gir" --namespace Adw-1 --check >/dev/null; then
  echo "FAILED react-gtk/adw: src/adw/widgets.ts is stale for this nts's bindings; run tools/gen-widgets.ts ../../native/adw/types/gir --namespace Adw-1" >&2
  exit 1
fi
config=$(mktemp -d)
log=$(env XDG_CONFIG_HOME="$config" GDK_DEBUG=no-portals GSK_RENDERER=cairo G_DEBUG=fatal-warnings \
  timeout 30 "$root/examples/interop/with-display.sh" "$out/host/linux-gnu-x86_64/host" 2>/dev/null || true)
rmdir "$config"
if [ "$log" != "$expected" ]; then
  printf 'FAILED react-gtk/adw: expected\n%s\ngot\n%s\n' "$expected" "$log" >&2
  exit 1
fi
echo "react-gtk's libadwaita widgets: OK"
