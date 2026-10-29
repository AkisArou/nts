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
trap 'status=$?; if [ "$status" -eq 0 ]; then rm -rf "$work"; else echo "native failure artifacts retained: $work" >&2; fi' EXIT

failures=0
unavailable=0
found=0
case_results="$work/native-cases.tsv"
: > "$case_results"
finish_native_results() {
  node "$root/tooling/conformance/native-case-result.ts" "$case_results" "$work/native-result.json" > "$work/native-result.log" 2>&1
  result=$?
  if [ "$result" -ne 0 ]; then cat "$work/native-result.log"; fi
  return "$result"
}

compiler="${NTS_COMPILER:-${NTS_BIN:-$root/target/release/nts}}"
node "$root/tooling/conformance/node-deps.ts" "$compiler" "$work/node-deps.json" || exit 2
mapfile -d '' -t bundled_includes < "$work/node-deps.json.include_flags"
mapfile -d '' -t bundled_libraries < "$work/node-deps.json.link_flags"

# Built once, ahead of the loop.
mkdir -p "$work/internal"
for source in runtime/node/internal/*.c; do
  [ -e "$source" ] || continue
  if ! clang -std=c11 -D_GNU_SOURCE -fPIC -c "$source" \
      -I "$root/runtime/c" -I "$root/runtime/node/internal" \
      "${bundled_includes[@]}" \
      -o "$work/internal/$(basename "$source" .c).o" > "$work/internal.log" 2>&1; then
    echo "  the shared runtime/node/internal C does not compile:"
    grep -E 'error:' "$work/internal.log" | head -3 | sed 's/^/    /'
    printf 'compile\tshared-internal\t1\n' >> "$case_results"
    finish_native_results
    exit $?
  fi
done
ar rcs "$work/libnodeinternal.a" "$work"/internal/*.o

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
  shared_lib="$work/libnodeinternal.a"
  # `internal` is a module directory too, and its own C is already in that
  # archive. Naming the objects as well would be a duplicate-symbol pile -- and
  # naming them *instead* would drag in `process.c` and its Node-API calls, which
  # is the very thing the archive exists to avoid. So it links only the archive
  # and lets the linker decide which members it needs.
  [ "$module" = "internal" ] && module_c=""

  # Test-only linker instrumentation is declared by the fixture that needs it.
  link_flags=()
  directive=$(sed -n 's@^// nts-test-link: @@p' "$test_c")
  if [ -n "$directive" ]; then read -r -a link_flags <<< "$directive"; fi
  build_log="$work/$module-$name.build.log"
  if ! clang -std=c11 -D_GNU_SOURCE -Wall -Wextra \
      -I "$root/runtime/c" -I "$module_dir" -I "$root/runtime/node/internal" \
      "${bundled_includes[@]}" \
      $test_c $module_c "$root/runtime/c/nts_runtime.c" $shared_lib \
      "${bundled_libraries[@]}" "${link_flags[@]}" -lm -o "$work/$module-$name" > "$build_log" 2>&1; then
    echo "did not build"
    grep -E 'error:' "$build_log" | head -3 | sed 's/^/                                  /'
    failures=$((failures + 1))
    printf 'compile\t%s/%s\t1\n' "$module" "$name" >> "$case_results"
    continue
  fi

  if ! node "$root/tooling/gate/node-deps-elf.ts" "$work/$module-$name" > "$work/$module-$name.elf.log" 2>&1; then
    echo "system dependency in native artifact"
    cat "$work/$module-$name.elf.log"
    failures=$((failures + 1))
    printf 'elf\t%s/%s\t1\n' "$module" "$name" >> "$case_results"
    continue
  fi

  # A timeout, not because these are slow but because the defects they guard
  # against are *blocks*. `timers.c`'s pump exists to stop the loop sleeping
  # forever, and a test that reproduced that bug would hang rather than fail.
  # Without a timeout the suite would report nothing and get blamed on the
  # machine.
  out=$(timeout 60 "$work/$module-$name" 2>&1)
  code=$?
  printf 'run\t%s/%s\t%s\n' "$module" "$name" "$code" >> "$case_results"
  printf '%s\n' "$out" > "$work/$module-$name.stdout"
  printf '%s\n' "$code" > "$work/$module-$name.status"
  if [ "$code" -eq 124 ]; then
    echo "NOT MEASURED -- wall guard ended observation"
    unavailable=$((unavailable + 1))
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
  finish_native_results
  exit $?
fi
echo "  $found file(s), $failures failures, $unavailable unavailable"
finish_native_results
