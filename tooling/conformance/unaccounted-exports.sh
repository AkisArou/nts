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
#
# # It subtracts sets, and it used to subtract counts
#
# The first version computed `declared - published - declined` as integers and
# clamped a negative result to zero. Those three do not count the same things: a
# `no wrapper` line can name a namespace member or a class field -- `Stats.atime` --
# which was never in `declared`, so the third term routinely exceeded the first.
# Measured on 2026-09-13: **18 of 26 modules produced a negative gap and therefore
# printed 0**, `fs` at -82 and `stream` at -73. A check cannot be failed by a module
# whose answer saturates, and this one could not be failed by two thirds of them.
#
# So all three are sets of names now, and the remainder is a set difference, which
# cannot go negative and can be printed. The numbers move: with the arithmetic form
# and matched provenance `cluster` read -2 and now reads its actual remainder.
#
# # Pass the same build the logs came from
#
# `published` reads `$NTS_ADDON_OUT` and defaults to `target/node`, which is a
# shared directory any session may have rebuilt from any commit. Reading it beside
# logs from a different build is how `cluster` reported 4 unaccounted in one run and
# -2 in the next, from the same logs. Pass `NTS_ADDON_OUT` pointing at the build the
# logs describe, or the two columns are about two programs.
set -u
logs="${1:?usage: unaccounted-exports.sh <emit-log-dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

printf '%-20s %6s %6s %6s %8s %s\n' module declared published declined unaccounted "re-export lines"
total=0
addons="${NTS_ADDON_OUT:-$root/target/node}"
for log in "$logs"/*.log; do
  module=$(basename "$log" .log)
  entry="runtime/node/$module/src/main.ts"
  [ -f "$entry" ] || continue
  # Three sets of names, so the remainder is a difference and not a subtraction.
  # `awk` rather than the shell's `grep`, which is ugrep here and has missed a real
  # match before; every count below is load-bearing.
  declared=$(awk 'match($0, /^export (async )?(function|class|const) [A-Za-z_$][A-Za-z0-9_$]*/) {
      n = split(substr($0, RSTART, RLENGTH), p, " "); print p[n] }' "$entry" | sort -u)
  reexports=$(awk '/^export (\*|\{)/ {n++} END {print n+0}' "$entry")
  # The addon's keys, **plus what `shape.mjs` assigns onto the module.** A name the
  # shape supplies is published, and reading only the addon called `querystring.encode`
  # unaccounted while leaving `decode` -- the line above it, the same construct -- alone.
  # A check that treats two spellings of one thing differently is reporting on itself.
  published=$({ node -e "try{console.log(Object.keys(require('$addons/$module.node')).join('\n'))}catch(e){}" 2>/dev/null
    shape="runtime/node/$module/shape.mjs"
    [ -f "$shape" ] && awk 'match($0, /^[ \t]*[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=/) {
        s = substr($0, RSTART, RLENGTH); sub(/^[ \t]*[^.]*\./, "", s); sub(/[ \t]*=$/, "", s); print s }' "$shape"
  } | sort -u)
  # A `no wrapper for X:` line may name `Stats.atime`; only the owner matters here,
  # because that is the name `declared` could ever have held.
  declined=$(awk 'match($0, /^no wrapper for [A-Za-z_$][A-Za-z0-9_$.]*/) {
      s = substr($0, RSTART + 15, RLENGTH - 15); sub(/\..*/, "", s); print s }' "$log" | sort -u)
  remainder=$(comm -23 <(printf '%s\n' "$declared" | sed '/^$/d') \
    <(printf '%s\n%s\n' "$published" "$declined" | sed '/^$/d' | sort -u))
  gap=$(printf '%s\n' "$remainder" | sed '/^$/d' | wc -l)
  total=$((total + gap))
  printf '%-20s %6s %6s %6s %8s %s\n' "$module" \
    "$(printf '%s\n' "$declared" | sed '/^$/d' | wc -l)" \
    "$(printf '%s\n' "$published" | sed '/^$/d' | wc -l)" \
    "$(printf '%s\n' "$declined" | sed '/^$/d' | wc -l)" \
    "$gap" "$reexports"
  [ "$gap" -gt 0 ] && printf '%s\n' "$remainder" | sed '/^$/d' | sed 's/^/                       /'
done

echo
echo "  $total export(s) declared, not published, and not declined by name."
echo "  A module that publishes nothing and declines nothing has told you nothing."
[ "$total" -eq 0 ]
