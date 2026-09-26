#!/bin/sh
# Build the journal (see src/main.ts) on C and LLVM, plain and under
# reference counting, and run its workload on each against the seeded file:
# the log -- counts, the sort's head, the chart's peak, the save's bytes --
# must be the one its GJS twin (tooling/gtk-bench/gjs/journal.js) prints too.
# `ms` lines are timings and are left out. `G_DEBUG=fatal-criticals` turns any
# GTK complaint into an end.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-journal"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-journal"

if ! pkg-config --exists gtk4 libadwaita-1; then
  echo "SKIP gtk-journal: no gtk4 or libadwaita-1 pkg-config entry"
  exit 0
fi
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "SKIP gtk-journal: no Xvfb on PATH"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/Adw-1.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-journal: no Adw-1.gir"
  exit 0
fi

"$source/seed.sh" 5000 > /tmp/nts-gtk-journal.txt
expected="loaded 5000 searched 26427 sorted river 0 added 5200 edited 199 edits 823 charted 50 peak 442 deleted 5199 saved 5199 515362 "
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in journal journal-llvm; do
    log=$(env GSK_RENDERER=cairo G_DEBUG=fatal-criticals \
      timeout 60 "$root/examples/interop/with-display.sh" "$out/$mode/$product/linux-gnu-x86_64/$product" 2>/dev/null | grep -v '^ms ' | tr '\n' ' ' || true)
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ]; then
      echo "FAILED gtk-journal: $product ($mode) expected $expected" >&2
      exit 1
    fi
  done
done
rm -f /tmp/nts-gtk-journal.txt /tmp/nts-gtk-journal-saved.txt
echo "a libadwaita journal, its workload on C and LLVM: OK"
