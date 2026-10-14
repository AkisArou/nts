#!/usr/bin/env bash
# Generate the cross-product and settle it against node.
#
#   tooling/sweep/run.sh
#
# Writes a throwaway project and runs the differential harness over it, which
# drives every exported function against node and compares bit patterns.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="${1:-$root/target/sweep}"
mkdir -p "$work/src"
# Written rather than copied from a fixture: a fixture's `extends` counts its
# own depth, and this directory is not at it.
[ -f "$work/tsconfig.json" ] || printf '{ "extends": "%s/tsconfig.fixtures.json", "include": ["src"] }\n' "$root" > "$work/tsconfig.json"
node "$root/tooling/sweep/sweep.mjs" > "$work/src/main.ts"
exec "${NTS_BIN:-$root/target/release/nts}" check "$work/tsconfig.json"
