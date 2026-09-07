#!/usr/bin/env bash
# Every module that builds, built and tested under the counted provider.
#
#   tooling/conformance/counted-lane.sh
#   NTS_COMPILER=<a pinned copy> tooling/conformance/counted-lane.sh
#
# The default provider never frees, so it is *structurally* unable to see a
# whole class of defect: a release too few leaks where nobody looks, and a
# release too many is never observed. `NTS_CONFORMANCE_RC=1` selects reference
# counting -- both halves, see `build.sh` -- and `-DNTS_POISON=1` rides along so
# a freed or unwritten slot reads `a5d03c3c3c3c3c3c` rather than as a zero
# indistinguishable from a legitimate one.
#
# Reading a result. Three outcomes are different work:
#
#   pass             the module behaves the same counted as uncounted
#   invalid HIR      almost certainly a compiler-side liveness problem, not a
#                    module problem -- if it compiles *without* the flag, send
#                    the compiler lane the function name and block numbers and
#                    nothing else
#   wrong answer     conspicuous under poison (`a5d03c…` read as a double, a
#                    string written over its own contents). A *plausible* wrong
#                    answer is more interesting, not less: it means something
#                    was freed and reallocated to a value that happened to fit
#
# Run it when the machine is quiet. It rebuilds each module from scratch, and
# the compiled lane is a serialised resource shared with two other sessions.
set -u
cd "$(dirname "$0")/../.."

modules="${*:-buffer os path punycode querystring string_decoder url}"
failures=0

for module in $modules; do
  printf '  %-16s ' "$module"
  build=$(NTS_CONFORMANCE_RC=1 timeout 1800 bash tooling/conformance/build.sh "$module" 2>&1)
  if ! printf '%s' "$build" | grep -q 'bytes$'; then
    # Distinguish the two ways a build fails, because they are different work.
    if printf '%s' "$build" | grep -qi 'does NOT verify\|NotDominated\|invalid HIR'; then
      echo "invalid HIR under counting -- compiler lane"
      printf '%s\n' "$build" | grep -iE 'does NOT verify|NotDominated|invalid HIR' | head -2 | sed 's/^/                   /'
    else
      echo "did not build"
      printf '%s\n' "$build" | grep -E 'error:' | head -2 | sed 's/^/                   /'
    fi
    failures=$((failures + 1))
    continue
  fi
  result=$(timeout 1800 node tooling/conformance/run.mjs \
    --module "$module" --addon "$PWD/target/node/$module.node" 2>&1 | tail -1)
  echo "$result"
  printf '%s' "$result" | grep -q ' 0 failed' || failures=$((failures + 1))
done

echo
echo "  $failures module(s) needing a person"
# Not an exit code anybody gates on yet: this lane has never been run before, so
# the first result is a baseline rather than a regression.
exit 0
