#!/bin/sh
# Pin the benchmark worktree to a commit, and record which one.
#
#   tooling/bench/pin.sh              # report the current pin and its age
#   tooling/bench/pin.sh HEAD         # re-pin to HEAD
#   tooling/bench/pin.sh 7de873f      # re-pin to any commit
#
# # The failure this exists for, which cost an afternoon
#
# On 2026-09-08 the JVM lane read `benches/cases/absences` out of this worktree
# at **2.66x** and spent a profile and two measurements on it. The row is
# **1.27x**. The worktree was pinned at `f071672b` from 08:41, an ancestor of a
# fix that had landed that morning, so every emission under `target/bench` was
# of a program the tree no longer produced -- and `Integer.remainderUnsigned`,
# the fallback that fix removed, was sitting in the profile saying so.
#
# Nothing was broken. `tooling/gate/pinned.sh` beside this makes exactly the
# same argument for the gate tree and makes it well: "green" should mean green
# **at a hash**. The benchmark worktree had the first half of that -- it was
# pinned -- and not the second, because **nothing wrote the hash down where a
# reader of a number would meet it.**
#
# So a pin has a shelf life, and the whole of this script is making that
# visible. `PINNED` goes in the worktree root next to `target/`, and the age is
# printed at pin time and on every bare invocation.
#
# # Why it refuses rather than warns
#
# Re-pinning with emissions already in `target/bench` is the bad case: the
# directory then holds classes from two commits with nothing distinguishing
# them, and a sweep across it compares one program against another. That is
# worse than a stale pin, because a stale pin is uniformly stale. So a re-pin
# clears `target/bench` unless `--keep` says otherwise, and `--keep` prints what
# it is leaving behind.
#
# It also refuses while a measurement is running, for the reason
# `tooling/gate/wait-idle.sh` exists: moving the tree under a `nts-bench` that
# is reading it produces a number for two programs. **Only when the tree would
# actually move**, though -- the first thing anyone wants from this is
# provenance for a worktree that has none, and refusing to record where a tree
# already is would make that hardest exactly when the machine is busy, which is
# when a stale pin does its damage. It refused its own first useful invocation
# before that was separated.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tree=${NTS_BENCH_TREE:-$HOME/.cache/nts-jvm-sweep}
stamp=$tree/PINNED

# **Both a date and a distance, because they answer different questions.** The
# commit count says how much has happened since; the authored date says whether
# this is before or after the work someone is thinking about, which is what a
# reader of a number actually wants and which they can judge without knowing
# the log. The pin that started this was 181 commits and eight hours behind,
# and either number alone would have been enough to catch it.
report() {
  [ -f "$stamp" ] || { echo "no $stamp -- this worktree's provenance is unknown"; return 1; }
  sed 's/^/  /' "$stamp"
  pinned=$(sed -n 's/^commit: //p' "$stamp")
  [ -n "$pinned" ] || return 0
  behind=$(git -C "$root" rev-list --count "$pinned..HEAD" 2>/dev/null || echo "?")
  echo "  ${behind} commit(s) behind the current HEAD"
  # The emissions are what a sweep actually reads, and they can be older than
  # the pin: a re-pin that kept them leaves classes from before it.
  if [ -d "$tree/target/bench" ]; then
    newest=$(find "$tree/target/bench" -name '*.class' -newer "$stamp" -print -quit 2>/dev/null || true)
    if [ -n "$newest" ]; then
      echo "  NOTE: emissions under target/bench are newer than this stamp"
    fi
  fi
  # Explicit, because `[ -n "$x" ] && echo` as a function's last statement
  # returns 1 when the test fails -- so a *successful* report exited 1 and,
  # under `set -e`, would have taken a caller with it.
  return 0
}

if [ $# -eq 0 ]; then
  echo "benchmark worktree: $tree"
  report
  exit 0
fi

commit=$1
keep=${2:-}
sha=$(git -C "$root" rev-parse "$commit")
short=$(git -C "$root" rev-parse --short "$commit")

[ -d "$tree" ] || {
  echo "creating the worktree at $tree"
  git -C "$root" worktree add --detach "$tree" "$sha"
}

# Named before the attempt rather than discovered in git's error, because three
# sessions share this tree and whose edit it is matters more than that there is
# one. Reported, never discarded: a benchmark worktree is scratch to this
# script and may not be to whoever left something in it.
dirty=$(git -C "$tree" status --porcelain --untracked-files=no 2>/dev/null | head -5)
if [ -n "$dirty" ]; then
  echo "note: the worktree has local changes, which will block a checkout if"
  echo "  any of them differ between the two commits:"
  echo "$dirty" | sed 's/^/    /'
fi

# **Re-stamping the pin it is already on is not a re-pin.** The first thing
# anyone will want from this script is provenance for a worktree that already
# has none, and clearing that tree's emissions to record where it already is
# would be a strange way to help. Same sha, so the emissions match it.
at=$(git -C "$tree" rev-parse HEAD 2>/dev/null || echo none)

# Same rule as a measurement, and for the same reason -- but only when the tree
# would actually move. Refusing to *record* where a tree already is, because
# something is reading it, would make provenance hardest to add exactly when
# the machine is busy, which is when a stale pin does its damage. Asked and
# answered by this script refusing its own first useful invocation.
if [ "$at" != "$sha" ] &&
  { pgrep -x nts-bench > /dev/null 2>&1 || pgrep -x nts > /dev/null 2>&1; }; then
  echo "refusing: a measurement is running; moving the tree under it would" >&2
  echo "  produce a number for two programs. tooling/gate/wait-idle.sh" >&2
  exit 1
fi

# **The stamp is written from what the tree IS, not from what was asked for.**
# This line used to be `checkout ... > /dev/null 2>&1` with the status dropped,
# and then the stamp was written and "pinned" printed regardless. A worktree
# with a local edit to a file that differs between the two commits -- which is
# what `$HOME/.cache/nts-jvm-sweep` had, on `README.md` -- makes git refuse the
# checkout, and every one of those words was still printed. The provenance file
# would then name a commit the tree was not at, which is worse than having no
# provenance file: the whole point of this script is that a number can be
# traced to a hash, and a stamp that lies breaks that in the direction of false
# confidence.
#
# So: keep the error, and *verify the tree moved* rather than trust the exit
# status alone. `docs/records/0077` is the same argument -- where two things
# must agree and only one can be checked, assert rather than compute.
#
# **Both halves tested, because "it refused" alone does not say it refused for
# the right reason.** A clean worktree must still pin -- otherwise the refusal
# is unconditional and the script is merely broken the other way -- and a dirty
# one must refuse *and* leave the stamp naming where the tree really is:
#
#     control 1   clean tree   pinned to 4a5ccc47, tree really at 4a5ccc47
#     control 2   dirty tree   refused, and stamp and tree both still 4a5ccc47
#
# Before this, control 2 stamped `e7342345` over a tree sitting at `4a5ccc47`.
if ! failure=$(git -C "$tree" checkout --detach "$sha" 2>&1); then
  echo "refusing: the worktree would not move to $short" >&2
  echo "$failure" | sed 's/^/  /' >&2
  echo "  nothing was stamped. Resolve the tree at $tree and run this again." >&2
  exit 1
fi
landed=$(git -C "$tree" rev-parse HEAD)
if [ "$landed" != "$sha" ]; then
  echo "refusing: checkout reported success and the tree is at" >&2
  echo "  $(git -C "$tree" rev-parse --short HEAD), not $short. Nothing stamped." >&2
  exit 1
fi
# **After the checkout, not before.** This block used to run first, so a pin
# that then failed had already deleted the emissions -- destroying state on
# behalf of an operation that did not happen, and leaving a tree with neither
# the old classes nor the new commit. `$at` is read before the checkout, so
# moving the decision here does not change what it decides.
if [ "$at" = "$sha" ]; then
  echo "already at $short -- recording provenance, leaving target/bench alone"
elif [ -d "$tree/target/bench" ] && [ "$keep" != "--keep" ]; then
  echo "clearing target/bench: it holds emissions from the previous pin"
  rm -rf "$tree/target/bench"
elif [ -d "$tree/target/bench" ]; then
  echo "KEEPING target/bench, which holds emissions from the PREVIOUS pin --"
  echo "  a sweep across it now compares two programs. Re-emit before trusting it."
fi

subject=$(git -C "$root" log -1 --format=%s "$sha")
when=$(git -C "$root" log -1 --format=%ci "$sha")

cat > "$stamp" <<EOF
commit: $sha
short: $short
subject: $subject
authored: $when
pinned-by: tooling/bench/pin.sh
EOF

echo "pinned $tree to $short"
report
