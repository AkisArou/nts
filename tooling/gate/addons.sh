#!/bin/sh
# Every node module built as an addon, and loaded.
#
#   tooling/gate/addons.sh
#
# Two scripts, in the only order that works: `build-floor.sh` compiles each
# module and refuses when one that used to build stops, and `loads.sh` requires
# each artifact under eager binding and refuses when one crashes or leaves a
# symbol unresolved.
#
# They are together here because neither is worth running without the other.
# Building and loading are different claims, and on 2026-09-09 the gap between
# them held a segfault: `os.node` died inside `nts_map_set` during
# `module__init`, every `os` test failed as a crashed child, and the floor said
# "22 of 22 still build" throughout, because it was true.
#
# `NTS_BIN` for the reason every other step takes it -- three sessions build
# into different directories, and a hard-coded path measures somebody else's
# binary.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

NTS_COMPILER=${NTS_BIN:-$root/target/release/nts}
export NTS_COMPILER
NTS_TSGO=${NTS_TSGO:-$root/target/tsgo}
export NTS_TSGO

bash tooling/conformance/build-floor.sh
bash tooling/conformance/loads.sh
