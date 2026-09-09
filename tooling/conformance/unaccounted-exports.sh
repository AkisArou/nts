#!/usr/bin/env bash
# Exports a module declares, minus what it publishes, minus what the wrapper
# declined by name. The remainder is the surface nobody was told about.
#
#   tooling/conformance/unaccounted-exports.sh <emit-log-dir>
#
# where the directory holds one `<module>.log` per module, each the stderr of
# `emit-c --napi` for that module against one compiler.
#
# `fs` is why this exists. It declares 44 exports in `src/main.ts`, publishes
# zero, and its emitted `addon.c` carries no `napi_set_named_property` at all --
# and the compiler prints no `no wrapper for X` line for any of them. Six
# NTS2009 at the backend and 211 own roots, and nothing that says why
# `readFileSync` is absent. Every other module accounts for its missing surface
# by name: `zlib` declines 53, `stream` 28, `http` 25.
#
# **Validated on the modules where the arithmetic is exact.** punycode 6-6-0,
# os 23-17-6, querystring 8-0-8, diagnostics_channel 7-0-7, dgram 2-0-2 all
# reach zero. A check that has never returned zero for a healthy module is not
# a check.
#
# Two limits, both in the direction of under-reporting. The declared count reads
# `export function|class|const` from `src/main.ts` only, so a module whose
# surface arrives through `export *` or `export { ... } from` has more exports
# than this counts -- the re-export column says how many such lines it has, and
# `fs` has eleven, which makes its 44 a floor rather than a total. And a name
# published under an alias is counted as unaccounted.
set -u
logs="${1:?usage: unaccounted-exports.sh <emit-log-dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

printf '%-20s %6s %6s %6s %8s %s\n' module declared published declined unaccounted "re-export lines"
total=0
for log in "$logs"/*.log; do
  module=$(basename "$log" .log)
  entry="runtime/node/$module/src/main.ts"
  [ -f "$entry" ] || continue
  declared=$(grep -hoE '^export (async )?(function|class|const) [A-Za-z_$][A-Za-z0-9_$]*' "$entry" |
    awk '{print $NF}' | sort -u | wc -l)
  reexports=$(grep -cE '^export (\*|\{)' "$entry")
  published=$(node -e "try{console.log(Object.keys(require('${NTS_ADDON_OUT:-$root/target/node}/$module.node')).length)}catch(e){console.log(0)}" 2>/dev/null | tail -1)
  declined=$(grep -cE 'no wrapper' "$log")
  gap=$((declared - published - declined))
  [ "$gap" -lt 0 ] && gap=0
  total=$((total + gap))
  printf '%-20s %6s %6s %6s %8s %s\n' "$module" "$declared" "$published" "$declined" "$gap" "$reexports"
done

echo
echo "  $total export(s) declared, not published, and not declined by name."
echo "  A module that publishes nothing and declines nothing has told you nothing."
[ "$total" -eq 0 ]
