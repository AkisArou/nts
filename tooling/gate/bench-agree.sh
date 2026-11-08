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
# none. The C backend agreed with node because C has the type. Three green steps,
# one wrong backend, and the case's own seed is 3 so the benchmark could not see
# it either.
#
# A green step is a claim about what it looked at. This one looks at the fifty
# cases nothing else runs.
#
# # What it holds each case to: its run record
#
# Each benchmark's run on this backend is a row of
# results/benchmarks/<backend>/runs.tsv (tooling/bench/run-outcomes.ts): it
# agrees, it has no scalar export, it is refused, it aborts, it times out, or
# it answers wrongly. A row that reproduces passes, a loud defect included: on
# 11-07 awfy-json and awfy-storage aborted on the JVM with a VerifyError
# (#265), and with no record of a known per-backend failure this step went red
# on main. A change the shared ratchet accepts passes and is listed; anything
# else, getting worse first, is red. A benchmark with no row is pending and
# does not run here; the full check writes its row after landing
# (`check-consumers.ts benchmarks --record-pending`, run by
# tooling/records/record-pending.ts). The record replaces the agreement floor
# this step used to keep.
#
# The backend is the JVM's unless NTS_BACKEND says otherwise; each backend has
# its own record.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/tooling/differential/check-consumers.ts" benchmarks "$@"
