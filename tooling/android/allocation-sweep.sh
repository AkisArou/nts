#!/bin/sh
# `bytes/op` for ours and for the hand-written reference, on both runtimes.
#
#     sh tooling/android/allocation-sweep.sh out.tsv           # every case with a ref.java
#     sh tooling/android/allocation-sweep.sh out.tsv bigint    # named cases
#
# # Why this exists beside the two scripts it calls
#
# `bytes-on-device.sh` answers "ours on HotSpot against ours on ART", which is
# the bar's third number. `ref-bytes-on-device.sh` answers "the reference, on
# both". Neither answers the question the bar actually needs, which is what a
# rise on ART *means*: 12 of 51 rows allocate materially more on ART than on
# HotSpot, and on nine of them the reference rises the same way. Those nine are
# ART having no C2 and everyone paying; the other three are ours. A row cannot
# be sorted into those two piles from either script alone.
#
# # Why per case, in its own process, with a timeout
#
# A survey that dies on one row is a survey. Each case is a separate invocation
# with `timeout`, so a row that hangs is a reported row -- and the output is
# appended as it goes and skipped on the next run, because a long run on this
# box does not reliably finish and restarting from zero costs the emulator
# twenty minutes.
#
# # Read the columns knowing what they cannot say
#
# The two runtimes use different counters by necessity -- `ThreadMXBean` does
# not exist on Android -- so a small difference between the HotSpot and ART
# columns is the instrument. `bytes-on-device.sh` states the rule as a hundred
# bytes an operation, which on a row allocating 8MB calls 0.7% a finding; the
# useful test is more than 100 bytes **and** more than 5%.
#
# The comparison *within* a runtime -- ours against the reference on ART -- is
# one counter and needs no tolerance.
set -u

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
out=${1:?usage: allocation-sweep.sh <out.tsv> [case...]}
shift
per=${NTS_SWEEP_TIMEOUT:-420}

cases=${*:-$(find "$root/benches/cases" -name ref.java \
  | sed "s|$root/benches/cases/||;s|/ref.java||" | sort)}

[ -f "$out" ] || printf "case\tours_hotspot\tours_art\tref_hotspot\tref_art\n" > "$out"

for case in $cases; do
  # Already answered on an earlier run. `awk` rather than `grep` for a test
  # something is skipped on: the interactive `grep` here is ugrep and has been
  # measured missing a real line.
  if awk -F'\t' -v c="$case" 'NR>1 && $1==c {found=1} END {exit !found}' "$out"; then
    continue
  fi
  # `bytes-on-device.sh` prints: case HotSpot ART objects avg
  ours=$(timeout "$per" sh "$root/tooling/android/bytes-on-device.sh" "$case" 2>/dev/null \
         | awk -v c="$case" '$1==c {print $2"\t"$3; f=1} END {if (!f) print "timeout\ttimeout"}')
  # `ref-bytes-on-device.sh` prints: case HotSpot ART
  ref=$(timeout "$per" sh "$root/tooling/android/ref-bytes-on-device.sh" "$case" 2>/dev/null \
        | awk -v c="$case" '$1==c {print $2"\t"$3; f=1} END {if (!f) print "timeout\ttimeout"}')
  printf "%s\t%s\t%s\n" "$case" "$ours" "$ref" >> "$out"
  printf "%-24s ours %10s / %-10s ref %10s / %s\n" "$case" \
    "$(printf '%s' "$ours" | cut -f1)" "$(printf '%s' "$ours" | cut -f2)" \
    "$(printf '%s' "$ref" | cut -f1)" "$(printf '%s' "$ref" | cut -f2)"
done

echo
echo "== does anything allocate materially more on ART than on HotSpot? =="
awk -F'\t' 'NR>1 && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
  n++
  if ($3 > $2 && $3 - $2 > 100 && ($2 == 0 || $3 > $2 * 1.05)) {
    worse++
    # The reference on the same two runtimes is what sorts this row into
    # "ART has no C2 and everyone pays" or "this backend".
    theirs = ($4 ~ /^[0-9]+$/ && $5 ~ /^[0-9]+$/ && $5 > $4 && $5 - $4 > 100) \
      ? "the reference rises too" : "the reference does not"
    printf "  %-24s %10s -> %-10s %s\n", $1, $2, $3, theirs
  }
} END { printf "  %d of %d measured row(s)\n", worse+0, n }' "$out"

echo
echo "== ours against the reference on ART, worst first =="
awk -F'\t' 'NR>1 && $3 ~ /^[0-9]+$/ && $5 ~ /^[0-9]+$/ && $5 > 0 && !($3==0 && $5==0) {
  printf "%10.3f\t%s\t%s\t%s\n", $3/$5, $1, $3, $5 }' "$out" \
  | sort -rn | awk -F'\t' '{ printf "  %.2fx  %-24s ours %10s  ref %10s\n", $1, $2, $3, $4 }'

echo
echo "== not measured, counted rather than dropped =="
awk -F'\t' 'NR>1 && ($2 !~ /^[0-9]+$/ || $3 !~ /^[0-9]+$/ || $5 !~ /^[0-9]+$/) {
  printf "  %-24s ours %s/%s  ref %s/%s\n", $1, $2, $3, $4, $5; n++
} END { printf "  %d row(s)\n", n+0 }' "$out"
