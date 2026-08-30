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

step() {
  printf '\n\033[1m%s\033[0m\n' "$1"
  shift
  started=$(date +%s)
  "$@" || { printf '\033[31mFAILED\033[0m: %s\n' "$1"; exit 1; }
  printf '  %ss\n' "$(($(date +%s) - started))"
}

lint() { cargo clippy --workspace --all-targets 2>&1 | grep -E '^(warning|error)' && return 1; return 0; }
tests() { cargo test --workspace >/dev/null 2>&1; }
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

  # `uncompilable C` is *also* meant to be zero and is not: fifteen files lower
  # with no diagnostic at all and then cannot be emitted, every one of them
  # `NTS2006 an object type with no layout`. It is counted here rather than
  # enforced because it is a standing defect rather than a regression, and a
  # gate that is red before anyone touches anything is a gate nobody reads.
  #
  # It was invisible until now -- the counter existed and `report` never
  # printed it -- and it means the headline overstates: a file is counted as
  # "lowered completely" *and* uncompilable, so some of the 44 cannot be built.
  # Fixing it makes this a hard row like the other.
  known=15
  now=$(awk '/uncompilable C/ { print $NF + 0 }' "$root/target/suite-report.txt")
  if [ "${now:-0}" -gt "$known" ]; then
    echo "  ^ uncompilable C rose from $known to $now"
    return 1
  fi
}

step "build"   cargo build --release
step "clippy"  lint
step "tests"   tests
step "corpus"  corpus
step "examples" ./tooling/gate/gate.sh

printf '\n\033[32mgreen\033[0m\n'
