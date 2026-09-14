#!/usr/bin/env bash
# The divergence checks that are cheap and deterministic, in one step.
#
#   tooling/conformance/divergence.sh
#
# # Why this exists
#
# `tooling/conformance` holds nine instruments that compare this profile with node, or
# audit the lists that decide what gets compared. On 2026-09-14 **not one of them was
# invoked by anything** -- not by the gate, not by another script. `blockers-check.mjs`
# is in `tooling/gate/all.sh` and `differential-addon.mjs` is reached from
# `counted-lane.sh`; the rest ran only when a person remembered them.
#
# Running them once that day found a real correctness bug that node's whole suite does
# not reach -- `isDeepStrictEqual` never compared symbol keys, so `{ [s]: 1 }` and
# `{ [s]: 2 }` were deep-strict-equal -- and a compiled-lane bug where the name passed
# to a validator is discarded in favour of the caller's parameter identifier. An
# instrument that finds a bug the first time it is run has been worth running for
# however long it sat there.
#
# # What is in, and what is deliberately not
#
# Everything here is **fast and deterministic**: four of them finish in under a second
# and `fuzz-deep-equal` in one. A gate step that costs a second is one nobody argues
# about, and the shared tree runs gates continuously.
#
# `fuzz-timer-order.mjs` is **excluded and this is the reason**, so it is not silently
# forgotten. It reported 0 to 2 differing programs across five runs at the *same* seed,
# and a different program each time:
#
#     213 agree, 2 differ, 87 skipped      211 agree, 0 differ, 79 skipped
#     231 agree, 2 differ, 69 skipped      216 agree, 0 differ, 84 skipped
#     228 agree, 1 differ, 72 skipped
#
# Its filter runs each program twice per scheduler and skips one that disagrees with
# itself. Two samples is a weak stability test under load, so timing-sensitive programs
# reach the comparison and read as divergences. Whether any of them is a real ordering
# bug is unsettled: the next step is to take one diverging program and run it many times
# against node alone, and a filter that samples more than twice is what would let this
# join the list.
#
# `differential-ts.mjs --all` is excluded for cost rather than doubt -- it is minutes,
# not seconds, and it is clean over 22 modules.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root" || exit 1

status=0
for check in skip-audit stale-exclusions self-oracle fuzz-deep-equal; do
  started=$(date +%s)
  output="$(node "tooling/conformance/$check.mjs" 2>&1)"
  code=$?
  elapsed=$(( $(date +%s) - started ))
  if [ "$code" -eq 0 ]; then
    # The line each tool counts on, rather than whatever it printed last: `self-oracle`
    # ends with its per-file `ok (child)` list and `stale-exclusions` with a caveat, so
    # `tail -1` reported neither tool's result.
    summary="$(printf '%s' "$output" \
      | grep -E 'entr\(ies\)|exclusion\(s\)|local test\(s\)|agree,' \
      | tail -1)"
    printf '  %-20s ok   %2ss  %s\n' "$check" "$elapsed" "$(printf '%s' "${summary:-$(printf '%s' "$output" | tail -1)}" | sed 's/^ *//' | cut -c1-96)"
  else
    status=1
    printf '  %-20s FAIL %2ss  exit %s\n' "$check" "$elapsed" "$code"
    printf '%s\n' "$output" | sed 's/^/      /'
  fi
done

exit "$status"
