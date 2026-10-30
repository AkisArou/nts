#!/bin/sh
# Every example and bench case the JVM backend declines, and the first reason.
#
#   tooling/gate/declines.sh
#   NTS_BIN=target-jvm/release/nts tooling/gate/declines.sh
#
# The gate answers this too, and takes six minutes and a shared machine to do
# it, because it also runs every program against node and compares bit patterns.
# That is the right question to ask before publishing and the wrong one to ask
# thirty times while changing an emitter.
#
# A codegen change can make exactly one thing worse on its own: something stops
# being emitted. This asks that and nothing else, over 109 examples and 50 bench
# cases, eight at a time, in well under a minute -- so a representation change
# can be iterated against the whole corpus instead of against whichever three
# examples came to mind.
#
# It found the fourth bug in `narrow.rs`, a narrowed `0` stored into a `J`
# field, in an example no bench case reaches.
#
# Output is one line per decline. Silence is the answer you want, and the three
# standing ones -- `dates`, `symbol-keyed-map`, `symbol-values` -- are gaps this
# lane names rather than regressions.
#
# Not reported: the hostile-pool cases a *compiled program* declines at run time.
# Those are the harness doing its job on every example and they drown the signal
# forty lines deep, which is how the first version of this was useless.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
bin=${NTS_BIN:-./target-jvm/release/nts}
for config in tests/programs/*/tsconfig.json target/bench/*.tsconfig.json; do
  [ ! -f "$config" ] || printf "%s\n" "$config"
done |
  xargs -r -P 8 -n 1 sh -c '
    bin=$1
    root=$2
    d=$3
    case "$d" in *"/invalid/"*|*"/unsupported/"*) exit 0 ;; esac
    n=$(basename "$d" .tsconfig.json)
    [ "$n" = tsconfig.json ] && n=$(basename "$(dirname "$d")")
    # Backend-stage fields exclude runtime declines without reading sentences.
    hit=$(NTS_CHECKERS=1 NTS_BACKEND=jvm node "$root/tooling/differential/check-report.ts" project backend-refusals "$bin" "$d") || exit $?
    if [ -n "$hit" ]; then
      printf "%-26s %s\n" "$n" "$(printf "%s\n" "$hit" | head -n 1)"
    fi
  ' _ "$bin" "$root"
