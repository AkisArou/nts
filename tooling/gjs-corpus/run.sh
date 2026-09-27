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
# The ports' configs import `@nts/config`, which is this repository's: linked
# where node resolves it from them, as a fresh checkout has no link yet.
config="$root/examples/gjs-corpus/node_modules/@nts/config"
if [ ! -e "$config" ]; then
  mkdir -p "$(dirname "$config")"
  ln -s ../../../../tooling/config "$config"
fi
# Each demo's first blocker, for ranking what to build by how many demos it
# clears: the port, and the first refusal its build reported.
ledger="$out/ledger.tsv"
: > "$ledger"
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
    gjs -m "$here/host.js" "$demos/$upstream/main.js" > "$expected" 2>/dev/null || true
  row="| $name"
  all=yes
  for mode in plain rc; do
    flag=""
    [ "$mode" = rc ] && flag="--rc"
    # shellcheck disable=SC2086
    # `nts build` refuses a function and still exits 0, so the build's own
    # report says whether the program is the one its source describes.
    if ! "$nts" build "$port/tsconfig.json" --out "$out/$name/$mode" $flag > "$out/$name.$mode.build" 2>&1 ||
      grep -q "NTS100[13]" "$out/$name.$mode.build"; then
      row="$row | refused | refused"
      all=no
      if [ "$mode" = plain ]; then
        # The first refusal, or where the program does not typecheck, the
        # first thing the checker said.
        blocker=$(grep -m1 "NTS1001" "$out/$name.$mode.build" | sed 's/^[^ ]* NTS1001 //' || true)
        [ -n "$blocker" ] || blocker=$(grep -m1 -E "^TS[0-9]+ " "$out/$name.$mode.build" || true)
        printf '%s\t%s\n' "$name" "${blocker:-the build failed}" >> "$ledger"
      fi
      continue
    fi
    for product in demo demo-llvm; do
      binary="$out/$name/$mode/$product/linux-gnu-x86_64/$product"
      log="$out/$name.$mode.$product.log"
      if [ ! -x "$binary" ]; then
        verdict=refused
      elif ! NTS_CORPUS_DEMO="$port" NTS_CORPUS_UPSTREAM="$demos/$upstream" G_DEBUG=fatal-criticals timeout 30 "$root/examples/interop/with-display.sh" "$binary" > "$log" 2>/dev/null; then
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
if [ -s "$ledger" ]; then
  echo
  echo "blockers, by how many demos each stops ($ledger):"
  cut -f2 "$ledger" | sort | uniq -c | sort -rn
fi
