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
#
# # The thing that must be unique is the number, and for a day this claimed a name
#
# On 2026-09-06 two records were committed as 0164. Using this script would not
# have prevented it: both sessions compute `n=0164` from the same listing, and
# then `set -C` compares *paths* -- `0164-object-is-a-tag-...` and
# `0164-string-of-an-int32-...` are different files, so the exclusive create
# succeeds for both. The atomicity was real and was guarding the wrong noun.
#
# So the claim is now made on a number-only name, `0164.md`, and the titled name
# is a rename afterwards. A second session racing for the same number loses the
# create, sees the file, and walks up. The window between the two steps is safe
# in the direction that matters: another session sees a taken number, never a
# free one.
#
# `all.sh` asserts no two records share a number, because a convention with
# nothing watching it is how both this and `pgrep -f` got through -- and the
# assertion is what makes using the script optional rather than load-bearing.
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
  # Claim the *number*, not the name. `set -C` makes `>` refuse an existing
  # file, so the test and the create are one syscall -- but only for this exact
  # path, which is why the path holds nothing but the number.
  claim=$(printf '%s/%04d.md' "$records" "$n")
  path=$(printf '%s/%04d-%s.md' "$records" "$n" "$slug")
  if [ -e "$path" ] || ls "$records"/$(printf '%04d' "$n")-*.md >/dev/null 2>&1; then
    n=$((n + 1)); continue
  fi
  if (set -C; printf '# %04d — %s\n' "$n" "$title" > "$claim") 2>/dev/null; then
    mv -- "$claim" "$path"
    printf '%s\n' "$path"
    exit 0
  fi
  n=$((n + 1))
done

echo "claim-record: no free number below 10000" >&2
exit 1
