#!/bin/sh
# The corpus: Workbench's Library demos (CC0, github.com/workbenchdev/demos)
# ported to TypeScript in examples/gjs-corpus, each run on nts -- C and LLVM,
# plain and under reference counting -- and against the original under GJS
# (host.js), driven by the port's `driver.txt`. A demo passes when every arm's
# log is the original's.
#
#   NTS_WORKBENCH_DEMOS=<clone>/src sh tooling/gjs-corpus/run.sh [out]
#
# The originals are not in this repository: the harness reads them from a
# clone, and says so rather than passing when it has none. A port names its
# original in `upstream` (`Button` is src/Button).
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
nts=${NTS_BIN:-"$root/target/release/nts"}
out=${1:-"$root/target/gjs-corpus"}
demos=${NTS_WORKBENCH_DEMOS:-}
if [ -z "$demos" ] || [ ! -d "$demos" ]; then
  echo "SKIP gjs-corpus: set NTS_WORKBENCH_DEMOS to a clone of workbenchdev/demos' src"
  exit 0
fi
for tool in gjs Xvfb pkg-config; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP gjs-corpus: no $tool"; exit 0; }
done
# A snapshot cache of the run's own: a shared one makes what compiles depend
# on what other sessions built.
export NTS_SNAPSHOT_CACHE="${NTS_SNAPSHOT_CACHE:-$out/snapshot-cache}"
export GSK_RENDERER=cairo
mkdir -p "$out"
passed=0
total=0
printf '| demo | C | LLVM | C --rc | LLVM --rc |\n|---|---|---|---|---|\n'
for port in "$root"/examples/gjs-corpus/*/; do
  port=${port%/}
  [ -f "$port/upstream" ] || continue
  name=$(basename "$port")
  upstream=$(cat "$port/upstream")
  total=$((total + 1))
  expected="$out/$name.gjs.log"
  NTS_CORPUS_DEMO="$port" timeout 30 "$root/examples/interop/with-display.sh" \
    gjs -m "$here/host.js" "$demos/$upstream/main.js" 2>&1 |
    sed -n 's/^Gjs-Console-Message: [0-9:.]*: //p' > "$expected" || true
  row="| $name"
  all=yes
  for mode in plain rc; do
    flag=""
    [ "$mode" = rc ] && flag="--rc"
    # shellcheck disable=SC2086
    if ! "$nts" build "$port/tsconfig.json" --out "$out/$name/$mode" $flag > "$out/$name.$mode.build" 2>&1; then
      row="$row | refused | refused"
      all=no
      continue
    fi
    for product in demo demo-llvm; do
      binary="$out/$name/$mode/$product/linux-gnu-x86_64/$product"
      log="$out/$name.$mode.$product.log"
      if [ ! -x "$binary" ]; then
        verdict=refused
      elif ! NTS_CORPUS_DEMO="$port" G_DEBUG=fatal-criticals timeout 30 "$root/examples/interop/with-display.sh" "$binary" > "$log" 2>/dev/null; then
        verdict=crashed
      elif cmp -s "$log" "$expected" && [ -s "$expected" ]; then
        verdict=ok
      else
        verdict=differs
      fi
      [ "$verdict" = ok ] || all=no
      row="$row | $verdict"
    done
  done
  echo "$row |"
  [ "$all" = yes ] && passed=$((passed + 1))
done
echo
echo "gjs-corpus: $passed of $total ported demo(s) pass on every arm"
