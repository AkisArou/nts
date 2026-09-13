#!/bin/sh
# Do the two backends answer the same where **node is not the oracle**?
#
#     sh tooling/jvm/agrees-with-c.sh
#     sh tooling/jvm/agrees-with-c.sh path/to/tsconfig.json
#
# # The space this covers, and why nothing else does
#
# The gate runs the differential over this corpus twice -- once through C, once
# through the JVM -- and each run compares against node. So wherever node is
# right, two independent checks already cover both backends and this script has
# nothing to add.
#
# **Wherever node is wrong, neither check says anything.** `hir::runtime` pins
# BigInt at exactly 128 bits, unmanaged, because record 0036 measured
# `BigInteger` reproducing node's cost; node's `BigInt` is arbitrary precision.
# So `3n ** 90n` has one answer in node and a different, deliberate one in this
# compiler -- and both backends are *supposed* to disagree with node, in exactly
# the same way. Nothing checked that they disagree in the same way.
#
# The check is therefore not "do they agree with node" but **"where they
# disagree with node, do they disagree identically"**. The differential already
# prints both sides of every disagreement, so the two runs' `nts ` lines are
# directly comparable and no second harness is needed.
#
# # Why this was invisible
#
# `tooling/sweep`'s `big` row asks only `typeof` and `truthy` -- no arithmetic --
# and the differential refuses a function whose *result* is a `bigint`
# ("nothing to check: no exported function has scalar arguments and a scalar
# result"). So a wrapping bigint could not reach the harness at all until it was
# funnelled through `String(...)`, which is what the fixture below does and the
# only reason this question is askable.
# # Run by hand, not by the gate, and the number is why
#
# **281 seconds.** Two full differential runs: the C side pays clang on the
# emitted program and both sides drive every case against node. The `jvm` gate
# step's own sweep costs 1s and earns its place on every run; this costs five
# minutes across three sessions' gates to check a space that has never yet
# contained a defect.
#
# So it is an instrument to reach for when BigInt lowering changes, or when
# anything else moves into the space where node stops being the oracle -- not a
# ratchet. If it ever fires, that judgement gets revisited with a reason.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
nts=${NTS_BIN:-$root/target/release/nts}
[ -x "$nts" ] || { echo "no nts at $nts -- set NTS_BIN" >&2; exit 1; }
work=${NTS_AGREE_WORK:-$HOME/.cache/nts-agrees-with-c}/run.$$
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT INT TERM

if [ $# -gt 0 ]; then
  config=$1
else
  mkdir -p "$work/src"
  # `String(v)` rather than `v.toString()`: a method call on a bigint is refused
  # by the lowering, so the conversion has to be the global. And a `string`
  # result rather than a `bigint` one, because the harness drives scalars.
  cat > "$work/src/main.ts" <<'TS'
export function wrapMul(n: number): string {
  let v = 1n;
  for (let i = 0; i < n; i += 1) { v = v * 3n; }
  return String(v);
}
export function wrapShift(n: number): string {
  let v = 1n;
  for (let i = 0; i < n; i += 1) { v = v << 1n; }
  return String(v);
}
export function wrapAdd(n: number): string {
  let v = 0n;
  for (let i = 0; i < n; i += 1) { v = v + 0x0123456789abcdefn; }
  return String(v);
}
TS
  config=$work/tsconfig.json
  cat > "$config" <<JSON
{ "extends": "$root/tsconfig.fixtures.json", "include": ["$work/src"] }
JSON
fi

# The `nts ` half of every disagreement, which is this compiler's own answer.
# The `node ` half is deliberately dropped: it is the same on both runs by
# construction, so including it would make the diff pass for a reason that has
# nothing to do with the backends.
for backend in c jvm; do
  NTS_BACKEND=$backend NTS_TSGO=${NTS_TSGO:-$root/target/tsgo} \
    "$nts" check "$config" > "$work/$backend.out" 2>&1 || true
  grep -E '^  nts ' "$work/$backend.out" | sed 's/^ *nts  *//' | sort > "$work/$backend.answers"
done

c_lines=$(wc -l < "$work/c.answers" | tr -d ' ')
j_lines=$(wc -l < "$work/jvm.answers" | tr -d ' ')
printf 'C answered %s case(s) node called wrong, the JVM %s\n' "$c_lines" "$j_lines"

# **Zero on both sides is not a pass.** It means node agreed with everything, so
# the two backends were never compared here and this run measured nothing --
# which is the failure mode the rest of this lane has a record about.
if [ "$c_lines" -eq 0 ] && [ "$j_lines" -eq 0 ]; then
  echo "no case reached the uncovered space -- this run compared nothing" >&2
  exit 1
fi

if diff -u "$work/c.answers" "$work/jvm.answers" > "$work/diff" 2>&1; then
  echo "the two backends answer identically where node does not"
else
  echo "the two backends disagree with each other:" >&2
  head -20 "$work/diff" >&2
  exit 1
fi
