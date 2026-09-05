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
set -u
bin=${NTS_BIN:-./target-jvm/release/nts}
{ ls -d examples/*/tsconfig.json; ls target/bench/*.tsconfig.json; } |
  xargs -P 8 -n 1 sh -c '
    d=$1
    case "$d" in *"/invalid/"*|*"/unsupported/"*) exit 0 ;; esac
    n=$(basename "$d" .tsconfig.json)
    [ "$n" = tsconfig.json ] && n=$(basename "$(dirname "$d")")
    out=$(NTS_TSGO=target/tsgo NTS_BACKEND=jvm '"$bin"' check "$d" 2>&1)
    # `NTS` narrows this to the *backend* declining a function. `nts check`
    # also reports how many hostile-pool cases the compiled program declined at
    # run time -- an index a `!` promised was in range and was not -- and those
    # are the harness working, on every example, all the time.
    hit=$(printf "%s" "$out" | grep -m1 "not emitted: NTS\|declined: NTS")
    [ -n "$hit" ] && printf "%-26s %s\n" "$n" "$(printf "%s" "$hit" | sed "s/^ *//")"
  ' _
