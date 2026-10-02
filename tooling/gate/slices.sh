#!/bin/sh
# The gate's steps a change can move, as parallel slices.
#
#   tooling/gate/slices.sh [profile]        lowering (default) | conformance | backend | most
#   NTS_BIN=<pin> tooling/gate/slices.sh    measure a pin rather than target/release/nts
#
# Prints one line per slice and exits non-zero if any failed. Each slice's full
# log is named in its line.
#
# # Why
#
# `all.sh` runs twenty-four steps in series and takes about forty-five minutes,
# of which `interop` is fourteen and `integrity-runtime` most of the rest --
# neither of which a lowering change can move. On 2026-10-02 a conformance
# change was refuted by `test262-cases` in the run's **first four minutes** and
# the other forty were spent proving things the change could not touch. The user
# called it absurd, and they were right.
#
# This is not a second gate and holds no opinion `all.sh` does not: it sets
# `NTS_GATE_STEPS` and runs `all.sh` several times at once. `all.sh` validates
# every requested name against the steps it offers and fails the run when one is
# unknown -- *"a `green` here would mean no work was done"* -- so a typo here
# cannot read as a pass.
#
# **It does not replace the full gate.** `all.sh` has caught, more than once,
# what every arm a person chose had missed; the discipline is to land on the
# slices plus whatever `owed.mjs` names, and to run the full gate as a **sweep
# over the commits since the last one** rather than once per commit. It floors
# three commits as well as one, and `pinned.sh <sha>` bisects a sweep failure.
#
# The slices are grouped so that each is about one question and they finish at
# roughly the same time. `build` is in none of them: a slice measures a binary
# that already exists, which is what makes `NTS_BIN=<pin>` the normal way to
# call this.
set -u
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

profile=${1:-lowering}
case $profile in
  # A change to lowering: what compiles, what it answers, and what refuses.
  lowering)
    slices="test262-cases
            test262-builtins-cases test262-rest-cases test262
            outcomes integrity blockers definitions example-refusals records
            clippy tests corpus assembles types primitives" ;;
  # A conformance change: the recorded sets first, because they are what refutes it.
  conformance)
    slices="test262-cases
            test262-builtins-cases test262-rest-cases test262
            outcomes blockers records" ;;
  # A representation change: the JVM is the type-confusion oracle.
  backend)
    slices="jvm-verifies
            assembles types primitives corpus
            clippy tests benches" ;;
  # Everything but the two steps no lowering change moves, for a last look
  # before a sweep.
  most)
    slices="test262-cases
            test262-builtins-cases test262-rest-cases test262
            outcomes integrity blockers definitions example-refusals records
            clippy tests corpus assembles types primitives
            jvm-verifies benches snapshot-cache config react-sources
            format reformat" ;;
  *)
    echo "usage: $0 [lowering|conformance|backend|most]" >&2; exit 2 ;;
esac

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT INT TERM
n=0
printf '%s\n' "$slices" | while IFS= read -r slice; do
  [ -n "$(printf '%s' "$slice" | tr -d ' ')" ] || continue
  n=$((n + 1))
  printf '%s\n' "$slice" > "$logs/$n.steps"
done
started=$(date +%s)
for steps in "$logs"/*.steps; do
  i=$(basename "$steps" .steps)
  # Each slice gets its own log *outside* the temp dir, so it outlives this run
  # and the line that names it is still useful after the trap fires.
  out=${NTS_SLICE_LOGS:-${TMPDIR:-/tmp}}/gate-slice-$i.log
  printf '%s\n' "$out" > "$logs/$i.log-path"
  NTS_GATE_STEPS=$(cat "$steps") "$root/tooling/gate/all.sh" > "$out" 2>&1 &
  printf '%s\n' "$!" > "$logs/$i.pid"
done
failed=0
for steps in "$logs"/*.steps; do
  i=$(basename "$steps" .steps)
  out=$(cat "$logs/$i.log-path")
  wait "$(cat "$logs/$i.pid")" || failed=$((failed + 1))
  verdict=$(sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -E '^(FAILED|green)' | head -1)
  printf '  %-72s %s\n' "$(tr -s ' ' < "$steps" | tr '\n' ' ')" "${verdict:-no verdict}"
  [ "${verdict:-}" = "green" ] || printf '    %s\n' "$out"
done
printf '  %s slice(s), %s failed, in %ss\n' \
  "$(ls "$logs"/*.steps | wc -l | tr -d ' ')" "$failed" "$(($(date +%s) - started))"
[ "$failed" -eq 0 ]
