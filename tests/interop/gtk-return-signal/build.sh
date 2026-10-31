#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
source="$root/tests/interop/gtk-return-signal"
out=${1:-"$root/target/interop-gtk-return-signal"}
nts=${NTS_BIN:-"$root/target/release/nts"}
if ! pkg-config --exists gtk4 || ! command -v xvfb-run >/dev/null 2>&1; then
  echo "SKIP gtk-return-signal: GTK4 and xvfb-run are required"
  exit 0
fi
mkdir -p "$out"
for mode in nogc rc; do
  flag=--nogc
  [ "$mode" = rc ] && flag=--rc
  for arm in control primary; do
    project="$source"
    [ "$arm" = control ] && project="$source/control"
    "$nts" build "$project/tsconfig.json" --out "$out/$mode/$arm" "$flag"
    for backend in c llvm; do
      binary="$out/$mode/$arm/$backend/linux-gnu-x86_64/$backend"
      GSK_RENDERER=cairo G_DEBUG=fatal-criticals timeout 30 xvfb-run -a "$binary" \
        > "$out/$mode-$arm-$backend.stdout" 2> "$out/$mode-$arm-$backend.stderr"
      diff -u "$project/expected.txt" "$out/$mode-$arm-$backend.stdout"
      printf '%s %s %s: ' "$mode" "$arm" "$backend"
      cat "$out/$mode-$arm-$backend.stdout"
    done
  done
done
