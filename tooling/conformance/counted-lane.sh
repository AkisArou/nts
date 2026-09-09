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

# `target/node` is shared with the other sessions in this tree. `NTS_ADDON_OUT`
# is the variable `build.sh`, `loads.sh` and `axis-controls.mjs` take; the
# default is unchanged, so every existing caller behaves as before.
addon_dir="${NTS_ADDON_OUT:-$PWD/target/node}"
cd "$(dirname "$0")/../.."

# Every module, not a remembered list of the seven that built once.
#
# This read `buffer os path punycode querystring string_decoder url`, which was
# the set that compiled on the night the lane was written. The goal it serves
# says "every module that builds", and a hardcoded list cannot answer that: the
# day an eighth module starts compiling, the lane keeps reporting seven and
# nothing says a row is missing. That is the quiet kind of wrong -- a green sheet
# that is silently incomplete -- and it is the kind this lane exists to catch in
# the allocator.
#
# So the default is every directory under `runtime/node`, and the modules that do
# not compile report `did not build` rather than being absent. A longer output is
# the price of the set being derived rather than recalled.
if [ "$#" -gt 0 ]; then
  modules="$*"
else
  modules=$(for d in runtime/node/*/; do
    name=$(basename "$d")
    [ -d "$d/src" ] || continue
    case "$name" in node_modules|internal) continue ;; esac
    printf '%s ' "$name"
  done)
fi
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
  program="$addon_dir/$module.build/program.c"
  # `grep -c` prints `0` *and exits 1* when it matches nothing. Written
  # `$(grep -c ... || echo 0)` that appends a second zero, so `sites` became the
  # two-line string "0\n0", `[ "$sites" -eq 0 ]` failed with "integer expected",
  # and the `if` took the else branch -- proceeding exactly as if the build had
  # been counted.
  #
  # So this guard could never fire, and the case it could never fire on is the
  # only one it exists for. The comment below describes a real incident: a green
  # `punycode` row from a build with zero retain/release sites. The guard written
  # in response has been dead since it was written, and it took the *control*
  # run -- where every module legitimately has zero -- to show it, because that
  # is the only situation in which the broken branch is ever reached.
  sites=$(grep -cE 'nts_retain|nts_release' "$program" 2>/dev/null)
  # A missing file makes `grep` print nothing at all, which is a third value this
  # has to survive rather than a fourth way to fall through.
  sites=${sites:-0}
  if [ "$sites" -eq 0 ]; then
    echo "NOT COUNTED -- built clean but emitted no retain/release; result would be meaningless"
    failures=$((failures + 1))
    continue
  fi

  result=$(timeout 1800 node tooling/conformance/run.mjs \
    --module "$module" --addon "$addon_dir/$module.node" 2>&1 | tail -1)

  # And again afterwards. Three sessions share this tree and `target/node` is
  # not owned by any of them, so another lane rebuilding the same module during
  # the test run silently substitutes the artifact under test. That is how the
  # first punycode row came to disagree with its own build directory: the
  # directory was rewritten fifteen seconds after this lane wrote it.
  after=$(grep -cE 'nts_retain|nts_release' "$program" 2>/dev/null)
  after=${after:-0}
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
      "$module" "$addon_dir/$module.node" --iterations 20000 2>&1 | tail -1)
    printf '  %-16s %s\n' "" "$diff_out"
    printf '%s' "$diff_out" | grep -q ' 0 divergence' || failures=$((failures + 1))
  fi
done

echo
echo "  $failures module(s) needing a person"
# Not an exit code anybody gates on yet: this lane has never been run before, so
# the first result is a baseline rather than a regression.
exit 0
