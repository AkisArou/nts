#!/usr/bin/env bash
# Node's own tests against the TypeScript, every module, one line each.
#
#   tooling/conformance/interpreted-lane.sh
#   tooling/conformance/interpreted-lane.sh os path
#
# The compiled axis is bounded by what the compiler publishes. This is the other
# half, and it is bounded by nothing: every failure here is this profile's own
# and fixable without waiting for anything.
#
# Measured 2026-09-09, all twenty-two modules:
#
#     2,323 files    1,859 passed    0 failed    29 skipped    435 not applicable
#
# **Not one module has a failing file.** Which makes the 435 the only number
# left to argue with, and `not-applicable` is where each of them says why.
#
# # `internal` is not a module, and this used to survey it
#
# The first version walked every directory under `runtime/node` that had a
# `test/` folder. `runtime/node/internal` has one -- holding a single C file --
# and is a shared source directory rather than a module. The runner matched
# node's `test-internal-*.js` against a module that does not exist and reported
# **29 files, 0 passed, 29 failed**, in a table whose every other row said
# `0 failed`.
#
# A module is a directory with its own `tsconfig.json`, which is the same test
# `loads.sh` uses and the same one that keeps `README.md` out of its output.
#
# Both paths controlled when this was written. `os punycode` reports
# `0 module(s) with a failing file` and exits 0; `punycode internal` -- naming
# the non-module explicitly, which bypasses the filter -- reports
# `1 module(s) with a failing file`. A counter that has only ever counted zero
# is a claim that nothing failed rather than a measurement of it.
set -u
cd "$(dirname "$0")/../.."

modules=("$@")
if [ ${#modules[@]} -eq 0 ]; then
  mapfile -t modules < <(
    for d in runtime/node/*/; do
      name="$(basename "$d")"
      [ "$name" = node_modules ] && continue
      [ -f "$d/tsconfig.json" ] && printf '%s\n' "$name"
    done | sort
  )
fi

printf '  %-22s %s\n' module 'files: passed / failed / skipped / n-a'
failing=0
for module in "${modules[@]}"; do
  line=$(timeout 1800 node tooling/conformance/run.mjs --module "$module" 2>&1 | tail -1)
  printf '  %-22s %s\n' "$module" "$line"
  case "$line" in
    *", 0 failed,"*) ;;
    *) failing=$((failing + 1)) ;;
  esac
done

printf '\n  %d module(s) with a failing file.\n' "$failing"
echo "  A failure here is this profile's own. Zero means the implementation"
echo "  passes everything it runs, and the not-applicable column is where the"
echo "  remaining judgement is written down."
[ "$failing" -eq 0 ]
