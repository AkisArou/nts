#!/bin/sh
# Build list views over models -- a store, a model the program writes, a
# model sorted and filtered by TypeScript closures -- on C and LLVM, plain and
# under reference counting, and run each (see src/main.ts).
# `G_DEBUG=fatal-criticals` turns any GTK complaint into an end; "bound
# nothing" would mean the factory never ran.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-list"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-list"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-list: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-list: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-list: no Gtk-4.0.gir"
  exit 0
fi

expected="tasks 100 true task 0 spliced 3 2 b listed range 1000000 first line 0 items 1000 sorted apple,banana,fig,kiwi,pear filtered apple,banana bound rows bound tasks bound range "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in list list-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-list: $product ($mode) expected $expected" >&2
      exit 1
    fi
    # An array of objects with nothing at index 1 ends the process there,
    # naming it, before C is handed the NULL.
    holed=$(env NTS_LIST_HOLE=1 GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>&1 >/dev/null || true)
    case "$holed" in
      *"nothing at index 1 cannot cross to C"*) ;;
      *)
        echo "FAILED gtk-list: $product ($mode) did not refuse an array with nothing at index 1: $holed" >&2
        exit 1
        ;;
    esac
  done
done
echo "list views over a GListStore and over a model the program writes, sorted and filtered by TypeScript, on C and LLVM: OK"
