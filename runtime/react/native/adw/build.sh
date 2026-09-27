#!/bin/sh
# Build react-gtk's libadwaita widgets (react-gtk/adw) into a program that
# drives them directly, as native/gtk does GTK's, and run it (see src/main.ts).
# `G_DEBUG=fatal-warnings` turns any GTK or libadwaita complaint into an end.
# The desktop's settings cannot add one: XDG_CONFIG_HOME is empty, and
# `GDK_DEBUG=no-portals` keeps GTK from reading the colour scheme through the
# settings portal, which libadwaita warns about when it is dark (and so only
# some hours of the day, on a desktop that switches).
# The program is built twice, through the C and the LLVM backends
# (nts.config.ts), and each must log the same.
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
controlled kept false false 3 0 true false false true
group A,X,B B,A,X B,X X,B suffix=true
toolbar true true
row p1>p2 s1>s2 e1>e2 r1>r2 t1>t2
viewstack b B>Bee switched=b
switcher true true
split true true true
tabs A,B,C>A,D,B,C>C,A,D,B selected=true asked=1 kept=4 attached=0121 true selected=A user=B>A heard=B app=B heard=B C,A,B
pinned P*AB>APB>B*AP>B*PA>PA
carousel abc>adbc>dbac>cdba>dbac>dac
navigation AB>ABC>AB>CAB user>CA>CAB app>CA heard=2
toggles ab active=b acb kept=b Bee ab
dialog true true true true responded=cancel Cancel,OK>Cancel,Delete,OK>Erase false>Cancel,OK
preferences one removed=true shown=one
toasts 1 0
breakpoints A+ | A- B+ | A+
window-breakpoint W+ true false W+ true
application true true
unknown true true
reset true true"

mkdir -p "$out"
"$nts" build "$source/tsconfig.json" --out "$out" --rc "$@"
# The build has just written the GIR bindings from this nts, and
# react-gtk/adw's widgets are generated from them.
if ! node "$root/runtime/react/packages/react-gtk/tools/gen-widgets.ts" "$source" --namespace Adw-1 --check >/dev/null; then
  echo "FAILED react-gtk/adw: src/adw/widgets.ts is stale for this nts's bindings; run tools/gen-widgets.ts ../../native/adw --namespace Adw-1" >&2
  exit 1
fi
# One program per backend (nts.config.ts): each must log the same.
for product in host host-llvm; do
  config=$(mktemp -d)
  log=$(env XDG_CONFIG_HOME="$config" GDK_DEBUG=no-portals GSK_RENDERER=cairo G_DEBUG=fatal-warnings \
    timeout 30 "$root/examples/interop/with-display.sh" "$out/$product/linux-gnu-x86_64/$product" 2>/dev/null || true)
  rmdir "$config"
  if [ "$log" != "$expected" ]; then
    printf 'FAILED react-gtk/adw (%s): expected\n%s\ngot\n%s\n' "$product" "$expected" "$log" >&2
    exit 1
  fi
done
echo "react-gtk's libadwaita widgets, C and LLVM: OK"
