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
# `fuzz-timer-order.mjs` is **in, and it took two repairs to earn that.** It was excluded
# at first, reporting 0 to 2 differing programs across five runs at the same seed and a
# different program each time -- impossible from a deterministic generator if both sides
# are held still. Its header claimed "every program is run twice per scheduler"; the code
# ran *node* twice and this profile once, so only node's nondeterminism was filtered.
# Sampling both twice was necessary and not sufficient, because a near-coin-flip program
# survives it; a candidate divergence is now confirmed three times before it is reported.
# Six consecutive runs clean, and still reporting five divergences when `setImmediate` is
# deliberately replaced with `setTimeout(fn, 0)`.
#
# It runs 150 programs here rather than its default 300, which is **20 seconds against the
# other four checks' one**. That is the whole cost of this step and it buys the only
# regression check on scheduling order; run it with no argument for the wider sweep.
#
# `differential-ts.mjs --all` is excluded for cost rather than doubt -- it is minutes,
# not seconds, and it is clean over 22 modules.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root" || exit 1

status=0
for check in skip-audit stale-exclusions self-oracle fuzz-deep-equal "fuzz-timer-order 150"; do
  started=$(date +%s)
  # `set --` then pass only the arguments that exist. Passing `"${2:-}"` unconditionally
  # handed every argument-less check an empty string, and `fuzz-deep-equal` reads its first
  # argument as a case count: it ran **zero cases and reported ok**. Caught by reading the
  # summary line rather than the exit status, which is the reason this step prints one.
  set -- $check
  output="$(node "tooling/conformance/$1.mjs" "${@:2}" 2>&1)"
  # **`$?` immediately, before anything else runs.** `check="$1"` sat here and `$?` then read
  # *its* status, which an assignment always makes zero -- so every check reported `ok` whatever
  # it found. The gate ran green while `skip-audit` printed "1 without a reason" on the same line.
  #
  # Caught by the control rather than by reading: a deliberately unjustified exclusion was added
  # and the gate stayed green. The summary line had the finding in it the whole time, which is
  # the second time today one channel was right and the one being tested was not.
  code=$?
  check="$1"
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
