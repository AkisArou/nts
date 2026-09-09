#!/usr/bin/env bash
# Every building module, counted and uncounted, side by side.
#
#   NTS_COMPILER=<a pinned copy> tooling/conformance/counted-vs-uncounted.sh
#   NTS_COMPILER=<a pinned copy> tooling/conformance/counted-vs-uncounted.sh buffer os
#
# `counted-lane.sh` runs the counted side and reports "pass" meaning *the module
# built and its tests ran*. That is not the question the lane exists to answer.
# The question is whether a module behaves the **same** counted and uncounted,
# and the comparison that decides it is not in that script -- so its rows read
# `0 passed` and look like a defect in reference counting when they are the
# export table's doing and identical on both sides.
#
# Measured 2026-09-09: four modules ran with ~1500 retain/release sites against
# 5, and every failure count matched. Without the right-hand column those four
# rows said `0 passed, 12 failed` and nothing else.
#
# The comparison itself was controlled by inverting it: with `!=` changed to
# `=`, `punycode` flags and the run reports `1 module(s) differ`; restored, it
# reports `0`. A comparison that has never been seen to fire is a claim about
# agreement rather than a measurement of it.
#
# So this builds each module twice and prints both. A row differing between the
# columns is the finding; a row identical on both is the allocator seeing
# nothing these tests can reach.
set -u
cd "$(dirname "$0")/../.."
compiler=${NTS_COMPILER:-${NTS_BIN:-$PWD/target/release/nts}}

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

printf '  %-20s %-34s %s\n' module counted uncounted
differing=0
for module in $modules; do
  # Counted first, then uncounted, so the artifact left behind is the ordinary
  # one -- another lane reading `target/node` after this finds what it expects.
  counted=""
  if NTS_CONFORMANCE_RC=1 NTS_COMPILER="$compiler" \
      timeout 1800 bash tooling/conformance/build.sh "$module" 2>&1 |
      grep -q 'bytes$'; then
    sites=$(grep -cE 'nts_retain|nts_release' \
      "target/node/$module.build/program.c" 2>/dev/null)
    sites=${sites:-0}
    if [ "$sites" -eq 0 ]; then
      counted="NOT COUNTED (0 rc sites)"
    else
      counted=$(timeout 1800 node tooling/conformance/run.mjs \
        --module "$module" --addon "$PWD/target/node/$module.node" 2>&1 |
        tail -1 | sed 's/ file(s)://; s/, 0 skipped//; s/, [0-9]* not applicable//')
      counted="$counted [$sites rc]"
    fi
  else
    counted="did not build"
  fi

  uncounted=""
  if NTS_COMPILER="$compiler" timeout 1800 bash tooling/conformance/build.sh \
      "$module" 2>&1 | grep -q 'bytes$'; then
    uncounted=$(timeout 1800 node tooling/conformance/run.mjs \
      --module "$module" --addon "$PWD/target/node/$module.node" 2>&1 |
      tail -1 | sed 's/ file(s)://; s/, 0 skipped//; s/, [0-9]* not applicable//')
  else
    uncounted="did not build"
  fi

  mark=" "
  # Compare the answers, not the rc-site note, which is expected to differ.
  if [ "${counted%% \[*}" != "$uncounted" ]; then
    mark="*"
    differing=$((differing + 1))
  fi
  printf '%s %-20s %-34s %s\n' "$mark" "$module" "$counted" "$uncounted"
done

echo
echo "  $differing module(s) differ between the columns"
echo "  A differing row is the finding. An identical pair is the allocator"
echo "  seeing nothing these tests can reach -- which is a result, not a blank."
