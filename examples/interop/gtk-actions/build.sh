#!/bin/sh
# Build an application with actions, a menu, accelerators and a style
# provider, on C and LLVM, plain and under reference counting, and run each
# (see src/main.ts). `G_DEBUG=fatal-criticals` turns any GTK complaint into
# an end -- which is the control for the constructor the literal chose: a
# stateless `dark` would take `change_action_state` as a critical.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-actions"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-actions"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-actions: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-actions: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-actions: no Gtk-4.0.gir"
  exit 0
fi

expected="count 2 dark true accels <Control>b big true "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in actions actions-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-actions: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "an application's actions, menu, accelerators and style, on C and LLVM: OK"
