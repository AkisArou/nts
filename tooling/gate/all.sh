#!/bin/sh
# The whole gate, in the order that fails fastest.
#
#   tooling/gate/all.sh
#
# **This does not need the measurement lock, and wrapping it in one is a habit
# worth breaking.** Sixteen steps and not one of them times anything: `benches`
# *compiles* the fifty cases and never runs them, `memory` counts allocations,
# which is deterministic, and the only mention of `nts-bench` in this file is a
# comment. Two sessions ran `with-lock.sh --wait tooling/gate/all.sh` against
# each other for most of a day and one of them queued thirty-one minutes for a
# resource neither was using.
#
# The lock is for `nts-bench` and for `perf`. If you reach for it here, the
# thing you are actually worried about is CPU contention making the gate
# *slower*, which it will, and which costs minutes rather than correctness.
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

# **Everything below is one brace group, and that is not a style choice.**
#
# `sh` reads a script incrementally: it parses up to the next command, runs it,
# and comes back for more *at a byte offset*. Three sessions share this
# checkout, so this file is edited while it is running -- and an edit above the
# read point shifts every offset after it. On 2026-09-06 a gate forty-four
# minutes in resumed inside the middle of a line:
#
#     ./tooling/gate/all.sh: line 535: examples: command not found
#     ./tooling/gate/all.sh: line 535: ut: command not found
#
# Fifteen steps ran and passed, `memory` never ran at all, and the script
# **exited 0**, because the last thing it managed to execute succeeded. A gate
# that skips a step and reports success is worse than one that fails: the whole
# point of the last step is that nothing else counts allocations.
#
# A brace group is parsed to its closing `}` before any of it runs, so the file
# is read once and an edit during the run cannot move the interpreter. `exit`
# before the close, so that anything appended after it is not executed either.
#
# Not a copy re-exec, which is the other fix and is wrong here: this script
# locates the repository from its own path, and a copy in `/tmp` reports
# `no frontend at /tmp/.../target/tsgo`. That was tried.
{

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

# Steps that share nothing but the binary, run at once.
#
# The gate was 53 minutes and its shape was a sum: `profile` then `sweep` then
# five backend lanes then `memory`, each waiting for the last. They contend for
# nothing -- each writes under its own `target/` path and reads `nts` read-only
# -- so the sum was a choice rather than a constraint, and the wall time is the
# longest of them rather than the total.
#
# Output is captured and replayed in order, not interleaved. A gate that is fast
# and unreadable has traded one complaint for another, and the failure line has
# to sit under the step that produced it.
#
# `jobs` is lowered for the group. Each step is already parallel inside, so
# eight steps at eight jobs is sixty-four processes on thirty-two cores -- and
# the cap exists to keep the *frontend* from dying in Go's collector, which is a
# limit on total concurrency rather than per-step concurrency.
concurrently() {
  # The command each name runs. `step` takes it as arguments; here it has to be
  # looked up, because the group is a list of names.
  cmd_profile="profile";           cmd_sweep="sweep"
  cmd_llvm="llvm";                 cmd_llvm_rc="llvm_rc"
  cmd_jvm="jvm";                   cmd_memory="./tooling/memory/run.sh"
  # `dex` was added to the `concurrently` line below without a command here, and
  # the group looks its members up by name -- so `eval "run=\$cmd_dex"` was an
  # unbound variable under `set -u` and took the whole run down after every step
  # before it had already passed. This table and that line have to agree.
  cmd_dex="dex"
  cmd_examples="./tooling/gate/gate.sh"
  cmd_rc="./tooling/gate/rc.sh"
  cmd_bench_agree="./tooling/gate/bench-agree.sh"
  cmd_addons="./tooling/gate/addons.sh"
  cmd_blockers="blockers"
  running=""
  chosen=""
  for name in "$@"; do
    case " ${NTS_GATE_STEPS-} " in
      "  ") ;;
      *" $name "*) ;;
      *) continue ;;
    esac
    chosen="$chosen $name"
    (
      started=$(date +%s)
      slot=$(printf '%s' "$name" | tr '-' '_')
      eval "run=\$cmd_$slot"
      if $run > "$root/target/gate-step-$name.out" 2>&1; then
        rm -f "$root/target/gate-step-$name.failed"
      else
        : > "$root/target/gate-step-$name.failed"
      fi
      printf '%s' "$(($(date +%s) - started))" > "$root/target/gate-step-$name.time"
    ) &
    running="$running $!"
  done
  for pid in $running; do wait "$pid"; done
  bad=0
  for name in $chosen; do
    printf '\n\033[1m%s\033[0m\n' "$name"
    cat "$root/target/gate-step-$name.out"
    printf '  %ss\n' "$(cat "$root/target/gate-step-$name.time" 2>/dev/null || echo '?')"
    if [ -f "$root/target/gate-step-$name.failed" ]; then
      printf '\033[31mFAILED\033[0m: %s\n' "$name"
      rm -f "$root/target/gate-step-$name.failed"
      bad=1
    fi
  done
  [ "$bad" -eq 0 ] || exit 1
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
  # Once, not twice. This ran the whole sweep to summarise it and then ran it
  # *again* to get an exit status, because a pipeline's status is the last
  # command's -- so the step cost double what it measured. Captured instead, and
  # the status taken from the run that produced the text, which is also the only
  # way the two can be talking about the same run.
  out=$(./tooling/sweep/run.sh 2>&1)
  status=$?
  printf '%s\n' "$out" | grep -E "checked|agreed|disagree|not emitted" | sed 's/^/  /'
  return $status
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
  # A discovery loop that finds nothing reports it as success. `benches.sh`
  # did exactly that when the per-case `tsconfig.json` files were deleted: it
  # skipped all fifty cases and exited green in zero seconds, while being the
  # only step that compiles `benches/cases` at all. The pattern is the same
  # here -- collect the *bad* ones, and an empty glob yields none.
  modules=$(ls -d "$root"/runtime/node/*/tsconfig.json 2>/dev/null | wc -l)
  if [ "$modules" -eq 0 ]; then
    echo "  no runtime/node modules found -- this step checked nothing"
    return 1
  fi
  # Refusals counted in the same pass, because reach is the project's own
  # signal -- "`runtime/node` is the signal, not ledger count" -- and nothing
  # gated it. A feature that lands is supposed to move this number down, and a
  # change that quietly moves it *up* has been the shape of several regressions:
  # a symbol interned from the wrong file cost 232 sites and nothing failed.
  #
  # A ceiling rather than an exact figure. It is deliberately loose enough that
  # ordinary work does not trip it and tight enough that a large regression
  # does, and it is lowered when a feature earns it -- the same bargain as the
  # example floors, which is why the message says which direction to edit.
  refusals=0
  # In parallel, and each module into its *own* directory.
  #
  # This was a serial `for` loop writing every module into one `--out`, which is
  # both the slowest step in the gate -- 411 seconds of 999, more than the five
  # backend example lanes put together -- and a race waiting for the day someone
  # parallelised it without noticing the shared path.
  #
  # Each module reports into a file named after it, and the sum is taken
  # afterwards: a shell variable cannot be accumulated across processes, and a
  # single shared counter file is the same race one level down.
  work="$root/target/gate-profile"
  rm -rf "$work"
  mkdir -p "$work"
  ls -d "$root"/runtime/node/*/tsconfig.json | xargs -P "$jobs" -n 1 sh -c '
    m=$1
    name=$(basename "$(dirname "$m")")
    out=$("'"${NTS_BIN:-$root/target/release/nts}"'" emit-c "$m" \
            --out "'"$work"'/$name" --napi 2>&1)
    printf "%s" "$out" | grep -c "NTS1001" > "'"$work"'/$name.refusals"
    printf "%s" "$out" | grep -q "panicked at" && echo "$name" > "'"$work"'/$name.crashed"
    exit 0
  ' _
  refusals=$(cat "$work"/*.refusals 2>/dev/null | awk '{s+=$1} END {print s+0}')
  crashed=$(cat "$work"/*.crashed 2>/dev/null)
  printf '  %s modules emitted, %s refusal(s)\n' \
    "$(ls -d "$root"/runtime/node/*/tsconfig.json | wc -l)" "$refusals"
  # The ceiling. Lower it when a feature earns it -- and raise it when the
  # CORPUS earns it, which is new and is now the faster of the two.
  #
  # This went 6551 -> 6947 -> 7461 inside one hour, and none of it was the
  # compiler: measured by running the binary from before those hours over the
  # corpus of after them, which gives 7461 as well. `runtime/node` is being
  # grown by another session at roughly five hundred refusals an hour, and a
  # refusal count tracks corpus size before it tracks anything else.
  #
  # So the 400 of slack below is now about a quarter of an hour rather than a
  # month of work, and the session growing the corpus should expect to raise
  # this in the same commit. Two binaries over one corpus is the measurement
  # that tells the two causes apart, and it costs one loop.
  # 7461 -> 10405 -> 15364 across one afternoon and evening, and the compiler
  # took 13 and then 1,010 OFF that number over the same span. Interface method
  # dispatch alone closed a thousand of them.
  #
  # Earlier note, kept because the method is the point:
  # over the same span: measured by running the binary from the start of it over
  # the corpus at the end, which gives 10418 against the current 10405. The
  # Node lane is committing continuously and a refusal count tracks corpus size
  # before anything else.
  # AN ABSOLUTE CEILING HAS STOPPED MEASURING WHAT IT WAS FOR, and this number
  # is now headroom rather than a bound. 7461 -> 10405 -> 15364 -> 16993 in one
  # day, roughly a thousand an hour, all of it corpus: `runtime/node` is grown
  # continuously by another session and a refusal count tracks corpus size
  # before it tracks anything else. A ceiling loose enough not to trip on an
  # hour of that is loose enough to hide a real regression inside it.
  #
  # So when this trips, the FIRST action is not to raise it. Run the same binary
  # from before the change over the corpus of after it:
  #
  #   for m in runtime/node/*/tsconfig.json; do
  #     <old-nts> emit-c "$m" --out /tmp/a --napi 2>&1 | grep -c NTS1001
  #     <new-nts> emit-c "$m" --out /tmp/b --napi 2>&1 | grep -c NTS1001
  #   done
  #
  # Two binaries over one corpus is what tells a compiler regression from corpus
  # growth, and it has answered that question five times today -- once finding
  # a real thousand-refusal regression of mine that three separate repairs all
  # shared, and four times finding nothing but growth.
  #
  # The fifth: 18914 -> 19086 tripped this, and the same loop said
  #
  #   before (d66d52ae)  19094      after  19086      -8
  #
  # over the corpus of *after*, per module -- eight modules one lower and none
  # higher. So the compiler took eight off and the corpus put a hundred and
  # eighty on, which is under ten minutes of the Node lane committing. The
  # ceiling is raised because the corpus earned it and the run that says so is
  # in this comment rather than in a memory of it.
  ceiling=19500
  if [ "$refusals" -gt "$ceiling" ]; then
    printf '  ^ above the ceiling of %s -- reach went backwards\n' "$ceiling"
    return 1
  fi
  [ "$refusals" -lt $((ceiling - 400)) ] && \
    printf '  ^ lower the ceiling in tooling/gate/all.sh toward %s\n' "$refusals"
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
  # A discovery loop that finds nothing reports it as success. `benches.sh`
  # did exactly that when the per-case `tsconfig.json` files were deleted: it
  # skipped all fifty cases and exited green in zero seconds, while being the
  # only step that compiles `benches/cases` at all. The pattern is the same
  # here -- collect the *bad* ones, and an empty glob yields none.
  modules=$(ls -d "$root"/runtime/node/*/tsconfig.json 2>/dev/null | wc -l)
  if [ "$modules" -eq 0 ]; then
    echo "  no runtime/node modules found -- this step checked nothing"
    return 1
  fi
  # In parallel, like the emit above and for the same reason: this was the other
  # serial loop in the slowest step, and twenty-two `nts hir` runs one after
  # another is twenty-two times a wait nobody needs to take.
  #
  # Sorted afterwards rather than relying on the order they finish in, because
  # the name list is compared against `known_invalid` and a set written in a
  # different order is a different string.
  invalid=$(ls -d "$root"/runtime/node/*/tsconfig.json | xargs -P "$jobs" -n 1 sh -c '
      m=$1
      if "'"${NTS_BIN:-$root/target/release/nts}"'" hir "$m" 2>&1 | grep -q "does NOT verify"; then
        basename "$(dirname "$m")"
      fi
      exit 0
    ' _ | sort | tr '\n' ' ')
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
# Every example that refuses something says so in `tooling/gate/example-refusals`.
#
# **`nts check` exits 0 when an exported function refuses.** It compiles what it
# can, runs that, compares it with node, and reports agreement over the functions
# that survived -- so `backend_examples` below counts such an example as `ok` and
# the floor reads the same either way.
#
# That is not hypothetical. While `examples/in-on-a-native-receiver` was being
# written, disabling the change under test refused seven of its nine functions
# and `nts check` answered "checked 58 cases across 2 function(s), agreed on every
# case", exit 0. The fixture could not fail at the thing it was written for, and
# the floor could not see it. Three other instruments went the same way the same
# night, each found by forcing the answer rather than by reading the fixture.
#
# `nts hir` rather than `nts check`: a refusal is a property of the lowering, and
# this way the step needs no clang and no node and runs in the time the other
# steps take to start.
#
# A count that has gone *down* prints a note and passes -- that is somebody's
# progress and the file should be edited to match. A count that has gone up, or a
# name absent from the file, fails: it is a fixture measuring less than it says.
example_refusals() {
  table="$root/tooling/gate/example-refusals"
  results=$(mktemp)
  ls examples/*/tsconfig.json | xargs -P "$jobs" -n 1 sh -c '
    d=$1
    n=$(basename "$(dirname "$d")")
    case "$n" in invalid|unsupported) exit 0 ;; esac
    count=$(NTS_TSGO="${NTS_TSGO:-$PWD/target/tsgo}" "${NTS_BIN:-./target/release/nts}" hir "$d" 2>&1               | grep -c "NTS100[0-9]")
    [ "$count" -gt 0 ] && printf "%s %s
" "$n" "$count"
    exit 0
  ' _ > "$results"
  bad=""
  note=""
  while read -r name count; do
    [ -z "$name" ] && continue
    want=$(awk -v n="$name" '$1 == n { print $2 }' "$table")
    if [ -z "$want" ]; then
      bad="$bad
    $name refuses $count and is not in tooling/gate/example-refusals"
    elif [ "$count" -gt "$want" ]; then
      bad="$bad
    $name refuses $count, up from $want"
    elif [ "$count" -lt "$want" ]; then
      note="$note
    $name refuses $count, down from $want -- edit the table"
    fi
  done < "$results"
  # And the other direction: a name in the table that refuses nothing any more.
  while read -r name want _rest; do
    case "$name" in ""|"#"*) continue ;; esac
    grep -q "^$name " "$results" || note="$note
    $name refuses nothing now, was $want -- remove it from the table"
  done < "$table"
  listed=$(grep -c . "$results")
  rm -f "$results"
  printf '  %s example(s) carry a refusal, all accounted for\n' "$listed"
  [ -n "$note" ] && printf '  progress, and the table is stale:%s\n' "$note"
  if [ -n "$bad" ]; then
    printf '  a fixture is measuring less than it says:%s\n' "$bad"
    return 1
  fi
  return 0
}

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
    if [ $? -eq 0 ]; then
      if [ "${out#*nothing to check}" != "$out" ]; then
        # Nothing for the differential to drive, so it exits 0 without comparing
        # an answer -- and would count as agreement in either backend. Six do.
        echo "bare $n"
      else
        echo "ok $n"
      fi
      exit 0
    fi
    # **A non-zero exit is not the same claim as "the backend disagrees",** and
    # reading it as one is how this step produced its two worst reports. `nts
    # check` says which of the things happened; the step was asking a coarser
    # question than the tool answers.
    case "$out" in
      *"disagree between the compiled program and node"*) echo "no $n" ;;
      *"the backend declined"*)                           echo "no $n" ;;
      *"the compiled program aborted"*)                   echo "no $n" ;;
      *"does not typecheck"*)                             echo "no $n" ;;
      *"refusing to proceed"*)                            echo "no $n" ;;
      *"invalid HIR"*)                                    echo "no $n" ;;
      *)
        # Something that is not an answer about the backend at all: the
        # compiler never ran, or died for a reason of its own. The first line
        # of what it said goes with the name, because a bare list of names is
        # what sent one session hunting jar timestamps for ten minutes.
        why=$(printf "%s" "$out" | grep -v "^$" | head -1 | cut -c1-90)
        printf "unmeasured %s\t%s\n" "$n" "$why"
        ;;
    esac
  ' _ > "$results"
  passed=$(grep -c '^ok ' "$results" || true)
  bare=$(grep -c '^bare ' "$results" || true)
  unmeasured=$(grep -c '^unmeasured ' "$results" || true)
  total=$((passed + $(grep -c '^no ' "$results" || true)))
  behind=$(awk '/^no /{printf " %s", $2}' "$results")
  printf '  %s of %s examples agree with node %s\n' "$passed" "$total" "$said"
  [ "$bare" -gt 0 ] && printf '  %s compared nothing\n' "$bare"
  if [ "$unmeasured" -gt 0 ]; then
    # **Not counted against the floor, and the step fails anyway.** A case that
    # could not be run is not evidence in either direction, and scoring it as a
    # regression is how sixty-six contiguous plausible names appeared once and
    # `0 of 128` appeared another time -- the second because `NTS_TSGO` was
    # unset and the compiler never started, which read as every example
    # disagreeing at once.
    printf '  %s could not be measured, so the floor below says nothing:\n' "$unmeasured"
    awk -F'\t' '/^unmeasured /{ sub(/^unmeasured /, "", $1); printf "    %-24s %s\n", $1, $2 }' \
      "$results"
    rm -f "$results"
    return 1
  fi
  rm -f "$results"
  # The names, whenever there are any -- not only when the floor is breached.
  #
  # The floor answers "did we regress"; the names answer "against what", and
  # those are different questions. A run sitting exactly *on* its floor printed
  # nothing at all, so one example failing for an unrelated reason -- a missing
  # `node_modules` in a fresh worktree, which makes `examples/library` fail to
  # typecheck -- was indistinguishable from a clean run unless you read the
  # `of N`. That cost three runs to find once and would have cost one.
  [ -n "$behind" ] && printf '  not agreeing:%s\n' "$behind"
  if [ "$passed" -lt "$floor" ]; then
    echo "  ^ fell from $floor to $passed"
    return 1
  fi
  [ "$passed" -gt "$floor" ] && printf '  ^ raise the floor in tooling/gate/all.sh to %s\n' "$passed"
  return 0
}

# 80 of 89 for the same reason its sibling below was: six examples that compare
# nothing stopped being counted as agreements. Same set of programs.
llvm_rc() { ( NTS_BACKEND=llvm NTS_RC=1; export NTS_BACKEND NTS_RC
  backend_examples 169 "through the LLVM backend, counting" ); }

# The floor was 80 of 89 until six examples that *compare nothing* stopped being
# counted as agreements -- `advanced`, `calls`, `classes`, `jsx`,
# `promise-constructor` and `types` have no exported function taking and
# returning scalars, so `nts check` exits 0 without ever asking node. Several
# cannot be differential at all: node will not run an `enum` or JSX.
#
# 74 of 83 is the same set of programs as 80 of 89. It is not a regression, and
# writing it down here is cheaper than someone rediscovering that in a year.
llvm() { ( NTS_BACKEND=llvm; export NTS_BACKEND
  backend_examples 169 "through the LLVM backend" ); }
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
# Can `d8` spell what this backend emits?
#
# The ratchet `unverifiable class` is for the JVM, one platform along. Version
# 52 and no `invokedynamic` are the *preconditions* for DEX and both were
# asserted long before anything ran `d8`; `d8_accepts_the_runtime_jar` then ran
# it, on hand-written Java, which can only fail if a person writes something
# DEX forbids and no person had.
#
# What was never dexed was the compiler's own output. `symbol-keys` emitted a
# field named `__@kCount@2` -- legal in a class file, refused by DEX -- and it
# was green in every instrument this lane had: verified under `-Xverify:all`,
# agreed with node, ran on ART. It could not reach the one platform this
# backend exists for, and nothing said so for as long as it was true.
#
# Skips without an SDK, like `unverifiable class` reads zero without a JDK.
# Needs no device: `d8` is a compiler, so whether it accepts a class file is a
# question about the class file.
dex() {
  sh "$root/tooling/android/dexes.sh"
}

jvm() { ( NTS_BACKEND=jvm; export NTS_BACKEND
  if ! command -v java > /dev/null 2>&1 && [ ! -x "${JAVA_HOME-}/bin/java" ]; then
    echo "  no JDK on PATH or at JAVA_HOME -- this step cannot verify anything"
    return 1
  fi
  # **115 of 115 — equal to the corpus.** The plan set the target at 86 of 87,
  # which was the LLVM floor the day it was written; the corpus has grown by
  # twenty-four since and this lane refuses nothing in it.
  #
  # `array-buffer` arrived with `ManagedType::Buffer` and cost five cases out of
  # 841 before it agreed, all of one rule: `ToIndex` truncates *toward zero*, so
  # `slice(-0.5)` starts at the beginning and `Math.floor` starts one back from
  # the end -- and `transfer(NaN)` is an empty buffer rather than an unchanged
  # one, because NaN is zero here and not "no argument".
  #
  # The last two came off in an afternoon and neither was a design. A `Date` is
  # a `double` and an identity; a symbol is a description and an identity. Both
  # wanted a class to be, which is thirty lines, and both had been refused by
  # name for long enough that the refusal read like a verdict on the construct
  # rather than on the absence of a file.
  #
  # `async-catch` took two things: one runtime helper for the reason a rejected
  # promise carries, and a latent bug in `crossing_values` that no earlier
  # example had the shape to reach.
  #
  # `async-finally` took one more, and it was the last thing standing between
  # this lane and the corpus: `nts_promise_reject_value`. A `finally` spanning
  # an `await` re-rejects with exactly what `nts_promise_reason` handed back,
  # which is an `NtsValue` because `catch (e)` is `unknown` -- so the reason
  # arrives already erased and there was no name for that shape.
  #
  # A floor equal to the corpus is a different kind of number from one below it:
  # from here it can only be held, and an example that does not agree fails this
  # step on the day it lands rather than being absorbed into a gap.
  #
  # A floor is planted on *agreement* rather than on rendering, because
  # rendering is a property of the emitter and agreeing is a property of the
  # language, and a floor on the wrong one rewards emitting more while meaning
  # less.
  #
  # What is left for this backend is mostly not coverage. Seven of the eight
  # AWFY rows are at or under hand-written Java; `awfy-queens` at 1.25x is the
  # one left, and **both diagnoses written here have now been wrong**. Not its
  # counter being a method parameter, and not the materialised boolean either.
  #
  # The second one was measured and still wrong, which is the more useful
  # failure. `a && b && c` does lower to a merge per operator whose parameter
  # this backend writes to a slot and reads back -- 55 bytecodes in
  # `getRowColumn` against javac's 25 -- and transcribing that shape into the
  # reference's Java cost 1.35x. But threading the merge away in the emitter,
  # 55 bytecodes down to 46 and the join gone, moved the row 0.16% across eight
  # interleaved rounds. C2 sees through our store-and-reload; it does not see
  # through what javac makes of the same shape written as Java. **A
  # transcription of a bytecode shape into source is not that bytecode.**
  #
  # So the row's cause is unfound, and `benches/jvm-rows.md` holds what has
  # been ruled out rather than a diagnosis.
  #
  # 125, level with the LLVM lane. The per-lane gap this paragraph used to
  # record -- `examples/open-typed-values`, which needs `instanceof` against a
  # typed array, and on a lane with no descriptors is a different mechanism --
  # no longer shows in the count.
  #
  # **The two lanes are one apart, and the gap is named rather than absorbed.**
  # `examples/a-structural-cast-that-is-a-prefix` passes a class where a
  # structural type is wanted, which on C and LLVM is a free pointer cast
  # whenever the target's fields are the source's first fields -- and is not
  # expressible here at all.
  #
  # The JVM relates classes by **name**. Coinciding offsets buy nothing when
  # `getfield Named.name` needs the object to *be* a `Named` in the class
  # hierarchy, so that lane refuses the prefix case and the non-prefix case
  # alike: `storing a X where a Y is declared, and the first does not extend the
  # second here`. The only answer it has is a conversion, which is a copy, which
  # is not the same object -- the trade refused on the C side for the same
  # reason.
  #
  # So this is one example short rather than one backend behind, and the two
  # cannot be brought level without deciding what an interface's representation
  # is when both an object literal and a class instance can be one. That is the
  # design step `blockers/method-syntax-in-an-interface` names.
  #
  # Measured by the JVM lane, not assumed here: `implements Named, Counted` was
  # tried on that example to make it expressible and made it worse.
  #
  # **Two apart now**, and the second gap is the opposite asymmetry.
  # `examples/two-private-names-that-collide` is a base and a derived class
  # declaring the same `#name`, which C and LLVM answer by giving the inherited
  # copy a qualified name and addressing both by *index*. The JVM addresses a
  # field by name and class, so it reports
  # `NoSuchFieldError: nts.gen.Base does not have member field 'int $count$t1'`.
  #
  # That lane expresses this **better** than C can: Java has field hiding, so
  # `Derived.$count` and `Base.$count` are two fields the verifier already tells
  # apart, and nothing needs renaming there at all. What did not travel was the
  # rename -- a C-shaped answer written into a shared `Layout` -- and it is gone:
  # `Field::declared_by` states the class instead, each backend spelling the
  # distinction its own way. Landed 2026-09-10 as a coordinated pair, `18760619`
  # here and `f9ff1be6` on that lane, with `48707004` after it.
  #
  # **Two gaps, and they are one cause.** `a-structural-cast-that-is-a-prefix`
  # and `a-class-stored-and-compared` refuse with the same NTS4001:
  #
  #     storing a `Prefixed` where a `Counted` is declared
  #     storing a `Ctor_Other` where a `Fn3__1` is declared
  #
  # Two layouts TypeScript relates, unrelated in the class hierarchy this lane
  # emits -- structurally in the first, by function-type subtyping in the
  # second. The JVM relates classes by *name*, so fields coinciding buys
  # nothing: `getfield Counted.n` needs the object to *be* a `Counted`. A
  # conversion would be a copy and a copy is not the same object, which is the
  # trade the C lane refused for its own reasons.
  #
  # It is **not** "a class token has no base". That edge was built and reverted
  # on 2026-09-10: a token's `typeof` names a different signature layout per
  # return type, so `Ctor_Other extends Fn3__6` against a slot declared
  # `Fn3__1`, and the declines do not move. What is missing is that two
  # *signature* layouts TypeScript relates are unrelated here -- covariant
  # constructor returns -- which single inheritance cannot express and which
  # `Layout::base` is already spent on for closures.
  #
  # So the two gaps are the same sentence one representation apart, and neither
  # is this lane being behind. Both swept one at a time rather than inferred
  # from a total.
  backend_examples 170 "through the JVM backend" ); }
corpus() {
  # `NTS_SUITE_BIN` for the same reason `NTS_BIN` exists two steps up: under
  # `pinned.sh` the binaries are built into `CARGO_TARGET_DIR`, which is not
  # `$root/target`, and a hardcoded path finds nothing there. The failure does
  # not look like a missing file -- the report is one line of shell error, the
  # grep below matches none of it, and the step reports `invalid HIR must be
  # zero` over a suite that never ran.
  mkdir -p "$root/target"
  "${NTS_SUITE_BIN:-./target/release/nts-suite}" --root "$root" > "$root/target/suite-report.txt" 2>&1
  grep -E "single-file|lowered completely|refused a construct|rejected by|frontend failed|invalid HIR|uncompilable C|unverifiable class" \
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

  # `unverifiable class` must be zero, and it is the only row here that reports
  # a lie about a *type*. The suite has counted it since it was added and no
  # step asserted on it -- the same gap `uncompilable C` had, where a row that
  # is printed but not checked is a number nobody reads.
  #
  # It earns its own assertion rather than sharing one because it fails
  # differently: C and LLVM compile a merged layout, an erased-singleton scan
  # and an unerase to `{}` without complaint, and the checked-cast backend is
  # the only instrument that sees any of them. A zero here is a claim the other
  # two rows cannot make.
  #
  # It reads zero when no JDK is present, which is not the same as verified.
  # `examine` skips the check entirely in that case, so this row is a floor on
  # a machine that can answer and silent on one that cannot -- and the `jvm`
  # step below is what refuses to run at all without one.
  bad=$(awk '/unverifiable class/ { print $NF + 0 }' "$root/target/suite-report.txt")
  [ "${bad:-1}" = "0" ] || { echo "  ^ unverifiable class must be zero"; return 1; }
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

# Two records were committed as 0164 on 2026-09-06, by two sessions that each
# believed they had claimed it. `claim-record.sh` is atomic and was guarding the
# wrong noun -- it made the exclusive create on the *file name*, and two
# different titles at the same number are two different names, so both
# succeeded. The script now claims a number-only name and renames.
#
# This step is the half that does not depend on anyone using the script. It is
# record 0077's rule applied to a filing convention rather than to a table:
# where two things must agree and only one can be deleted, make the second one
# assert. Filesystem only, milliseconds.
#
# # Why four are allowed, and why they are named rather than counted
#
# Pointing this at the corpus found that 0164 was the *fifth* collision, not the
# first: 0099, 0102, 0116 and 0120 have each been claimed twice, over two days,
# by sessions that all believed the convention was holding. Nothing had ever
# looked.
#
# They are listed by number rather than allowed by count. A count would let a
# fixed collision be spent on a new one and report the same green -- the failure
# mode this whole file is about. Each of the four is a *later* file taking a
# number an earlier file already had, and in both of the pairs anything cites,
# the citation means the earlier one; so the fix is to renumber the later, and
# three of the four are nts-69's to renumber rather than mine.
#
# The list only shrinks.
KNOWN_DUPLICATE_RECORDS="0099 0102 0116 0120"
records() {
  # `tr` because the membership tests below match on spaces; a newline-
  # separated list silently matches nothing and reports every number stale.
  dupes=$(ls docs/records | grep -oE '^[0-9]{4}' | sort | uniq -d | tr '\n' ' ')
  unexpected=""
  for n in $dupes; do
    case " $KNOWN_DUPLICATE_RECORDS " in
      *" $n "*) ;;
      *) unexpected="$unexpected $n" ;;
    esac
  done
  if [ -n "$unexpected" ]; then
    echo "  a record number was claimed twice:"
    for n in $unexpected; do
      for f in docs/records/"$n"-*.md; do echo "    $f"; done
    done
    echo "  renumber the later one; tooling/gate/claim-record.sh takes the next free"
    return 1
  fi
  # A number that leaves the list may not come back, and a list naming a number
  # that is no longer duplicated is a stale allowance -- both are the same bug.
  stale=""
  for n in $KNOWN_DUPLICATE_RECORDS; do
    case " $dupes " in
      *" $n "*) ;;
      *) stale="$stale $n" ;;
    esac
  done
  if [ -n "$stale" ]; then
    echo "  fixed, so remove from KNOWN_DUPLICATE_RECORDS:$stale"
    return 1
  fi
  echo "  $(ls docs/records | grep -cE '^[0-9]{4}') records, 4 numbers claimed twice and named"
}

step "build"   cargo build --release
step "clippy"  lint
step "format"  format
step "reformat" reformatted
step "records" records
# Cheap -- filesystem only -- and it answers a question nothing else asks: does
# `docs/primitives.md` name ratchets that exist. The table is nine claims about
# what is measured, and a claim nothing checks is how a closed primitive quietly
# stops being one. The numbers half needs a benchmark log and is run by hand:
# `tooling/primitives/check.py <log>`.
step "primitives" tooling/primitives/check.py
step "tests"   tests
step "corpus"  corpus
# Every benchmark case, compiled by both backends and not run. `corpus` proves
# arbitrary input compiles and `examples` proves the examples agree with node;
# nothing covered `benches/cases`, so a code generation bug that only showed up
# there arrived through a twenty-five minute benchmark run instead of here. One
# did: see the header of the script.
step "benches"  ./tooling/gate/benches.sh
step "example-refusals" example_refusals

# The 152 fixtures in `tooling/conformance/blockers`, which nothing ran.
#
# `blockers-check.mjs` sets `process.exitCode = 0` on purpose -- "a blocker being
# fixed is the outcome this lane wants, and it should be loud rather than red" --
# and that reasoning is right about a *fix* and wrong about the other two
# outcomes. So the split is made here rather than there, on the same rule
# `example_refusals` uses one step above: **progress prints a note and passes, a
# change fails.**
#
#   FIXED       a fixture that no longer refuses. Someone should convert it to a
#               guard, and until they do it is good news, not a red gate.
#   CHANGED     it refuses, differently. The expectation names a message that is
#               no longer the one, so the fixture is measuring something other
#               than what it says.
#   REGRESSED   a guard that stopped holding.
#
# Two fixtures were stale when this was written, both from changes made the same
# evening, and **neither showed up anywhere**: `call-and-apply-on-a-function-value`
# had become `apply`-only and `rest-parameter-of-unrepresentable-elements` had
# stopped refusing at all. A hundred and fifty-two fixtures that nothing executes
# are a hundred and fifty-two claims nobody is checking.
blockers() {
  out=$(node tooling/conformance/blockers-check.mjs 2>&1)
  printf '%s\n' "$out" | tail -1
  fixed=$(printf '%s\n' "$out" | grep -c '^  FIXED ' || true)
  [ "$fixed" -gt 0 ] && {
    printf '%s\n' "$out" | grep '^  FIXED '
    echo "  ^ convert these to guards; not a failure"
  }
  changed=$(printf '%s\n' "$out" | grep -cE '^  (CHANGED|REGRESSED) ' || true)
  [ "$changed" = "0" ] || {
    printf '%s\n' "$out" | grep -E '^  (CHANGED|REGRESSED) ' -A 2
    echo "  ^ a fixture measuring something other than what it says"
    return 1
  }
  return 0
}

# Everything left, at once. `benches` is above because `bench-agree` runs the
# cases it compiles; nothing else here depends on anything else here.
jobs=$(( jobs > 4 ? 4 : jobs ))
concurrently profile sweep llvm llvm-rc jvm dex bench-agree examples rc memory addons blockers
# Every node module built as an addon and *loaded*, under eager binding.
#
# The gap this fills was open for the whole of 2026-09-09 and had a crash in it.
# `profile` emits C for all twenty-two modules and compiles none of it; the
# build floor compiles them and loads none of them; the addon sweep loads them
# and takes thirty-five minutes. So an `os.node` that segfaulted node during
# `require` -- every `os` test failing as a crashed child -- sat between two
# thorough instruments for an hour while "22 of 22 still build" stayed true.
#
# Eager binding is the second half and was a second hole: `require` resolves a
# symbol lazily, so an addon whose wrapper names a body the backend refused
# *loads*, publishes the name, and dies on the first call. `loads.sh` uses
# `RTLD_NOW` for that reason.
#
# Five and a half minutes, nearly all of it the twenty-two builds, and it is in
# the concurrent group so the wall clock is the group's slowest member rather
# than the sum.
# And the same fifty cases *run*, against node, on the hostile pool. `benches`
# above compiles them and says so -- "Nothing runs" -- `examples` runs the
# examples, and `nts-bench` runs each case with one seed and compares a
# checksum. Nothing ran a benchmark case against the oracle, and for weeks that
# gap held a wrong answer: `absences` at pool value 2147483647, where a `u32`
# in an `int` slot took the sign of a dividend that has none. Two minutes at
# eight ways; see the script's header.
# Last, and the most expensive step by some way -- about four minutes, against
# two for everything before it. It is here rather than skipped because until it
# existed nothing ran the retains and releases the compiler emits at all, and it
# found a wrong answer the first time it was pointed at the examples. Set
# NTS_GATE_JOBS to dial the parallelism.
# Cheap -- seconds -- and it answers a question no other step asks: not whether
# the counting is *right*, which `rc` covers, but how much of it there is. It
# fails on a leak, on a changed answer, and on a count below the argument
# written down beside it. It caught a collector bug that leaked one link out of
# every list built head first while every count balanced perfectly.

printf '\n\033[32mgreen\033[0m\n'

exit 0
}
