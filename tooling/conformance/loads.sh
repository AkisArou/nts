#!/usr/bin/env bash
# Does every built addon survive `require`?
#
#   tooling/conformance/loads.sh
#   tooling/conformance/loads.sh os path
#
# **Building is not loading, and nothing between the two was checking.** The
# build floor reports "22 of 22 still build" and the addon sweep runs node's
# tests, which do load -- but the sweep takes thirty-five minutes and the floor
# takes seconds, so a crash on load lived in the gap between them.
#
# It did happen. After the index-signature representation landed, `os.node`
# segfaulted inside `nts_map_set` during `module__init`: the four
# `Record<string, number>` fields of `OsConstants` were never given a table and
# the first write went through a null pointer. Every measurement taken that hour
# was static -- refusal counts from `emit-c`, and a grep for
# `napi_set_named_property` in the emitted wrapper -- and every one of them said
# `os` published 17 names, on a pin where requiring it killed the process.
#
# This is one `require()` per artifact. It answers the smallest question that
# cannot be answered by reading emitted text, and it costs a second.
#
# A crash is reported with its signal, because exit 139 and a failed assertion
# are different findings and only one of them is about the module's behaviour.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

# `node` may be a version-manager shim; resolve it so the signal is the child's.
node_bin="$(command -v node)"

modules=("$@")
if [ ${#modules[@]} -eq 0 ]; then
  # A module is a directory with its own tsconfig. Listing the parent instead
  # reports `README.md` and `tsconfig.json` as modules with no addon built,
  # which is three lines of noise in a check whose whole value is that its
  # output is short enough to read.
  mapfile -t modules < <(
    for d in "$root"/runtime/node/*/; do
      name="$(basename "$d")"
      [ "$name" = "node_modules" ] && continue
      [ -f "$d/tsconfig.json" ] && printf '%s\n' "$name"
    done | sort
  )
fi

ok=0; crashed=0; absent=0
for module in "${modules[@]}"; do
  addon="$root/target/node/$module.node"
  if [ ! -f "$addon" ]; then
    printf '  %-22s no addon built\n' "$module"
    absent=$((absent + 1))
    continue
  fi
  out="$("$node_bin" -e "const m=require('$addon');
    const names=Object.keys(m).filter((k)=>m[k]!==undefined).length;
    console.log('loads, ' + names + ' name(s) published')" 2>&1)"
  status=$?
  if [ $status -eq 0 ]; then
    printf '  %-22s %s\n' "$module" "$out"
    ok=$((ok + 1))
  else
    # 128+n is a signal; 139 is SIGSEGV, which is the one this exists for.
    if [ $status -gt 128 ]; then
      reason="CRASHED on require, signal $((status - 128))"
    else
      reason="failed to load (exit $status): $(printf '%s' "$out" | head -1 | cut -c1-70)"
    fi
    printf '  %-22s %s\n' "$module" "$reason"
    crashed=$((crashed + 1))
  fi
done

printf '\n%d load, %d crashed or failed, %d not built\n' "$ok" "$crashed" "$absent"
[ "$crashed" -eq 0 ]
