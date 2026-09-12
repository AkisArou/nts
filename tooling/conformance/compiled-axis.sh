#!/usr/bin/env bash
# The compiled axis, totalled: every module built from one compiler and run
# against the artifact.
#
#   NTS_BIN=<a pinned copy> NTS_ADDON_OUT=<a private dir> \
#     tooling/conformance/compiled-axis.sh
#
# # Why this is its own script
#
# `check.sh` answers one module and `counted-lane.sh` answers the reference
# provider. Neither prints the lane-level total, and that total is the number the
# goal text calls the axis -- so it was being quoted from the ledger rather than
# re-measured, and a quoted number is a claim. On 2026-09-12 the quote was 45
# across 22 modules and the measurement was 49 across 24.
#
# # Read it against the interpreted lane, never alone
#
# `stream` is 252 passed / 0 failed interpreted and 1 passed / 251 failed compiled,
# on the same corpus and the same source. A sentence about "the profile passes N
# files" that does not say which lane is not a number. This prints one line per
# module so the shape is visible and not just the sum.
#
# # What it does not claim
#
# That a module at zero is broken. Seven are at zero because the boundary cannot
# build what their surface returns, which is a different fact from a failing test
# and is why `compiled-coverage.mjs` exists beside this.
#
# # An addon that does not load is one fact, not N failures
#
# A shared object links with undefined symbols -- they resolve at load -- so the
# compiler can emit a call to a function it never defined, `clang` will link it, and
# `build.sh` exits 0. `process` did exactly that on 2026-09-13: `addon.c` declares and
# calls `module__init`, `program.c` defines it in no translation unit, and the row read
# **92 failed** when the truth was one `undefined symbol: module__init` repeated 92
# times. So each artifact is loaded once before its tests run, and a failure to load is
# printed as itself. Measured across the 26: 25 load, `process` does not.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root" || exit 1

out="${NTS_ADDON_OUT:-$root/target/node}"
mkdir -p "$out"
total_pass=0
total_fail=0

for dir in runtime/node/*/; do
  module="$(basename "$dir")"
  [ -f "$dir/tsconfig.json" ] || continue
  if NTS_ADDON_OUT="$out" timeout 1200 bash "$root/tooling/conformance/build.sh" \
      "$module" > "$out/$module.build.log" 2>&1; then
    if ! loaderr="$(node -e 'require(process.argv[1])' "$out/$module.node" 2>&1)"; then
      printf '%-20s WILL NOT LOAD -- %s\n' "$module" \
        "$(printf '%s' "$loaderr" | tr '\n' ' ' | sed 's/.*: //' | cut -c1-60)"
      continue
    fi
    line="$(timeout 900 node "$root/tooling/conformance/run.mjs" \
      --module "$module" --addon "$out/$module.node" 2>&1 | tail -1)"
    printf '%-20s %s\n' "$module" "$line"
    pass="$(printf '%s' "$line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')"
    fail="$(printf '%s' "$line" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')"
    total_pass=$(( total_pass + ${pass:-0} ))
    total_fail=$(( total_fail + ${fail:-0} ))
  else
    printf '%-20s BUILD FAILED -- see %s\n' "$module" "$out/$module.build.log"
  fi
done

printf '\n%-20s %s passed, %s failed\n' "TOTAL" "$total_pass" "$total_fail"
