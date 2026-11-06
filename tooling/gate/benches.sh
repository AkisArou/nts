#!/bin/sh
# Check every compile-scope outcome, including recorded refusals and defects.
# Scalar and canonical workload agreement have separate coverage.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
exec node tooling/bench/build-records.ts --check "$@"
