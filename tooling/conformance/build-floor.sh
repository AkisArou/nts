#!/usr/bin/env bash
# The modules that compile today, and a refusal when one stops.
#
#   tooling/conformance/build-floor.sh
#   NTS_COMPILER=<a pinned copy> tooling/conformance/build-floor.sh
#
# Emitting C and compiling it are different claims, and only one of them was
# being checked. The gate's `profile` step emits C for all twenty-two modules
# and never runs a compiler over any of it, so a change that breaks the
# compilation of every node module passes the gate green. That is not
# hypothetical: on 2026-09-08 a prototype in `internal/nts_node.h` stopped
# matching what the backend emitted, `buffer` and `string_decoder` went from
# building to not building, and the gate carrying that change was green.
#
# It was caught by rebuilding everything for an unrelated measurement. That is
# luck, and this is the check that replaces it.
#
# A floor rather than a target. It does not care how many modules build; it
# cares that the ones which did still do. Raise `FLOOR` when a module joins --
# deliberately, in a commit that says why -- and never lower it to make a run
# pass, which is the one thing that would make it worthless.
set -u
cd "$(dirname "$0")/../.."

# Measured 2026-09-08 on the compiler lane's gate binary, from a pinned tree.
FLOOR="async_hooks buffer diagnostics_channel os path punycode querystring string_decoder url"

compiler=${NTS_COMPILER:-${NTS_BIN:-$PWD/target/release/nts}}
if [ ! -x "$compiler" ]; then
  echo "  no compiler at $compiler; the compiler lane builds it" >&2
  exit 2
fi

failures=0
built=0
for module in $FLOOR; do
  printf '  %-22s ' "$module"
  out=$(NTS_COMPILER="$compiler" NTS_BIN="$compiler" \
    timeout 1800 bash tooling/conformance/build.sh "$module" 2>&1)
  if printf '%s' "$out" | grep -q 'bytes$'; then
    echo "builds"
    built=$((built + 1))
    continue
  fi
  echo "REGRESSED -- was building on 2026-09-08 and no longer does"
  printf '%s\n' "$out" | grep -E 'error:' | head -3 | sed 's/^/                         /'
  failures=$((failures + 1))
done

echo
if [ "$built" -eq 0 ] && [ "$failures" -eq 0 ]; then
  # An empty floor is not a clean run. The list is written above rather than
  # derived, so a typo in it reads as success unless this says otherwise.
  echo "  INSTRUMENT FAILURE: the floor list is empty."
  exit 2
fi
echo "  $built of $(printf '%s\n' $FLOOR | wc -l | tr -d ' ') still build, $failures regressed"
[ "$failures" -eq 0 ]
