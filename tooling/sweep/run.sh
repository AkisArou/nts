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
[ -f "$work/tsconfig.json" ] || cp "$root/examples/absent/tsconfig.json" "$work/tsconfig.json"
node "$root/tooling/sweep/sweep.mjs" > "$work/src/main.ts"
exec "$root/target/release/nts" check "$work/tsconfig.json"
