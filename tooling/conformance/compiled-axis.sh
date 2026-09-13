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
#
# # And an addon that loads can still publish nothing
#
# Worse than not loading, because nothing fails. A `shape.mjs` reads `exports.default`
# and several addons do not export one, so `shape` takes its blank-module branch and
# the lane publishes `{}`. Every test then runs, and the ones that select their own
# subject -- `if (cluster.isWorker) ... else if (cluster.isPrimary) ...` -- take
# neither branch and pass having asserted nothing.
#
# `cluster` read **25 passed** that way, which was the whole of its compiled row, and
# the figure reached a ledger and a goal file before anybody asked what
# `require('cluster')` returns on that lane. It returns an object with zero keys. Its
# own `shape.mjs` documents this hollowness for `--sabotage`; the compiled lane
# reproduced it without any sabotage at all.
#
# So `shaped-surface.mjs` runs before the tests and a module publishing nothing is
# printed as that, not as N passes.
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
    if ! node "$root/tooling/conformance/shaped-surface.mjs" "$out" "$module" \
        > "$out/$module.surface.log" 2>&1; then
      # **A module publishing nothing still gets both arms, because the guard is blunt
      # in both directions.** `timers` publishes nothing under its own name while its
      # local fixtures reach `getTimerDuration` through `require("internal/timers")`, a
      # separately substituted specifier -- two real passes that skipping the module
      # threw away, and the axis read 48 where 50 was right.
      #
      # So run it, run it again emptied, and keep only the passes that do not survive
      # emptying. That is `--sabotage`'s question asked per file, and it is exact:
      # `cluster` keeps all 25 of its passes when emptied (hollow, contributes 0) and
      # `timers` keeps none of its 2 (real, contributes 2).
      intact_p="$out/$module.intact.txt"
      empty_p="$out/$module.empty.txt"
      NTS_CONFORMANCE_ALLOW_EMPTY_SURFACE=1 NTS_CONFORMANCE_TIMEOUT_MS=20000 \
        timeout 900 node "$root/tooling/conformance/run.mjs" --module "$module" \
        --addon "$out/$module.node" --verbose 2>&1 |
        awk '/^ *pass  /{print $2}' | sort > "$intact_p"
      NTS_CONFORMANCE_TIMEOUT_MS=20000 \
        timeout 900 node "$root/tooling/conformance/run.mjs" --module "$module" \
        --addon "$out/$module.node" --empty-exports --verbose 2>&1 |
        awk '/^ *pass  /{print $2}' | sort > "$empty_p"
      real=$(comm -23 "$intact_p" "$empty_p" | sed '/^$/d' | wc -l)
      hollow=$(comm -12 "$intact_p" "$empty_p" | sed '/^$/d' | wc -l)
      printf '%-20s PUBLISHES NOTHING -- %s real pass(es), %s that survive emptying\n' \
        "$module" "$real" "$hollow"
      total_pass=$(( total_pass + real ))
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
