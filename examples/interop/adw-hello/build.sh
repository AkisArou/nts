#!/bin/sh
# Build a libadwaita application as a C and an LLVM product, plain and under
# reference counting, and run each (see src/main.ts). `G_DEBUG=fatal-criticals`
# turns any GTK or Adwaita complaint that is critical into an end.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-adw-hello"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/adw-hello"

if ! pkg-config --exists gtk4 libadwaita-1; then
  echo "SKIP adw-hello: no gtk4 or libadwaita-1 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP adw-hello: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Adw-1.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP adw-hello: no Adw-1.gir"
  exit 0
fi

expected="status Hello from nts shown true "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in adw adw-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED adw-hello: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "a libadwaita application on both backends and providers: OK"
