#!/bin/sh
# Build a GTK4 program written against the `gi:` surface, as a C and an LLVM
# product, run each plain and under reference counting, and check the log
# (see src/main.ts).
#
# A name the surface failed to rename does not typecheck, so a wrong surface
# fails the build before it runs; what runs checks that the renamed members
# still reach the functions their tags name.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-gi"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-gi"

if ! pkg-config --exists gtk4; then
  echo "SKIP gtk-gi: no gtk4 pkg-config entry"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-gi: no xvfb-run on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Gtk-4.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-gi: no Gtk-4.0.gir"
  exit 0
fi

expected="made hi! 6 true 1 wider 10 order=12 items=1 priority=0 string=64 book Solaris 413 true me title 978 tally count 2 3 "
mkdir -p "$out"
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in gi gi-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 30 xvfb-run -a "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-gi: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
echo "GTK through the gi: surface, on C and LLVM: OK"
