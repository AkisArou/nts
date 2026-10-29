#!/bin/sh
# Link into a worktree what no commit carries: the third-party clones, the
# native checker's upstream corpora and the workspace's node_modules.
#
#   sh tooling/lanes/inputs.sh gate <shared checkout> <tree>   what pinned.sh gates in
#   sh tooling/lanes/inputs.sh lane <shared checkout> <tree>   what `lane start` gives a lane
#
# One list for both, because a tree missing an input does not fail: it
# answers emptily. A gate step over no cases reads green, and a lane's tree
# without node_modules builds nothing a config file names. Run it again after
# any checkout; every link is re-made, never trusted.
#
set -eu

mode=$1
root=$2
tree=$3
case $mode in
  gate|lane) linked="third_party/typescript third_party/test262 third_party/are-we-fast-yet third_party/node third_party/node-source third_party/deno" ;;
  *) echo "inputs.sh: mode is gate or lane, not $mode" >&2; exit 2 ;;
esac

# The gitignored third-party clones are inputs rather than sources -- test262,
# Are We Fast Yet, TypeScript's tests and node's `lib/`. They are not in any
# commit, so a fresh worktree has none of them; symlinked rather than copied
# because they are read-only here and total about two gigabytes.
for shared in $linked; do
  if [ -d "$root/$shared" ]; then
    # A submodule leaves an empty directory behind in the worktree; an empty
    # directory is not "not there", so remove it before linking.
    [ -d "$tree/$shared" ] && [ ! -L "$tree/$shared" ] && rmdir "$tree/$shared" 2>/dev/null || true
    # Re-pointed every run: a link made once kept pointing wherever it first
    # pointed after the shared checkout's copy moved.
    # A real directory left (a checked-out submodule) is kept: `ln` would put
    # the link inside it.
    if [ -L "$tree/$shared" ] || [ ! -e "$tree/$shared" ]; then
      mkdir -p "$(dirname "$tree/$shared")"
      ln -sfn "$root/$shared" "$tree/$shared"
    fi
  fi
done

# The committed lock and workspace configuration own every importer. Registry
# content is acquired by submission preparation; these consumers stay offline.
# Each tree gets its own pnpm links, including new importers main does not have.
node "$(dirname -- "$0")/dependency-inputs.ts" --offline "$root" "$tree"
