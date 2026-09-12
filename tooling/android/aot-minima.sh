#!/bin/sh
# The minimum of N sittings per side, for rows the single-sitting band cannot
# place.
#
#     sh tooling/android/aot-minima.sh awfy-nbody awfy-sieve awfy-permute
#     NTS_AOT_RUNS=7 sh tooling/android/aot-minima.sh awfy-permute
#
# # Why a minimum and why a separate driver
#
# `benches/jvm-rows.md` measured every AWFY row twice in both modes and found
# the AOT column reproducing within 0.03 and the JIT column within 0.10. Three
# rows then sat at **1.00-1.01 in AOT** -- inside a reproducibility of 0.03 --
# so the file's policy is that a verdict there reports rounding rather than the
# program, and that *a row leaves the band by the instrument improving rather
# than by being counted*. This is that improvement.
#
# A minimum rather than a mean, which is this repository's rule and not a
# preference: noise on a timed run is one-sided. Nothing makes a program run
# faster than it can, so every perturbation adds, and the smallest observation
# is the one with the least of it in. A mean of five sittings on a shared box
# is a mean of five different amounts of interference.
#
# **Both sides' minima, taken independently.** They are measured in one process
# per side per sitting, so pairing them run-by-run would pair two unrelated
# amounts of interference; what is wanted is the best each side achieved.
#
# # The band, and the first version of it that was wrong
#
# A ratio needs an error bar or the minimum is just a smaller number with the
# same authority. The first version here computed the widest arithmetic
# possible -- the largest `ours` over the smallest `ref`, minus the smallest
# `ours` over the largest `ref` -- drawing the two from **different sittings**.
#
# That is not a scenario that happens. Each sitting measures both sides in one
# pass, so a sitting's ratio is a real observation and the cross-pairing is an
# arithmetic bound rather than a measurement.
#
# **What it is not is "the old number was too big", and saying so would have
# been the same mistake one level up.** The corrected metric read 0.007 on
# `awfy-nbody` where the cross-pairing read 0.050, and 0.056 on `awfy-permute`
# where it read 0.032 -- but those came from *different sittings*, because the
# metric and the sample were changed in one step. A per-sitting spread is
# always inside the cross-paired bound on the same data; across different data
# it can be anything, and the pair above is not evidence of the direction. Two
# variables moved, so neither number is a control for the other.
#
# So the band below is the spread of the **per-sitting ratios**, and the
# sittings are printed so a reader can see the shape rather than a summary of
# it.
#
# Separate from `aot-on-device.sh` rather than a flag on it because that script
# builds and installs two APKs per invocation and a person running it by hand
# wants one answer, not five sittings of one.
#
# # The parse this exists to get right
#
# `aot-on-device.sh` prints both an absolute line and a ratio line beginning
# `JIT `:
#
#     JIT             8995.6209     10290.7651
#     JIT ratio  0.87x
#
# Every ad-hoc `awk '/^JIT /'` in this lane's history has matched both and kept
# the *later* one, so a batch that looked like it was collecting times collected
# the strings `ratio` and `0.87x`. Anchoring on a digit is the whole fix and it
# is here rather than retyped per run.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
runs=${NTS_AOT_RUNS:-5}
[ $# -gt 0 ] || { echo "usage: aot-minima.sh <case>..." >&2; exit 2; }

printf "%-18s %-28s %-28s %s\n" "case" "JIT  ours / ref / ratio" "AOT  ours / ref / ratio" "band  [per-sitting AOT ratios]"
for case in "$@"; do
  jo="" ; jr="" ; ao="" ; ar=""
  for _ in $(seq 1 "$runs"); do
    out=$(NTS_D8_RELEASE=1 sh "$root/tooling/android/aot-on-device.sh" "$case" 2>/dev/null) || continue
    # Anchored on a digit: see above.
    set -- $(printf '%s\n' "$out" | awk '/^JIT +[0-9]/{ j=$2; k=$3 } /^AOT +[0-9]/{ a=$2; b=$3 } END{ print j+0, k+0, a+0, b+0 }')
    [ "${1:-0}" = "0" ] && continue
    jo="$jo $1"; jr="$jr $2"; ao="$ao $3"; ar="$ar $4"
  done
  [ -n "$jo" ] || { printf "%-18s %s\n" "$case" "no sitting produced a number"; continue; }
  printf "%-18s" "$case"
  echo "$jo|$jr|$ao|$ar" | awk -F'|' '
    function least(s,   n, i, a, m) { n = split(s, a, " "); m = a[1]; for (i = 2; i <= n; i++) if (a[i] < m) m = a[i]; return m }
    {
      n = split($3, ao, " "); split($4, ar, " ")
      # Per-sitting ratios: each is one observation of both sides together.
      lo = 1e18; hi = 0; shape = ""
      for (i = 1; i <= n; i++) {
        if (ar[i] <= 0) continue
        r = ao[i] / ar[i]
        if (r < lo) lo = r
        if (r > hi) hi = r
        shape = shape sprintf(" %.3f", r)
      }
      jo = least($1); jr = least($2); amin = least($3); rmin = least($4)
      printf " %9.1f /%9.1f / %.3fx  %9.1f /%9.1f / %.3fx   %.3f  [%s ]\n",
        jo, jr, (jr > 0 ? jo / jr : 0), amin, rmin, (rmin > 0 ? amin / rmin : 0),
        (hi > 0 ? hi - lo : 0), shape
    }'
done
