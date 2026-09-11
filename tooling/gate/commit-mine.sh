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

# A path that is gone from the tree is either a typo or a deletion, and the
# difference is whether git is tracking it. Refusing both made a rename
# impossible to commit in one piece: `git mv` leaves the old name deleted, and
# naming it here failed, so record 0191's rename landed as an add with the
# removal left behind -- HEAD carried two copies while the tree carried one, and
# the `records` check reads the tree and passed.
for path in "$@"; do
  [ -e "$path" ] && continue
  git ls-files --error-unmatch -- "$path" >/dev/null 2>&1     || { echo "commit-mine: $path does not exist and git does not know it" >&2; exit 2; }
done

# A partial commit can only name paths git already knows, so a new file needs
# registering first. `--intent-to-add` records the path and *not* its content,
# which is the weakest thing that works: the commit still takes the content from
# the working tree, and nobody else's staged work is disturbed.
for path in "$@"; do
  git ls-files --error-unmatch -- "$path" > /dev/null 2>&1 || git add -N -- "$path"
done

# Clippy before the commit, not after the floor.
#
# The gate is a serialised shared resource: three sessions queue on it, and a
# step that fails in second position discards everything behind it. So the cost
# of a lint warning is not the thirty seconds it takes me to find it, it is the
# twenty-minute gate run somebody else loses -- incurred by one session and paid
# by another. That asymmetry is why this is here rather than in anybody's
# habits; it went wrong four times in one day with the habit fully understood.
#
# `NTS_SKIP_CLIPPY=1` for a commit that has to happen anyway, which is a
# decision worth having to type.
if [ -z "${NTS_SKIP_CLIPPY-}" ] && command -v cargo > /dev/null 2>&1; then
  if ! cargo clippy --workspace --all-targets > /tmp/nts-commit-clippy.$$ 2>&1; then
    # A *build* failure is not a lint failure, and with three sessions in one
    # checkout it is often somebody else's edit landing mid-run. Still a
    # refusal -- committing against a workspace that does not build means the
    # commit is untested -- but named, so the next step is "wait or ask" rather
    # than "hunt for my warning".
    if grep -qE '^error\[E[0-9]+\]|^error: could not compile' /tmp/nts-commit-clippy.$$; then
      echo "commit-mine: REFUSING -- the workspace does not build, so nothing" >&2
      echo "  here has been linted. This may be another session mid-edit:" >&2
      grep -E '^error' /tmp/nts-commit-clippy.$$ | head -8 >&2
    else
      echo "commit-mine: REFUSING -- clippy is not clean:" >&2
      grep -E '^(warning|error)' /tmp/nts-commit-clippy.$$ | head -20 >&2
    fi
    rm -f /tmp/nts-commit-clippy.$$
    exit 1
  fi

  # `--all-targets` exits zero on warnings unless denied, so the text is the
  # check rather than the status.
  #
  # Scoped to the files being committed. Three sessions share this checkout, and
  # blocking my commit on somebody else's in-flight warning is the same coupling
  # the private-index convention was reaching for and got wrong -- it makes one
  # session's editing pause another's work for no gain, since the gate will
  # catch theirs anyway. Warnings elsewhere are printed and not fatal.
  mine=""
  for path in "$@"; do
    if grep -q -- "--> $path:" /tmp/nts-commit-clippy.$$; then
      mine="$mine $path"
    fi
  done
  if [ -n "$mine" ]; then
    echo "commit-mine: REFUSING -- clippy warns about files in this commit:" >&2
    for path in $mine; do
      grep -B 1 -- "--> $path:" /tmp/nts-commit-clippy.$$ | head -6 >&2
    done
    rm -f /tmp/nts-commit-clippy.$$
    exit 1
  fi
  if grep -qE '^warning: ' /tmp/nts-commit-clippy.$$; then
    echo "commit-mine: note -- clippy warns elsewhere in the workspace," >&2
    echo "  not in these files. The gate will still be red until it is fixed." >&2
    grep -E -- '-->' /tmp/nts-commit-clippy.$$ | sort -u | head -5 >&2
  fi
  rm -f /tmp/nts-commit-clippy.$$
fi

# clang-format, on the C being committed and nothing else.
#
# The same argument the clippy block above makes, and it cost a gate slot to
# learn that the argument applies to a second formatter. `format` is step three
# of the gate, so an unformatted `runtime/c` file fails before `tests`,
# `corpus`, `profile` and everything the run was actually for -- twenty minutes
# of a resource three sessions queue on, spent finding out that a helper's
# continuation line was wrapped one column short.
#
# Scoped to the paths named here for the same reason clippy is: another
# session's unformatted file is the gate's business and not this commit's.
# `--dry-run -Werror` asks without writing, so a refusal never leaves the tree
# in a state the author did not choose.
if command -v clang-format > /dev/null 2>&1; then
  unformatted=""
  for path in "$@"; do
    case $path in
      *.c|*.h) [ -f "$path" ] || continue ;;
      *) continue ;;
    esac
    if ! clang-format --style=file --dry-run -Werror "$path" > /dev/null 2>&1; then
      unformatted="$unformatted $path"
    fi
  done
  if [ -n "$unformatted" ]; then
    echo "commit-mine: REFUSING -- clang-format would change files in this commit:" >&2
    for path in $unformatted; do echo "  $path" >&2; done
    echo "  run: clang-format --style=file -i$unformatted" >&2
    exit 1
  fi
fi

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
# Every file the commit touched has to be one that was named, or under a
# directory that was named.
#
# This counted instead, `touched -gt wanted`, and the count is not the
# invariant: naming one directory of four fixtures is one path and four files,
# so a correct commit reported "7 files changed, 5 were named" and the word
# REFUSING -- *after* writing the commit, which the message did not say. A
# safety check that cries wolf on a good commit gets read past, and the run it
# is protecting against is the one where somebody reads past it.
#
# Containment is what was meant, and it says the same thing about the case this
# was built for -- a file nobody named cannot be under a path somebody named.
stray=""
for changed in $(git diff --name-only HEAD^ HEAD); do
  covered=""
  for path in "$@"; do
    case "$changed" in
      "$path" | "${path%/}"/*) covered=yes; break ;;
    esac
  done
  [ -n "$covered" ] || stray="$stray $changed"
done
if [ -n "$stray" ]; then
  echo "commit-mine: REFUSING -- the commit is written and is HEAD, and it" >&2
  echo "  touched files that no named path covers. Inspect it before doing" >&2
  echo "  anything else; it has not been pushed. The strays:" >&2
  for changed in $stray; do echo "    $changed" >&2; done
  exit 1
fi

echo "commit-mine: $touched file(s), tree $before -> $after"
git --no-pager log --oneline -1
