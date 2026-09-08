#!/usr/bin/env bash
# A worktree pinned at one commit, for a measurement that must not move.
#
#   tooling/conformance/pinned-tree.sh [name] [commit]
#   eval "$(tooling/conformance/pinned-tree.sh counted)"   # prints the exports
#
# Three sessions commit into this checkout continuously, and a sweep that reads
# source per module as it goes will read one tree for its early modules and
# another for its late ones. The result describes a tree that never existed and
# *nothing in the output says so* -- it looks exactly like a clean run. Four
# sweeps in a row were discarded for that on 2026-09-08.
#
# This was avoided for a whole night on the guess that a `node_modules` install
# made a worktree expensive. **The guess was never measured and was wrong by
# orders of magnitude: `git worktree add` takes 0.07 seconds and 26MB.**
# `runtime/node/*/node_modules` totals 256K and holds only `.tsbuild`
# directories; there is no install. Nine worktrees already existed in
# `~/.cache`, so it was the established practice here the whole time.
#
# What is pinned is the *tree*. `target/` and `third_party/` are not in a
# worktree -- `third_party/node` is a submodule, so the directory exists and is
# empty, which is why this symlinks the child rather than the parent: `ln -sfn`
# against a real directory puts the link *inside* it and the failure reads as a
# missing `node_api.h`.
set -eu
cd "$(dirname "$0")/../.."
root=$PWD

name=${1:-pinned}
commit=${2:-$(git rev-parse HEAD)}
tree="$HOME/.cache/nts-node-$name"

if [ -d "$tree" ]; then
  git worktree remove --force "$tree" 2>/dev/null || rm -rf "$tree"
fi
git worktree add --detach "$tree" "$commit" > /dev/null

# Read-only, and deliberately not pinned: these are pinned by other means (a
# submodule sha, a built binary) and copying them would cost far more than the
# tree does.
ln -sfn "$root/third_party/node" "$tree/third_party/node"
mkdir -p "$tree/target"
ln -sfn "$root/target/tsgo" "$tree/target/tsgo"

# `target/node` inside the worktree, which is the other half of why this works:
# the shared `target/node` is owned by no session, so another lane rebuilding
# the same module mid-run silently substitutes the artifact under test.
echo "export NTS_PINNED_TREE=$tree"
echo "export NTS_TSGO=$tree/target/tsgo"
echo "# pinned at $(git rev-parse --short "$commit"); cd \$NTS_PINNED_TREE to run"
