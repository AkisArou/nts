#!/bin/sh
# Every example, compiled and run and compared against node.
#
#   tooling/gate/gate.sh           # all of them, in parallel
#   tooling/gate/gate.sh cycles    # one, with its output
#   NTS_GATE_JOBS=4 tooling/gate/gate.sh
#
# This is the correctness gate. The corpus in `nts-suite` checks that arbitrary
# input does not produce invalid IR, and the profile in `runtime/node` measures
# how much real code lowers -- neither of them runs anything. Only this compares
# an answer against node's, case by case, which is why a green run here is what
# "it works" means.
#
# Parallel because it is 73 independent subprocess trees and the feedback is
# worth having in two minutes rather than forty. Each `nts check` bounds its own
# children in time and memory -- see `MEMORY` in tooling/differential -- so the
# only thing to size here is how many run at once.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/tooling/differential/check-consumers.ts" programs "$@"
