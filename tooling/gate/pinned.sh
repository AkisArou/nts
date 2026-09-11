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

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
commit=${1:-HEAD}
sha=$(git -C "$root" rev-parse --short "$commit")
tree=${NTS_GATE_TREE:-$HOME/.cache/nts-gate/tree}
target=${NTS_GATE_TARGET:-$HOME/.cache/nts-gate/target}

mkdir -p "$(dirname "$tree")" "$target"

if [ -e "$tree/.git" ]; then
  git -C "$tree" checkout --detach -q "$sha"
else
  # `worktree add` writes to `.git/worktrees/`, not to the shared index, so it
  # is safe while another session is staging.
  git -C "$root" worktree add --detach -q "$tree" "$sha"
fi

# The gitignored third-party clones are inputs rather than sources -- test262,
# Are We Fast Yet, node's `lib/`, and the tsgo binary. They are not in any
# commit, so a fresh worktree has none of them; symlinked rather than copied
# because they are read-only here and total about two gigabytes.
# `typescript-go` is a *submodule*, so a fresh worktree has an empty directory
# where it should be -- and the corpus step then reports `invalid HIR must be
# zero` when the truth is that there are no cases to read. Symlinked with the
# rest, and listed first because it is the one whose absence lies.
for shared in third_party/typescript-go third_party/test262 third_party/are-we-fast-yet third_party/node third_party/deno; do
  if [ -d "$root/$shared" ]; then
    # A submodule leaves an empty directory behind in the worktree; an empty
    # directory is not "not there", so remove it before linking.
    [ -d "$tree/$shared" ] && [ ! -L "$tree/$shared" ] && rmdir "$tree/$shared" 2>/dev/null || true
    [ -e "$tree/$shared" ] || ln -s "$root/$shared" "$tree/$shared"
  fi
done

# `node_modules` is not in any commit either, and its absence does not look
# like its absence: `examples/library` imports a workspace package, so it fails
# to *typecheck*, and `backend_examples` counts that as a plain failure with
# thirty other names beside it. Three of these, and the nested ones are the ones
# that get missed -- the workspace links inside resolve by absolute path.
for modules in node_modules examples/library/node_modules runtime/node/node_modules; do
  [ -d "$root/$modules" ] || continue
  # **Copied rather than linked where a workspace link lives inside it.**
  #
  # `examples/library/node_modules/@native-typescript/config` is a *relative*
  # symlink, `../../../../tooling/config`. A symlink to the whole directory
  # makes that relative path resolve from its physical location -- the main
  # tree -- so the worktree compiled `$root/tooling/config/src/*.ts`, which is
  # outside its own `rootDir`, and tsgo answered `TS6059 ... is not under
  # rootDir`. The example then failed to *typecheck*, which reads as "refuses
  # nothing" in `example-refusals` and as one more non-agreement in `llvm` and
  # `jvm` -- three symptoms, none of them naming the cause.
  #
  # `cp -a` keeps a relative link relative, so it resolves inside the tree and
  # the pin means what it says. Only the small ones: the top-level tree is 32M
  # of pnpm store with no workspace link in it and is still shared.
  case $modules in
    node_modules) ln -sfn "$root/$modules" "$tree/$modules" ;;
    *)
      rm -rf "$tree/$modules"
      mkdir -p "$(dirname "$tree/$modules")"
      cp -a "$root/$modules" "$tree/$modules"
      ;;
  esac
done

echo "gate: $sha in $tree"
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
