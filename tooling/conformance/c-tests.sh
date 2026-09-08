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

# Built once, ahead of the loop.
mkdir -p "$work/internal"
for source in runtime/node/internal/*.c; do
  [ -e "$source" ] || continue
  if ! clang -std=c11 -D_GNU_SOURCE -fPIC -c "$source" \
      -I "$root/runtime/c" -I "$root/runtime/node/internal" \
      -I "$root/third_party/node/deps/uv/include" -I "$root/third_party/node/src" \
      -o "$work/internal/$(basename "$source" .c).o" > "$work/internal.log" 2>&1; then
    echo "  the shared runtime/node/internal C does not compile:"
    grep -E 'error:' "$work/internal.log" | head -3 | sed 's/^/    /'
    exit 2
  fi
done
ar rcs "$work/libnodeinternal.a" "$work"/internal/*.o

# The drift guard for the duplicated library list. A copied list that nobody
# checks is the thing that made `build.sh` name a `node_all.c` deleted three
# months earlier, invisible because nothing reached the link step. This makes
# the copy loud instead.
for module in zlib; do
  case "$module" in
    zlib) mine="-lz -lbrotlienc -lbrotlidec -lzstd" ;;
  esac
  # Absent and different are not the same finding, and a guard that reports one
  # as the other sends the next person to look for a change nobody made. This
  # said "build.sh no longer links zlib with ..." when the real answer was that
  # it could not find build.sh at all.
  if [ ! -r tooling/conformance/build.sh ]; then
    echo "  CANNOT CHECK: tooling/conformance/build.sh is not readable from $PWD."
    echo "  The library list below is a copy of one that lives there, and with"
    echo "  the original out of reach there is no way to tell whether it is"
    echo "  still right. Not proceeding on an unverifiable copy."
    exit 2
  fi
  if ! grep -qF -- "$mine" tooling/conformance/build.sh; then
    echo "  DRIFT: build.sh no longer links $module with:"
    echo "    $mine"
    echo "  These two lists have to agree or this script tests a different"
    echo "  binary from the one the module ships. Fix both, then rerun."
    exit 2
  fi
done

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

  # Plus the C every module shares -- `nts_node_to_utf8_alloc`,
  # `nts_node_set_errno` and `nts_node_desc_double` all live there, so `fs.c`
  # cannot link without it. A module's own directory is not the whole of its C.
  #
  # As an *archive* rather than a list of objects, which is the difference
  # between this working and not. `internal/process.c` calls `napi_get_global`
  # and half a dozen other Node-API functions that exist only inside a real
  # addon; naming every object on the command line drags that one in whether or
  # not anything wants it, and every test here fails to link over symbols it
  # never mentions. A linker pulls an archive member only when something still
  # undefined is in it, so `process.o` stays out until a test actually needs
  # it -- at which point failing to link is the correct answer rather than a
  # harness artefact.
  shared_lib=""
  if [ "$module" != "internal" ]; then
    shared_lib="$work/libnodeinternal.a"
  fi

  # The same libraries `build.sh` links that module against. Duplicated rather
  # than factored out, because `build.sh` is running in other sessions right now
  # and editing a script while it executes is its own bug -- but duplicated
  # *checkably*: the drift guard below fails the run if the two lists stop
  # agreeing, so this cannot quietly go stale the way a copied list normally
  # does.
  module_libraries=""
  case "$module" in
    zlib) module_libraries="-lz -lbrotlienc -lbrotlidec -lzstd" ;;
  esac

  if ! clang -std=c11 -D_GNU_SOURCE -Wall -Wextra \
      -I "$root/runtime/c" -I "$module_dir" -I "$root/runtime/node/internal" \
      -I "$root/third_party/node/deps/uv/include" -I "$root/third_party/node/src" \
      $test_c $module_c "$root/runtime/c/nts_runtime.c" $shared_lib \
      $module_libraries -luv -lm -o "$work/$module-$name" > "$work/build.log" 2>&1; then
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
  elif [ "$code" -gt 128 ]; then
    # A signal, not a verdict. A test killed by SIGABRT or SIGSEGV prints no
    # `FAIL` line, so reporting it the same way as a failed check shows an
    # empty explanation under the word "failed" -- which reads as a broken
    # harness rather than as the crash it is. Sizing a buffer wrong in
    # `nts_zlib_bytes` lands here, aborting in the allocator with the checks
    # that had already passed still on screen.
    echo "CRASHED -- signal $((code - 128))"
    printf '%s\n' "$out" | tail -3 | sed 's/^/                                  /'
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
