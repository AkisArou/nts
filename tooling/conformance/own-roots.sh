#!/usr/bin/env bash
# Refusal roots **belonging to each module's own sources**, module by module.
#
#   NTS_BIN=<a pinned copy> tooling/conformance/own-roots.sh
#
# # Why the filter is the whole point
#
# Emitting a module compiles what it imports, so an unfiltered refusal count for `fs`
# includes refusals that belong to `stream`, `buffer` and `internal`. Those numbers are
# real and they answer a different question: *what blocks this module's emit* rather than
# *what this module's own code does that the compiler refuses*.
#
# Only the second is actionable from inside the module. `stream` measured unfiltered gives
# roots in the low thousands; filtered to `runtime/node/stream/` it is **414**, of which
# exactly 2 are the `.then` refusal that a call-site count had suggested was significant.
#
# Both are worth having and they must not be quoted as each other. This prints the filtered
# one, which is the column a module's own INCOMPLETE.md should be arguing about.
#
# # What a root is, and is not
#
# NTS1001 is a root: the compiler declines a construct here. NTS1003 is a *cascade*: this
# function is declined because it calls something already declined. Closing a cascade
# publishes nothing on its own -- the function moves to whatever its next blocker is -- so
# the two columns are counted separately and never summed.
#
# # And `abi` is its own column, because it is migration debt rather than a lowering gap
#
# On 2026-09-14 a new NTS1001 kind appeared:
#
#     foreign function `nts_cluster_self_send` parameter `message` without a native ABI
#     type; use a c_int/c_double brand
#
# It fires at every **call site** of a `declare function` that has not been annotated, so one
# untagged declaration used four times reads as four roots. `cluster` went from 4 own roots to
# 8 between two pins taken the same day, and all four of the new ones were this.
#
# That movement is not about lowering. It appears as the diagnostic lands and disappears as the
# annotations land, and in one total it is indistinguishable from the tree getting worse and
# then better. So it is counted and printed apart, and `roots` means roots that are not
# annotation debt -- the column a module INCOMPLETE.md should be arguing about.
#
# The same day proved a bare count cannot be trusted across pins at all: `path` reported 3
# roots under one pin and 5 under the next with **no change to its source**, because the
# compiler stopped naming symptoms and started naming the cause -- a property `expression` of
# unrepresentable type (`RegExp`) -- at every site instead. Diff the diagnostic *text* between
# pins before believing a delta in a count.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root" || exit 1

compiler="${NTS_BIN:-$root/target/release/nts}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

printf '%-20s %8s %8s %8s %8s   %s\n' module roots abi cascades total "top own root"
for dir in runtime/node/*/; do
  module="$(basename "$dir")"
  [ -f "$dir/tsconfig.json" ] || continue
  log="$out/$module.log"
  NTS_TSGO="$root/target/tsgo" "$compiler" emit-c "$dir/tsconfig.json" \
    --out "$out/$module" --napi > "$log" 2>&1
  # **An emit that failed must not report zero.** `cluster` printed `0 0 0` on the first run
  # of this script, which is implausible for a module importing `child_process` and `net` --
  # and the cause was that it *did not typecheck*, so no refusal was ever emitted. A count
  # over a log that was never written looks exactly like a count over a clean one.
  if ! grep -q "wrote program.c" "$log" 2>/dev/null; then
    printf '%-20s %8s %8s %8s %8s   %s\n' "$module" "-" "-" "-" "-" \
      "EMIT FAILED: $(grep -oE 'TS[0-9]{4}.*|Error: .*' "$log" 2>/dev/null | head -1 | cut -c1-56)"
    continue
  fi
  own="$(grep -F "runtime/node/$module/" "$log" 2>/dev/null || true)"
  all_roots="$(printf '%s\n' "$own" | grep -c 'NTS1001' || true)"
  abi="$(printf '%s\n' "$own" | grep -c 'without a native ABI type' || true)"
  roots="$(( ${all_roots:-0} - ${abi:-0} ))"
  cascades="$(printf '%s\n' "$own" | grep -c 'NTS1003' || true)"
  all="$(grep -c 'NTS1001' "$log" 2>/dev/null || true)"
  # The top root excludes ABI debt for the same reason the column does: it would otherwise be
  # the headline for every module during the migration and name nothing a module can act on.
  top="$(printf '%s\n' "$own" | grep -oE 'NTS1001 .*' | grep -v 'without a native ABI type' | sed 's/`[^`]*`/`X`/g' \
    | cut -c9-58 | sort | uniq -c | sort -rn | head -1 | sed 's/^ *//')"
  printf '%-20s %8s %8s %8s %8s   %s\n' "$module" "${roots:-0}" "${abi:-0}" "${cascades:-0}" "${all:-0}" "$top"
done
