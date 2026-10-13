#!/bin/sh
# Run the gate against a commit, in a worktree nobody is editing.
#
#   tooling/gate/pinned.sh              # HEAD
#   tooling/gate/pinned.sh 7de873f      # any commit
#
# # Why the gate needs its own tree
#
# Three sessions edit this checkout continuously, and `gate.lock.d` governs
# *when* a gate runs rather than whether the tree holds still while it does. On
# 2026-09-04 a correctly-locked `rc` step reported **0 of 96 passing, every case
# failing**, because two things changed under it mid-run: `cargo test` relinked
# `target/release/nts`, and a mutation test appended a line to a source file the
# step reads. Nothing was broken. The run had simply measured two different
# programs and a file in two states.
#
# The binary half is the worse one and is the reason `CARGO_TARGET_DIR` is *not*
# pointed back at the shared directory here. A changed source makes the gate
# read a different program; a relinked binary makes it read a different program
# **partway through**, so the first examples and the last were compiled by
# different compilers and the report is a blend. Nothing in the output says so.
#
# # What it buys beyond correctness
#
# "Green" stops meaning *green against whatever the tree happened to be* --
# which nobody can reproduce afterwards, including whoever ran it -- and starts
# meaning green **at a hash**, which is what a commit message should quote.
#
# It also removes a rule rather than adding one. "Hold the lock and make no
# edits" is unenforceable across three sessions that each think their edit is
# small, and this week has been mostly about rules with nothing watching them.
set -eu

# The checkout every worktree shares, wherever this script runs from: the
# gitignored inputs linked below live there and nowhere else, and a worktree's
# own copies (missing node_modules, a dangling submodule link) gated three steps
# red for nothing the change did.
root=$(dirname -- "$(git -C "$(dirname -- "$0")" rev-parse --path-format=absolute --git-common-dir)")
commit=${1:-HEAD}
# The rest are passed to all.sh (step names); the commit is not one.
[ $# -gt 0 ] && shift
# Resolved where the script runs, so `HEAD` is that tree's: object ids are
# shared by every worktree, branch names and HEAD are not.
sha=$(git -C "$(dirname -- "$0")" rev-parse --short "$commit")
tree=${NTS_GATE_TREE:-$HOME/.cache/nts-gate/tree}
target=${NTS_GATE_TARGET:-$HOME/.cache/nts-gate/target}

mkdir -p "$(dirname "$tree")" "$target"

# **Hold the tree before touching it.** Two runs against one tree each checked
# out their commit and built over the other's; the runner's own lock comes
# after both. The kernel releases this one when the last process holding it
# exits, so it never goes stale, and every process the gate starts inherits it.
exec 9>>"$tree.lock"
if ! flock -n 9; then
  echo "gate: $tree is in use; waiting"
  flock 9
fi

if [ -e "$tree/.git" ]; then
  # `--force`, because a build in this tree dirties tracked files and a plain
  # checkout then refuses. `cargo` rewrites `Cargo.lock` whenever the resolved
  # graph differs from the committed one, so the *second* gate after such a
  # commit aborts with "local changes would be overwritten" -- naming
  # `Cargo.lock`, which reads like a real finding and is not one. The first
  # time this happened the run reported nothing at all and the wrapper's exit
  # status was still 0.
  #
  # Discarding is right here and only here: this worktree exists to hold one
  # commit while it is gated, nobody edits it, and anything in it that is not
  # the commit is something a previous gate left behind.
  git -C "$tree" checkout --detach -q --force "$sha"
  # And what an earlier run left untracked is not part of this commit either:
  # an untracked example directory is one more program to every step that
  # globs examples/. The inputs linked below are re-made after this.
  git -C "$tree" clean -fdq -e third_party -e node_modules -e '**/node_modules'
else
  # `worktree add` writes to `.git/worktrees/`, not to the shared index, so it
  # is safe while another session is staging.
  git -C "$root" worktree add --detach -q "$tree" "$sha"
fi

# What no commit carries -- the third-party clones, the tsgo binary, the
# workspace's node_modules -- linked in. One list, shared with `lane start`,
# so a gate tree and a lane's tree cannot disagree about what is there; the
# reasons for each entry are in that script.
sh "$(dirname -- "$0")/../lanes/inputs.sh" gate "$root" "$tree"

echo "gate: $sha in $tree"
# Set up and stop: what `lane doctor` and this script's own test ask.
[ -n "${NTS_GATE_SETUP_ONLY:-}" ] && exit 0
cd "$tree"
CARGO_TARGET_DIR="$target" cargo build --release -q
NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} \
NTS_BIN="$target/release/nts" \
NTS_SUITE_BIN="$target/release/nts-suite" \
CARGO_TARGET_DIR="$target" \
  sh tooling/gate/all.sh "$@"
status=$?
echo "gate: $sha above"
exit $status
