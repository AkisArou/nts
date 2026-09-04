#!/bin/sh
# Commit exactly the paths named, and refuse to commit anything else.
#
# Three sessions share one checkout and therefore one index, so a plain
# `git add` stages someone else's in-progress work into your commit. The
# convention that grew around that was a private `GIT_INDEX_FILE`, and on
# 2026-09-04 it removed 1121 of 1124 files from the repository in one commit:
# `GIT_INDEX_FILE` pointing at a path that does not exist does not fail, git
# creates an *empty* index there, and `commit` faithfully writes the tree that
# index describes -- which is a tree containing only the paths you added. The
# leftover index was 512 bytes where a seeded one is a hundred kilobytes.
#
# So this does not use a private index. `git commit -- <paths>` is a partial
# commit: git builds the tree from HEAD plus those paths internally, touches
# nothing that is staged, and cannot express "and delete everything else".
# It is the thing the private index was reaching for.
#
# The check afterwards is the part a convention cannot have. A wrapper that
# refuses beats a rule people follow, and the rule had been followed correctly
# a dozen times before it wasn't.
#
# Usage: tooling/gate/commit-mine.sh -F <message-file> -- <path>...
#        tooling/gate/commit-mine.sh -m <message>      -- <path>...
set -eu

args=""
while [ $# -gt 0 ]; do
  case $1 in
    --) shift; break ;;
    *) args="$args $1"; shift ;;
  esac
done
[ $# -gt 0 ] || { echo "commit-mine: no paths given" >&2; exit 2; }

for path in "$@"; do
  [ -e "$path" ] || { echo "commit-mine: $path does not exist" >&2; exit 2; }
done

# A partial commit can only name paths git already knows, so a new file needs
# registering first. `--intent-to-add` records the path and *not* its content,
# which is the weakest thing that works: the commit still takes the content from
# the working tree, and nobody else's staged work is disturbed.
for path in "$@"; do
  git ls-files --error-unmatch -- "$path" > /dev/null 2>&1 || git add -N -- "$path"
done

before=$(git ls-tree -r HEAD --name-only | wc -l)

# shellcheck disable=SC2086
git commit -q $args -- "$@"

after=$(git ls-tree -r HEAD --name-only | wc -l)
touched=$(git diff --name-only HEAD^ HEAD | wc -l)
wanted=$#

# A partial commit may legitimately add or remove files, but only the ones
# named -- so the tree may not shrink by more than the paths given.
if [ "$after" -lt $((before - wanted)) ]; then
  echo "commit-mine: REFUSING -- the tree went from $before files to $after" >&2
  echo "  and only $wanted paths were named. The commit is HEAD; inspect it" >&2
  echo "  before doing anything else. It has not been pushed." >&2
  exit 1
fi
if [ "$touched" -gt "$wanted" ]; then
  echo "commit-mine: REFUSING -- $touched files changed, $wanted were named:" >&2
  git diff --name-only HEAD^ HEAD | sed 's/^/    /' >&2
  exit 1
fi

echo "commit-mine: $touched file(s), tree $before -> $after"
git --no-pager log --oneline -1
