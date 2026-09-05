#!/bin/sh
# Claim the next free record number, atomically, and print the path.
#
#   tooling/gate/claim-record.sh "a title in the house style"
#
# The rule is claim-on-creation: create the file with its title line first, then
# fill it in. Three sessions share this checkout, and the rule fails in exactly
# one way -- two people compute "the next number" from the same listing before
# either writes. That happened four times in two days here, twice to the same
# person, including once *within a single command* that listed the directory and
# created the file in the wrong order.
#
# A plausible number is likely to be taken precisely because it is the next one
# everybody reaches for. So this does not check-then-create: it uses `set -C`,
# where the shell's own `>` fails if the file exists, and retries. The check and
# the claim are one operation and nothing can interleave between them.
set -eu

title=${1:-}
[ -n "$title" ] || { echo "claim-record: give a title" >&2; exit 2; }

root=$(cd "$(dirname "$0")/../.." && pwd)
records="$root/docs/records"

slug=$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//')

# Start above the highest that exists, then walk up until one sticks.
highest=$(ls "$records" | grep -oE '^[0-9]{4}' | sort -n | tail -1 || echo 0000)
n=$((10#$highest + 1))

while [ "$n" -lt 10000 ]; do
  path=$(printf '%s/%04d-%s.md' "$records" "$n" "$slug")
  # `set -C` makes `>` refuse an existing file, so the test and the create are
  # one syscall. Without it, two sessions both see a gap and both write.
  if (set -C; printf '# %04d — %s\n' "$n" "$title" > "$path") 2>/dev/null; then
    printf '%s\n' "$path"
    exit 0
  fi
  n=$((n + 1))
done

echo "claim-record: no free number below 10000" >&2
exit 1
