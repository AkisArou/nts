#!/usr/bin/env bash
# Every module's interpreted lane with the module blanked. Any file that still
# passes is a hollow pass.
#
#   tooling/conformance/hollow-lane.sh
#
# The profile has been described as "1,796 of 1,796 with 0 hollow" for a long
# time, and the second half of that had never been measured. `sweep.mjs`
# computes `degenerate` only for the **compiled** path -- `runAddon(module,
# artifact, true)` -- so the interpreted lane, which is where every one of those
# passes lives, had no hollow measurement at all.
#
# `run.mjs --sabotage` blanks the module and keeps its declared dependencies
# intact, so a file that still passes is passing on node's own implementation or
# on nothing. That is the definition, and it is cheap: one run per module.
#
# Measured 2026-09-08 across all twenty-two: **0 files still passing**, against
# 1,832 that pass unblanked. The claim was true. It had just never been checked.
set -u
cd "$(dirname "$0")/../.."

total=0
hollow=0
for dir in runtime/node/*/; do
  module=$(basename "$dir")
  [ -d "$dir/src" ] || continue
  case "$module" in node_modules|internal) continue ;; esac
  line=$(timeout 2400 node tooling/conformance/run.mjs --module "$module" --sabotage 2>&1 |
    grep 'file(s):' | tail -1)
  passed=$(printf '%s' "$line" | sed 's/.*: \([0-9]*\) passed.*/\1/')
  case "$passed" in ''|*[!0-9]*) passed=0 ;; esac
  total=$((total + 1))
  if [ "$passed" -gt 0 ]; then
    hollow=$((hollow + passed))
    printf '  HOLLOW  %-20s %s file(s) pass with the module blanked\n' "$module" "$passed"
  fi
done

echo
if [ "$total" -eq 0 ]; then
  # An empty run is not a clean run: with no module measured, zero hollow passes
  # is a statement about the glob.
  echo "  INSTRUMENT FAILURE: no module was measured at all."
  exit 2
fi
echo "  $total module(s) blanked; $hollow file(s) still passing"
[ "$hollow" -eq 0 ]
