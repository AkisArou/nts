#!/bin/sh
# The whole gate, in the order that fails fastest.
#
#   tooling/gate/all.sh
#
# Four checks, and they answer different questions:
#
#   clippy      does it lint clean
#   cargo test  the unit tests, including the C runtime's own
#   nts-suite   does arbitrary input produce invalid IR or C that will not
#               compile -- the two rows that must stay at zero
#   gate.sh     does the compiled program agree with node, case by case
#
# Only the last checks *correctness*. The corpus measures reach and robustness
# and never runs anything; the profile in `runtime/node` is not here at all
# because it is a measurement rather than a gate.
#
# Sequential on purpose. Each of these is already parallel inside -- `gate.sh`
# runs a worker per core, `nts-suite` runs eight -- so running them at once
# would oversubscribe the one resource that breaks first, which is concurrent
# frontends. See `CROWDED` in tooling/suite.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"

NTS_TSGO=${NTS_TSGO:-$root/target/tsgo}
export NTS_TSGO

# One knob for how hard this is allowed to run the machine.
#
#   NTS_JOBS=6 tooling/gate/all.sh
#
# There are three separate limits underneath -- cargo's build jobs, the example
# runner's workers, and the corpus suite's -- and setting two of the three is
# indistinguishable from setting all three until the one that was missed is the
# step that runs hot. So they move together or not at all.
#
# Unset means each keeps its own default, which is what a healthy machine
# wants. It exists because this one is not: two of its P-cores fail their own
# parity checks under sustained all-core load, and the compile that provoked
# that is exactly this script.
if [ -n "${NTS_JOBS:-}" ]; then
  export CARGO_BUILD_JOBS="$NTS_JOBS"
  export NTS_GATE_JOBS="$NTS_JOBS"
  export NTS_SUITE_JOBS="$NTS_JOBS"
fi

step() {
  printf '\n\033[1m%s\033[0m\n' "$1"
  shift
  started=$(date +%s)
  "$@" || { printf '\033[31mFAILED\033[0m: %s\n' "$1"; exit 1; }
  printf '  %ss\n' "$(($(date +%s) - started))"
}

lint() { cargo clippy --workspace --all-targets 2>&1 | grep -E '^(warning|error)' && return 1; return 0; }
# The C half of the same question. A whole-file reformat once arrived mixed
# into an unrelated change, which is what an editor formatting on save does to
# a tree that has never said which format it wants. `.clang-format` says, and
# this is what keeps it true.
#
# Skipped rather than failed where clang-format is absent: it is not a build
# dependency, and a contributor without it should still be able to run the gate.
format() {
  command -v clang-format >/dev/null || { echo "  clang-format absent, skipped"; return 0; }
  bad=$(for f in runtime/c/*.c runtime/c/*.h runtime/c/tests/*.c; do
          clang-format --style=file "$f" | cmp -s - "$f" || echo "$f"
        done)
  [ -z "$bad" ] && return 0
  echo "  not formatted:"
  echo "$bad" | sed 's/^/    /'
  echo "  run: clang-format --style=file -i runtime/c/*.c runtime/c/*.h runtime/c/tests/*.c"
  return 1
}
tests() { cargo test --workspace >/dev/null 2>&1; }

# The cross-product of value kinds and the operations that read them, settled
# by node.
#
# Every correctness bug found in this compiler by hand has been one cell of such
# a product: `null === undefined` answered true, `typeof f === "function"`
# answered false, `v === undefined` on a `string | null` answered true, a
# `bigint` in a condition emitted `isnan` on an `__int128`. Each was invisible
# to a gate of ninety hand-written examples, because an example covers what
# somebody thought to write down. This covers what nobody did, and it found the
# last of those four the first time it ran.
sweep() {
  ./tooling/sweep/run.sh 2>&1 | grep -E "checked|agreed|disagree|not emitted" | sed 's/^/  /'
  ./tooling/sweep/run.sh >/dev/null 2>&1
}

# The node profile, emitted but not built.
#
# Building the addons needs node's headers and belongs to the conformance
# harness. *Emitting* them is this compiler's own job, and until now nothing in
# this gate did it -- so the profile was the largest body of TypeScript the
# compiler sees and the least watched.
#
# A crash is the only failure here. Refusals are expected, counted elsewhere,
# and a module still being written may refuse a great deal without that being
# this step's business. But no input may make the emitter panic, whoever wrote
# it and whatever it says: a panic is a compiler bug by definition.
#
# This exists because eleven of these modules crashed the emitter while every
# other step of this gate was green. A `bigint` shift fell past its helper into
# an `unreachable!`, and the examples could not see it because none of them
# shifted a bigint by a value.
profile() {
  crashed=$(for m in "$root"/runtime/node/*/tsconfig.json; do
              if ./target/release/nts emit-c "$m" --out "$root/target/gate-profile" \
                   --napi 2>&1 | grep -q "panicked at"; then
                basename "$(dirname "$m")"
              fi
            done)
  printf '  %s modules emitted\n' "$(ls -d "$root"/runtime/node/*/tsconfig.json | wc -l)"
  if [ -n "$crashed" ]; then
    echo "  the emitter panicked on:"
    echo "$crashed" | sed 's/^/    /'
    return 1
  fi

  # And the SSA form the profile produces, which nothing here asked about.
  #
  # `invalid HIR 0` is the corpus's number, over single-file cases the suite
  # generates. It says nothing about the largest body of TypeScript this
  # compiler sees, and two of these modules have not verified for some time:
  # `nts hir` prints it and no step read the line. The same shape as the
  # profile itself, which existed as a measurement for months before any gate
  # step emitted it, and as `uncompilable C`, which was 15 and invisible.
  #
  # Ratcheted downward only, like the `rc` list, and empty. `path` and `url`
  # were on it for one commit: `drop_callers_of_refused` removes a closure whose
  # body calls something refused, and `monomorphize` then wrote that closure's
  # name into a `Callee::Direct` for a clone -- a call that outlived its target,
  # which nothing looked at again. A clone is only worth making while the name
  # it is built around still refers to something.
  known_invalid=""
  invalid=$(for m in "$root"/runtime/node/*/tsconfig.json; do
              if ./target/release/nts hir "$m" 2>&1 | grep -q "does NOT verify"; then
                basename "$(dirname "$m")"
              fi
            done | sort | tr '\n' ' ')
  # Guarded, because `printf '%s\n'` with no arguments still prints a newline
  # -- so an empty list compared as " " against an empty result and the step
  # failed on the run that emptied it.
  expected=""
  [ -n "$known_invalid" ] && expected=$(printf '%s\n' $known_invalid | sort | tr '\n' ' ')
  if [ "$invalid" != "$expected" ]; then
    echo "  expected invalid HIR in: $expected"
    echo "  actually invalid in:     $invalid"
    return 1
  fi
  [ -n "$expected" ] && echo "  known invalid HIR: $expected"
  return 0
}
# The second backend, against the same oracle.
#
# `NTS_BACKEND=llvm` runs the whole differential through
# `compiler/codegen/llvm`: every example, every case, the same hostile pool, the
# same comparison against node. That is a stronger net than comparing the two
# backends to each other -- node is the oracle either way, and two backends that
# both agree with node agree with each other.
#
# An example is either wholly rendered or not attempted, because a function the
# backend has not learned yet is absent and the driver would fail to link. So
# this is a count of *examples carried*, and it ratchets **upward**: the C
# backend's match is exhaustive and adding an `OpKind` breaks its build, while
# this one has a fallthrough that refuses -- which is safe, and is exactly how a
# second backend silently falls behind. A number that may not go down is what
# turns that into a failed build.
llvm() {
  floor=77
  passed=0
  total=0
  behind=""
  for d in examples/*/tsconfig.json; do
    n=$(basename "$(dirname "$d")")
    case "$n" in
      invalid|unsupported) continue ;;
    esac
    total=$((total + 1))
    if NTS_BACKEND=llvm ./target/release/nts check "$d" >/dev/null 2>&1; then
      passed=$((passed + 1))
    else
      behind="$behind $n"
    fi
  done
  printf '  %s of %s examples agree with node through the LLVM backend\n' "$passed" "$total"
  if [ "$passed" -lt "$floor" ]; then
    echo "  ^ fell from $floor to $passed:$behind"
    return 1
  fi
  [ "$passed" -gt "$floor" ] && printf '  ^ raise the floor in tooling/gate/all.sh to %s\n' "$passed"
  return 0
}
corpus() {
  ./target/release/nts-suite > "$root/target/suite-report.txt" 2>&1
  grep -E "single-file|lowered completely|refused a construct|rejected by|frontend failed|invalid HIR|uncompilable C" \
    "$root/target/suite-report.txt"
  # `invalid HIR` must be zero: a rejected SSA form on arbitrary input is a bug
  # however well the hand-written tests do.
  #
  # Read as a number rather than matched as text. The first version was
  # `grep "invalid HIR *[^0]"`, which matches the zero line too -- the ` *`
  # gives back a space for `[^0]` to have -- so the gate failed on a clean run.
  bad=$(awk '/invalid HIR/ { print $NF + 0 }' "$root/target/suite-report.txt")
  [ "${bad:-1}" = "0" ] || { echo "  ^ invalid HIR must be zero"; return 1; }

  # `uncompilable C` is *also* meant to be zero and is not quite. It was 15 --
  # every one of them caused by module-scope variables being allowed to hold a
  # reference, which is a feature that landed without this row being visible,
  # because `report` did not print it. Two remain:
  #
  #   an `as const` nested object literal, whose inner layout is built by no
  #   function and is not reached by materializing the outer type either
  #   a quoted key on a generic function's returned object
  #
  # It is zero, so this is a hard row now, as the note above it always said it
  # would become. What made it zero was not the repair the note describes: the
  # emitter was *dropping* a field whose type had no layout while the descriptor
  # kept pointing at it, and a field nothing dereferences turns out to need only
  # a pointer, not a layout. What is left of that repair -- the compiler
  # computing its own byte offsets -- is now about LLVM rather than about this.
  known=0
  now=$(awk '/uncompilable C/ { print $NF + 0 }' "$root/target/suite-report.txt")
  if [ "${now:-0}" -gt "$known" ]; then
    echo "  ^ uncompilable C rose from $known to $now"
    return 1
  fi
}

# The frontend is not cargo's, but it lives in cargo's directory -- so
# `cargo clean` takes it, and every step afterwards reports a number that is
# true and means something else. The corpus said `frontend failed 184`, which
# reads as the compiler having lost the ability to parse anything and meant
# that a 39MB Go binary was absent.
#
# Checked once, here, rather than left for each step to misreport in its own
# way.
if [ ! -x "$NTS_TSGO" ]; then
  printf '\033[31mno frontend\033[0m at %s\n' "$NTS_TSGO"
  printf 'run tooling/bootstrap/bootstrap.sh -- `cargo clean` removes it\n'
  exit 1
fi

step "build"   cargo build --release
step "clippy"  lint
step "format"  format
step "tests"   tests
step "corpus"  corpus
step "profile"  profile
step "sweep"    sweep
step "llvm"    llvm
step "examples" ./tooling/gate/gate.sh
# Last, and the most expensive step by some way -- about four minutes, against
# two for everything before it. It is here rather than skipped because until it
# existed nothing ran the retains and releases the compiler emits at all, and it
# found a wrong answer the first time it was pointed at the examples. Set
# NTS_GATE_JOBS to dial the parallelism.
step "rc"       ./tooling/gate/rc.sh

printf '\n\033[32mgreen\033[0m\n'
