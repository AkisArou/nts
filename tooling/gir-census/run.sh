#!/bin/sh
# What GTK programs cannot call yet: the binder's refusals over libadwaita's
# closure (Gtk and everything beneath it), leaving out what no GJS program
# calls either -- entries GIR marks not introspectable, and deprecated ones.
# The second gauge of the GTK lane's completeness, beside the Workbench corpus
# (tooling/gjs-corpus).
#
#   sh tooling/gir-census/run.sh            counts, and the change since the baseline
#   sh tooling/gir-census/run.sh --update   and make this census the baseline
#
# baseline.tsv beside this script is the census itself, one `namespace
# <TAB> symbol <TAB> reason` line per refusal, so the change a fix makes is
# the list of entries it cleared, not only a count that moved.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
nts=${NTS_BIN:-"$root/target/release/nts"}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
"$nts" bind-gir Adw-1 --out "$out/bindings" > /dev/null
census="$out/census.tsv"
for file in "$out"/bindings/*.refused.txt; do
  namespace=$(basename "$file" .refused.txt)
  awk -F'\t' -v ns="$namespace" '
    $2 == "" || $2 == "GIR marks it not introspectable" || $3 == "deprecated" { next }
    { print ns "\t" $1 "\t" $2 }' "$file"
done | sort > "$census"

echo "by namespace:"
awk -F'\t' '{ n[$1]++ } END { for (k in n) printf "%6d  %s\n", n[k], k }' "$census" | sort -rn
echo
echo "by reason (a type that is its subject reads X; details after \": \" dropped):"
awk -F'\t' '{ r = $3; sub(/^`[^`]*`,/, "X,", r); sub(/: .*/, "", r); n[r]++ }
  END { for (k in n) printf "%6d  %s\n", n[k], k }' "$census" | sort -rn
printf '\n%d refusals GJS programs could call\n' "$(wc -l < "$census")"

baseline="$here/baseline.tsv"
if [ -f "$baseline" ]; then
  comm -23 "$baseline" "$census" > "$out/cleared"
  comm -13 "$baseline" "$census" > "$out/added"
  printf 'against the baseline: %d cleared, %d added\n' \
    "$(wc -l < "$out/cleared")" "$(wc -l < "$out/added")"
  sed 's/^/  - /' "$out/cleared"
  sed 's/^/  + /' "$out/added"
fi
if [ "${1:-}" = "--update" ]; then
  cp "$census" "$baseline"
  echo "baseline updated"
fi
