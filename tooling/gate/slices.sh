#!/bin/sh
# The gate's steps a change can move, as parallel slices.
#
#   tooling/gate/slices.sh [profile]        lowering (default) | conformance | backend | most
#   NTS_BIN=<pin> tooling/gate/slices.sh    measure a pin rather than target/release/nts
#
# Runs the profile's steps through all.sh (one run.mjs run over all of them) and
# prints its per-step summary; exits non-zero unless every step PASSed.
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
#
# **`tests` and `clippy` read the TREE, not `NTS_BIN`**, because they compile it --
# so the slice holding them is the one that cannot overlap with editing. On
# 2026-10-02 a run reported `FAILED: tests` for a doc comment written *after* it
# started: an indented measurement table in a `///` block is a Rust code block to
# rustdoc, and the doctest it became did not parse. The failure was real and its
# subject was not the pin. Finish editing, then run the slices -- or run the
# `conformance` profile, which holds neither.
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

# **One run of all.sh over the union, not one per slice.** all.sh hands every
# requested step to run.mjs, which runs them at once under one CPU, memory and
# frontend budget and reports each step PASS / FAIL / SKIPPED / NOT RUN. Several
# all.sh processes side by side would each assume the whole machine, which is
# the oversubscription the budget exists to prevent. The slices above are kept
# as the named profiles they always were.
steps=$(printf '%s\n' "$slices" | tr -s ' \n' '  ')
NTS_GATE_STEPS=$steps exec "$root/tooling/gate/all.sh"
