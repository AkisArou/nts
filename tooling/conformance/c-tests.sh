#!/usr/bin/env bash
# Every `runtime/node/*/test/*.c`, built and run.
#
#   tooling/conformance/c-tests.sh
#
# There were none of these until 2026-09-08, and the reason is worth stating
# because it is not laziness: a module's C is normally exercised *through* the
# module, and fifteen of twenty-two modules do not compile. So `fs.c`'s byte-path
# family, `zlib.c`'s seven changed signatures and `timers.c`'s handle policy are
# verified by nothing at all -- and each of them is the kind of code where the
# failure mode is a hang or a leak rather than a wrong answer, which the
# interpreted lane could not see even if it ran them.
#
# These are not a substitute for the module tests. They are the only thing that
# can run *before* the compiler is ready, which is where this lane spends most
# of its time.
#
# A test file lives at `runtime/node/<module>/test/<name>.c` and is linked
# against that module's own C plus `runtime/c/nts_runtime.c`. It provides its own
# `nts_closure_call_slot`, which the program would normally emit.
set -u
cd "$(dirname "$0")/../.."
root=$PWD
work=${TMPDIR:-/tmp}/nts-c-tests.$$
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

failures=0
found=0

for test_c in runtime/node/*/test/*.c; do
  [ -e "$test_c" ] || continue
  found=$((found + 1))
  module_dir=$(dirname "$(dirname "$test_c")")
  module=$(basename "$module_dir")
  name=$(basename "$test_c" .c)
  printf '  %-14s %-16s ' "$module" "$name"

  # The module's own C, and nothing from another module: a test that needed a
  # second module's bindings would be testing the wrong seam.
  module_c=$(find "$module_dir" -maxdepth 1 -name '*.c' | tr '\n' ' ')

  if ! clang -std=c11 -D_GNU_SOURCE -Wall -Wextra \
      -I "$root/runtime/c" -I "$module_dir" -I "$root/runtime/node/internal" \
      -I "$root/third_party/node/deps/uv/include" -I "$root/third_party/node/src" \
      $test_c $module_c "$root/runtime/c/nts_runtime.c" \
      -luv -lm -o "$work/$module-$name" > "$work/build.log" 2>&1; then
    echo "did not build"
    grep -E 'error:' "$work/build.log" | head -3 | sed 's/^/                                  /'
    failures=$((failures + 1))
    continue
  fi

  # A timeout, not because these are slow but because the defects they guard
  # against are *blocks*. `timers.c`'s pump exists to stop the loop sleeping
  # forever, and a test that reproduced that bug would hang rather than fail.
  # Without a timeout the suite would report nothing and get blamed on the
  # machine.
  out=$(timeout 60 "$work/$module-$name" 2>&1)
  code=$?
  if [ "$code" -eq 124 ]; then
    echo "HUNG -- 60s timeout"
    failures=$((failures + 1))
  elif [ "$code" -ne 0 ]; then
    echo "failed"
    printf '%s\n' "$out" | grep -E '^(FAIL|  )' | head -6 | sed 's/^/                                  /'
    failures=$((failures + 1))
  else
    echo "$(printf '%s' "$out" | grep -c '^ok') check(s) pass"
  fi
done

echo
if [ "$found" -eq 0 ]; then
  # The same instrument-failure discipline the rest of this directory keeps: a
  # sweep that found nothing to run must not read as a clean sweep.
  echo "  INSTRUMENT FAILURE: no runtime/node/*/test/*.c found at all."
  echo "  This script reports success when every test passes, and an empty run"
  echo "  is not that. Check the glob before believing a green line."
  exit 2
fi
echo "  $found file(s), $failures needing a person"
[ "$failures" -eq 0 ]
