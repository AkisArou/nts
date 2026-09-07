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
  # Probe that the switch did what it claims, because this lane cannot report
  # anything trustworthy otherwise. The first run of it passed `punycode` 2/2
  # and the build directory held *zero* retain/release sites -- a green row from
  # an uncounted build, which is precisely the false negative the lane exists to
  # prevent. `--rc` on punycode emits 55 sites, so 0 is never legitimate here.
  program="$PWD/target/node/$module.build/program.c"
  sites=$(grep -cE 'nts_retain|nts_release' "$program" 2>/dev/null || echo 0)
  if [ "$sites" -eq 0 ]; then
    echo "NOT COUNTED -- built clean but emitted no retain/release; result would be meaningless"
    failures=$((failures + 1))
    continue
  fi

  result=$(timeout 1800 node tooling/conformance/run.mjs \
    --module "$module" --addon "$PWD/target/node/$module.node" 2>&1 | tail -1)

  # And again afterwards. Three sessions share this tree and `target/node` is
  # not owned by any of them, so another lane rebuilding the same module during
  # the test run silently substitutes the artifact under test. That is how the
  # first punycode row came to disagree with its own build directory: the
  # directory was rewritten fifteen seconds after this lane wrote it.
  after=$(grep -cE 'nts_retain|nts_release' "$program" 2>/dev/null || echo 0)
  if [ "$after" -ne "$sites" ]; then
    echo "OVERWRITTEN mid-run ($sites -> $after sites) -- another session rebuilt it; rerun when quiet"
    failures=$((failures + 1))
    continue
  fi

  echo "$result  [$sites rc sites]"
  if ! printf '%s' "$result" | grep -q ' 0 failed'; then
    failures=$((failures + 1))
    continue
  fi

  # A module that passes under counting has earned a harder question. Its test
  # file count is the number of questions node thought to ask, and for the one
  # module that passes here that is two -- which cannot see a release too many.
  # A wrong answer from a reallocated slot is most likely to be a *plausible*
  # one, so the thing to do is ask node the same questions and compare, with
  # poison making a freed read conspicuous rather than zero.
  if grep -q "^  $module:" tooling/conformance/differential-corpora.mjs 2>/dev/null ||
     grep -q "\b$module:" tooling/conformance/differential-corpora.mjs 2>/dev/null; then
    diff_out=$(timeout 1800 node tooling/conformance/differential-addon.mjs \
      "$module" "$PWD/target/node/$module.node" --iterations 20000 2>&1 | tail -1)
    printf '  %-16s %s\n' "" "$diff_out"
    printf '%s' "$diff_out" | grep -q ' 0 divergence' || failures=$((failures + 1))
  fi
done

echo
echo "  $failures module(s) needing a person"
# Not an exit code anybody gates on yet: this lane has never been run before, so
# the first result is a baseline rather than a regression.
exit 0
