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

# Where the run's temporary directories go, which is a property of the run
# rather than of whoever remembered to set it.
#
# `/tmp` on this machine is a **tmpfs**: 16G of RAM, and the differential
# creates an `nts-check-<pid>` per run while the C backend's tests create an
# `nts-e2e-*` per test, neither of which removes itself. Three sessions running
# all day filled it to 13G, and the failures that produced were not failures of
# the thing being tested -- `rc` reported 11 of 89 examples passing, which reads
# exactly like a compiler regression and was a full filesystem. `javac` in the
# JVM lane reported `Disk quota exceeded` for one class file, which at least
# says what it is.
#
# The RAM matters more than the space. Thirteen gigabytes of tmpfs is thirteen
# gigabytes unavailable to a benchmark's working set and to the page cache its
# C++ references are compiled through -- and the occupancy *changes during a
# run*, so a long measurement is not sampling a constant machine.
#
# `std::env::temp_dir()` honours `TMPDIR`, so this needs no code change.
TMPDIR=${TMPDIR:-$HOME/.cache/nts-tmp}
export TMPDIR
mkdir -p "$TMPDIR"

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

# `NTS_GATE_STEPS` selects a subset, space separated. Everything runs when it is
# unset, which is what a commit needs.
#
# The reason it exists: `rc::insert` runs only under `Provider::ReferenceCounting`
# (see `hir/mod.rs`), so for a change confined to `hir/rc.rs` the `llvm` and
# `examples` steps execute a pass that was never inserted -- 877 of the gate's
# 1200 seconds measuring a code path the change cannot reach. `rc` is the only
# step that runs the counting *and* measures live objects, which is the only way
# a leak or a double-free is visible at all.
#
# A narrower gate is not the same as a weaker one, and it is not licence to skip
# the full run before committing. It is licence not to wait twenty minutes for a
# four-minute question -- which is what made building underneath a running gate
# look reasonable twice in one night, invalidating both.
step() {
  case " ${NTS_GATE_STEPS-} " in
    "  ") ;;
    *" $1 "*) ;;
    *) return 0 ;;
  esac
  printf '\n\033[1m%s\033[0m\n' "$1"
  name=$1
  shift
  started=$(date +%s)
  # `$name`, not `$1`: the shift above already ate the step name, so this line
  # spent its life reporting the command it ran instead of the step that failed.
  "$@" || { printf '\033[31mFAILED\033[0m: %s\n' "$name"; exit 1; }
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
# A file whose working-tree change is *only* formatting.
#
# `clang-format` on `runtime/c` is a gate step, so C formatting is enforced.
# Rust formatting is not: `cargo fmt` is forbidden by a sentence in a document,
# nothing watches, and one editor with format-on-save defeats it silently. On
# 2026-09-04 `compiler/core/src/hir/bounds.rs` was reflowed by nobody who would
# admit to it, and it was found three hours later by someone reading `git
# status` rather than by anything that runs.
#
# This makes no claim about what the formatting *should* be, which is the whole
# reason it is affordable. Adopting `cargo fmt --check` means deciding what the
# formatting is, which costs one deliberate run rewriting every file nobody is
# working in -- the harm the rule exists to prevent, paid up front. This only
# refuses to let an unattributed reformat through unnoticed.
#
# Compared with every whitespace character removed, so a *reflow* is caught and
# not merely a re-indent. Moving tokens between lines is exactly what rustfmt
# does, and a line-wise comparison would miss it.
#
# What it does NOT catch, stated because it is the case that motivated it: a
# reformat that also removes redundant *syntax*. The `bounds.rs` change above
# reflowed one expression **and** dropped a closure body's `{ }`, so the token
# stream differs by two characters and this is silent on it. I found that out by
# reintroducing the change and watching the step pass -- which is the same
# lesson as the three `| 0` examples that agreed with node while the bug was
# still in: a check has to be shown failing before it is believed.
#
# It is kept anyway, because `cargo fmt` does not run on one file. A bulk run
# touches hundreds, most of them re-indented only, and this fires on those --
# which is the alarm that matters. It is a smoke detector, not a lock.
#
# Three sessions share this tree, so this can fail on somebody else's in-flight
# edit. That is intended, and the resolution is the same either way: commit it
# deliberately, or revert it.
reformatted() {
  bad=$(git diff --name-only -- '*.rs' '*.ts' '*.mjs' | while read -r f; do
          [ -f "$f" ] || continue
          before=$(git show "HEAD:$f" 2>/dev/null | tr -d '[:space:]' | cksum)
          after=$(tr -d '[:space:]' < "$f" | cksum)
          [ "$before" = "$after" ] && echo "$f"
        done)
  [ -z "$bad" ] && return 0
  echo "  changed with no content, only formatting:"
  echo "$bad" | sed 's/^/    /'
  echo "  commit it deliberately or revert it -- a reformat nobody claims"
  echo "  buries three sessions' real diffs"
  return 1
}

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
# Output kept, and printed when it fails.
#
# This threw the whole gate away with the word "FAILED" and nothing else, and
# the run that came after it was green -- so the only thing to go on was that
# something had once been wrong. A check that cannot say what it found is the
# same defect as one that cannot fail: `>/dev/null 2>&1` on the step that runs
# every unit test in the tree.
tests() {
  report=$(cargo test --workspace 2>&1) && return 0
  echo "$report" | grep -E "^(error|warning: unused|test .* FAILED|failures:|---- )" -A 4 | head -60
  return 1
}

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
# The same examples, through the second backend, with reference counting on.
#
# Nothing covered this pair. `llvm` and `examples` both run the default
# provider, where `rc::insert` never runs, and `rc.sh` runs the C backend -- so
# the counting the primary-backend-in-waiting emits was executed by no gate step
# at all. The only thing exercising it was `nts-bench` with `NTS_BENCH_RC=1`,
# incidentally, because its C and LLVM columns must agree on a checksum.
#
# It found a module that did not compile the first time it was pointed here: an
# erased value handed to `nts_release`, which takes a pointer, where a tagged
# value needs `nts_value_release` and the tag decides which half is a reference.
# Eight workers, the way `gate.sh` and `rc.sh` do it.
#
# These two steps run the same differential those two run, and ran it one
# example at a time while both of them used eight. That was 1923 seconds of a
# 2408-second gate -- eighty per cent of it -- to answer a question the C steps
# beside them answered in 366. The header of this file already claimed each step
# was "already parallel inside"; two of them were not.
#
# Capped at eight for the reason `gate.sh` states: enough frontends at once
# kills one inside Go's collector, and a gate that is fast and occasionally
# wrong is worth less than one that is slow and never is.
crowded=8
cores=$( { command -v nproc >/dev/null && nproc; } || echo 4 )
jobs=${NTS_GATE_JOBS:-$( [ "$cores" -lt "$crowded" ] && echo "$cores" || echo "$crowded" )}

# `$1` the floor, `$2` how to say what was compared. The backend is selected by
# the environment, which the callers export inside a subshell so it reaches the
# workers and does not outlive the step -- `examples` and `rc` run after these
# two and would otherwise inherit a backend nobody asked them for.
# `NTS_BIN` overrides which binary is driven, defaulting to the one `build`
# produces. Three sessions share this checkout and not all of them build into
# `target/`: a hard-coded path means a step can measure a *different* session's
# binary and report a floor for code that is not the code in front of you.
backend_examples() {
  floor=$1
  said=$2
  results=$(mktemp)
  ls examples/*/tsconfig.json | xargs -P "$jobs" -n 1 sh -c '
    d=$1
    n=$(basename "$(dirname "$d")")
    case "$n" in
      invalid|unsupported) exit 0 ;;
    esac
    out=$("${NTS_BIN:-./target/release/nts}" check "$d" 2>&1)
    if [ $? -ne 0 ]; then
      echo "no $n"
    elif [ "${out#*nothing to check}" != "$out" ]; then
      # Nothing for the differential to drive, so it exits 0 without comparing
      # an answer -- and would count as agreement in either backend. Six do.
      echo "bare $n"
    else
      echo "ok $n"
    fi
  ' _ > "$results"
  passed=$(grep -c '^ok ' "$results" || true)
  bare=$(grep -c '^bare ' "$results" || true)
  total=$(($(grep -c . "$results" || true) - bare))
  behind=$(awk '/^no /{printf " %s", $2}' "$results")
  rm -f "$results"
  printf '  %s of %s examples agree with node %s\n' "$passed" "$total" "$said"
  [ "$bare" -gt 0 ] && printf '  %s compared nothing\n' "$bare"
  if [ "$passed" -lt "$floor" ]; then
    echo "  ^ fell from $floor to $passed:$behind"
    return 1
  fi
  [ "$passed" -gt "$floor" ] && printf '  ^ raise the floor in tooling/gate/all.sh to %s\n' "$passed"
  return 0
}

# 80 of 89 for the same reason its sibling below was: six examples that compare
# nothing stopped being counted as agreements. Same set of programs.
llvm_rc() { ( NTS_BACKEND=llvm NTS_RC=1; export NTS_BACKEND NTS_RC
  backend_examples 88 "through the LLVM backend, counting" ); }

# The floor was 80 of 89 until six examples that *compare nothing* stopped being
# counted as agreements -- `advanced`, `calls`, `classes`, `jsx`,
# `promise-constructor` and `types` have no exported function taking and
# returning scalars, so `nts check` exits 0 without ever asking node. Several
# cannot be differential at all: node will not run an `enum` or JSX.
#
# 74 of 83 is the same set of programs as 80 of 89. It is not a regression, and
# writing it down here is cheaper than someone rediscovering that in a year.
llvm() { ( NTS_BACKEND=llvm; export NTS_BACKEND
  backend_examples 88 "through the LLVM backend" ); }
# The third backend, against the same oracle and with the same ratchet.
#
# No `jvm-rc` sibling: RFC §13 puts TypeScript objects in the platform
# collector's heap, so this lane emits no retains and there would be nothing for
# a counting run to count. A function that reaches one is refused by name rather
# than emitted with them dropped -- a build whose lifetimes came from somewhere
# unexplained is worse than one that stops.
#
# This runs `java`, so it needs a JDK where the other two need clang. A missing
# one is not a passing step: it is reported and the step fails, for the reason
# `codegen/llvm`'s signature test gives about clang.
jvm() { ( NTS_BACKEND=jvm; export NTS_BACKEND
  if ! command -v java > /dev/null 2>&1 && [ ! -x "${JAVA_HOME-}/bin/java" ]; then
    echo "  no JDK on PATH or at JAVA_HOME -- this step cannot verify anything"
    return 1
  fi
  # Sixty-two of eighty-eight, measured at a commit rather than in the shared tree.
  # The floor is planted on *agreement* rather than on rendering, because
  # rendering is a property of the emitter and agreeing is a property of the
  # language, and a floor on the wrong one rewards emitting more while meaning
  # less.
  backend_examples 62 "through the JVM backend" ); }
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
step "reformat" reformatted
# Cheap -- filesystem only -- and it answers a question nothing else asks: does
# `docs/primitives.md` name ratchets that exist. The table is nine claims about
# what is measured, and a claim nothing checks is how a closed primitive quietly
# stops being one. The numbers half needs a benchmark log and is run by hand:
# `tooling/primitives/check.py <log>`.
step "primitives" tooling/primitives/check.py
step "tests"   tests
step "corpus"  corpus
step "profile"  profile
step "sweep"    sweep
step "llvm"    llvm
step "llvm-rc" llvm_rc
step "jvm"     jvm
# Every benchmark case, compiled by both backends and not run. `corpus` proves
# arbitrary input compiles and `examples` proves the examples agree with node;
# nothing covered `benches/cases`, so a code generation bug that only showed up
# there arrived through a twenty-five minute benchmark run instead of here. One
# did: see the header of the script.
step "benches"  ./tooling/gate/benches.sh
step "examples" ./tooling/gate/gate.sh
# Last, and the most expensive step by some way -- about four minutes, against
# two for everything before it. It is here rather than skipped because until it
# existed nothing ran the retains and releases the compiler emits at all, and it
# found a wrong answer the first time it was pointed at the examples. Set
# NTS_GATE_JOBS to dial the parallelism.
step "rc"       ./tooling/gate/rc.sh
# Cheap -- seconds -- and it answers a question no other step asks: not whether
# the counting is *right*, which `rc` covers, but how much of it there is. It
# fails on a leak, on a changed answer, and on a count below the argument
# written down beside it. It caught a collector bug that leaked one link out of
# every list built head first while every count balanced perfectly.
step "memory"   ./tooling/memory/run.sh

printf '\n\033[32mgreen\033[0m\n'
