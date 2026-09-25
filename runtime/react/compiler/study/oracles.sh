#!/usr/bin/env bash
# Every nts-react oracle over one study set, with its control arms.
#
# usage: oracles.sh <study-dir> <set>...
#   <study-dir> holds node_modules and, per set, <set>/orig (sources and a
#   tsconfig.json) and <set>/all-modes.txt; corpus/compile holds the options.
#   NTS_REACT names the binary (default: the lane's debug build), NTS_TSGO
#   the tsgo it drives (default: the repository's target/tsgo).
#   ORACLE_WORK keeps the outputs there for reading; otherwise they are
#   written to a temporary directory and removed.
set -euo pipefail
shopt -s nullglob

study=$(cd "$1" && pwd)
shift
here=$(cd "$(dirname "$0")" && pwd)
bin=${NTS_REACT:-$HOME/.cache/nts-react/target/debug/nts-react}
# A binary built outside the repository cannot find the repository's tsgo.
NTS_TSGO=${NTS_TSGO:-$(cd "$here/../../../.." && pwd)/target/tsgo}
export NTS_TSGO
if [[ -n ${ORACLE_WORK:-} ]]; then
  work=$ORACLE_WORK
else
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
fi
export NODE_PATH=$study/node_modules
cd "$study"

summary() { tail -n 1 | cut -c1-160; }

for set in "$@"; do
  echo "== $set"
  "$bin" convert "$set/orig/tsconfig.json" "$work/$set/conv" > /dev/null 2>&1
  sources=("$set"/orig/*.ts "$set"/orig/*.tsx)
  printf 'convert   '; node "$here/convert-diff.cjs" "$work/$set/conv" "${sources[@]}" 2> /dev/null | tail -n 2 | head -n 1 | cut -c1-160
  printf 'scope     '; node "$here/scope-diff.cjs" "$work/$set/conv" "${sources[@]}" 2> /dev/null | tail -n 2 | head -n 1 | cut -c1-160
  printf 'compile   '; node "$here/compile-diff.cjs" "$bin" "$set/orig/tsconfig.json" "$work/$set/cd" "$set/all-modes.txt" 2> /dev/null | summary
  printf 'comp ctl  '; COMPILE_CONTROL=1 node "$here/compile-diff.cjs" "$bin" "$set/orig/tsconfig.json" "$work/$set/cdc" "$set/all-modes.txt" 2> /dev/null | summary
  for mode in infer all; do
    "$bin" compile "$set/orig/tsconfig.json" "corpus/compile/options-$mode.json" "$work/$set/plain/$mode" > /dev/null 2>&1
    "$bin" compile "$set/orig/tsconfig.json" "corpus/compile/options-$mode.json" "$work/$set/lowered/$mode" --lower-jsx > /dev/null 2>&1
  done
  printf 'print     '; node "$here/print-diff.cjs" "$work/$set/plain" "$set/all-modes.txt" | summary
  printf 'print ctl '; PRINT_CONTROL=1 node "$here/print-diff.cjs" "$work/$set/plain" "$set/all-modes.txt" | summary
  printf 'jsx       '; node "$here/jsx-diff.cjs" "$work/$set/plain" "$work/$set/lowered" "$set/all-modes.txt" | summary
  printf 'jsx ctl   '; JSX_CONTROL=1 node "$here/jsx-diff.cjs" "$work/$set/plain" "$work/$set/lowered" "$set/all-modes.txt" | summary
done
