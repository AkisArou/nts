#!/bin/sh
# Every benchmark case run against node, through one backend.
#
#   tooling/gate/bench-agree.sh            # all of them
#   tooling/gate/bench-agree.sh absences   # one, with its output
#
# # The hole this fills, which was a wrong answer for weeks
#
# `benches.sh` compiles every case through both native backends and its header
# says what it does not do: "Nothing runs." `examples` runs the examples.
# `nts-bench` runs each case with **one seed** and compares a checksum. So
# nothing ever ran a benchmark case against the oracle on the hostile pool.
#
# On 2026-09-06 that gap held a wrong answer. `benchmarks/cases/absences` answered
# 2,046,179,082 where node answers 2,046,179,137, for pool value 2147483647:
# the loop counter passes 2^31, the remainder is typed `u32`, and a `u32` lives
# in an `int` slot on the JVM, so `irem` took the sign of a dividend that has
# none. The C lane agreed with node because C has the type. Three green steps,
# one wrong lane, and the case's own seed is 3 so the benchmark could not see
# it either.
#
# A green step is a claim about what it looked at. This one looks at the fifty
# cases nothing else runs.
#
# # Why a floor rather than "all of them"
#
# Nine cases export nothing with scalar arguments and a scalar result, so the
# differential has nothing to build a pool for and says so. That is not a
# failure and it is not agreement either -- it is the same distinction the rest
# of this gate keeps between a refusal and an absence.
#
# **The floor is now every case that can be measured, and the arithmetic says
# so**: 61 benchmark cases compile on all three backends, nine of them have no
# pool, and 61 - 9 = 52. It sat at 41 while the tree produced 52, which is a
# ratchet eleven teeth behind -- eleven cases could have stopped agreeing with
# node and this step would still have printed green. A floor that has slipped is
# not a loose ratchet, it is an absent one.
#
# Raised off `pinned.sh` on 44f8287e, from its own worktree, which printed no
# `NOT A COMMIT` line -- the rule `all.sh` states beside the example floors, for
# the reason recorded there: a floor taken from a run that counted somebody's
# untracked directory is a claim about that directory and goes red when they
# revert it.
#
# The count is the **jvm** backend's, which is the one `all.sh` runs. Another
# backend may measure a different set; `NTS_BENCH_AGREE_FLOOR` is how to say so
# rather than editing this.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/tooling/differential/check-consumers.ts" benchmarks "$@"
