#!/bin/sh
# Every launch row's whole program run against node, on C, LLVM and the JVM.
#
#   tooling/gate/launch-agree.sh                 # all of them
#   tooling/gate/launch-agree.sh startup-hello   # one, on each backend
#
# A launch row (benchmarks/cases/<name>/launch.json) times a case.ts that
# exports nothing, so no case calls it: `nts check` runs it once on each side
# and compares its stdout, byte for byte, and its exit status
# (tooling/differential/src/whole_program.rs). Its launch row holds the shipped
# executable's output to node only nightly; this holds the compiled program to
# node at landing, on every backend.
#
# A row with no `program` record yet is pending and compares nothing; the full
# check records it. A row tooling/gate/verdict-policy.ts lists in
# LAUNCH_DECLINES must still decline with the refusal its entry names, and is
# red once it agrees until its entry goes. Anything else short of agreement is
# red, and so is a selection with no launch row in it
# (tooling/differential/launch-agree.ts).
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/tooling/differential/check-consumers.ts" launches "$@"
