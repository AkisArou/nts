#!/usr/bin/env bash
# Which references can cross the wrapper, in each direction?
#
#   tooling/conformance/reference-boundary.sh
#   NTS_BIN=<a pinned copy> tooling/conformance/reference-boundary.sh
#
# Two directions, because they came apart. `unknown` crosses **outward** -- that
# is `blockers/unknown-return-at-the-boundary`, fixed and kept as a guard -- and
# does not cross inward. And the outward side has its own hole, which is not
# `unknown` at all but the bare `object` type:
#
#     returnsUnknown(): unknown        -> 7             crosses
#     returnsShaped(): { a: number }   -> {"a":7}       crosses
#     returnsObject(): object          -> THREW         the compiled function returned
#                                                       a value with no JavaScript
#                                                       representation
#
# **The more specific type is the one that fails.** `object` is narrower than
# `unknown` and narrower than nothing, and it is the only one of the three that
# cannot come back. That is why `async_hooks.executionAsyncResource` is the one
# unusable name in its module: `internal/async-hooks.ts:236` declares it
# `(): object`, the wrapper publishes it, and every call throws.
#
# # Why this is not a blocker fixture
#
# `blockers-check.mjs` reads emitted text. Every expectation it understands --
# `emits-c`, `emits-addon`, `publishes`, `lowers` -- is a question about a file.
#
# This defect is invisible to all of them. `classifyInbound` **publishes**: the
# wrapper is emitted, the name appears in the export table, `lowers` holds and
# `publishes classifyInbound` holds. It fails on the call. A fixture could only
# name text a fix would introduce, and nobody knows what that text is yet, so it
# would be an expectation that cannot pass rather than one that cannot fail --
# the same flaw as `unconditional-expectations.mjs` catches, mirrored.
#
# So it is a script that builds an addon and calls it.
#
# # The three controls, and why three
#
# The finding is that `util.types`' 42 predicates cannot be asked about a
# reference. One call demonstrates that. It does not say *what* is missing, and
# the two plausible causes want opposite fixes:
#
#   A  classifyInternal()           a Map built in the program, held in an
#                                   `unknown`, brand-checked there
#   B  classifyInbound(new Map())   the same check, on a Map that crossed
#   C  classifyScalar("x")          the same parameter, given a scalar
#
# A says whether `unknown` can hold a reference at all. C says whether the
# parameter works. Only with both answering does B mean the crossing.
#
# Measured on pin4, 2026-09-09:
#
#     classifyInternal()            -> true
#     classifyScalar("x")           -> true       classifyScalar(1) -> false
#     classifyInbound(new Map())    -> THREW  an argument of this type has no
#                                             representation in the compiled runtime
#     classifyInbound("x")          -> false
#
# **The representation exists and the parameter works.** `nts_is_map` and
# `nts_is_date` are both emitted. What is missing is one direction of one
# conversion: `nts_from_napi_value` has no case for an object.
#
# # What it is asking for, which is less than it looks
#
# The refusal is deliberate -- `blockers/unknown-at-the-boundary` records the
# reason: "answering `undefined` for a value the caller really passed is the
# wrong-value failure this compiler refuses everywhere else." That is right
# wherever the value gets *read*.
#
# Across `util/src/types.ts` there is not one `value.`, `value[` or `value(`.
# All 42 bodies are `instanceof` or `typeof`. These functions never read the
# value; they classify it. A brand is not a representation, and refusing to
# carry a value nobody dereferences buys nothing.
#
# If A or C fails this prints INSTRUMENT FAILURE instead of the finding. A
# control that stops working turns this into a script that reports a boundary
# defect whatever the boundary does.
#
# **Both guards were made to fire before this landed**, which took two attempts.
# Breaking a control the obvious way -- deleting the body -- makes the program
# stop typechecking, so the run dies at `nothing emitted` and the guard is never
# reached. That is safe but it is not a control: it proves the typechecker
# works. Broken so they still typecheck:
#
#     A  `const m: unknown = "not a map"`   INSTRUMENT FAILURE: control A
#     C  `typeof value === "number"`        INSTRUMENT FAILURE: control C
#
# A third, breaking B itself (`typeof value === "object"` for `instanceof Map`),
# still reports the finding -- correctly. The boundary refuses before any body
# runs, so what the body would have done is not a variable here.
#
# The outward guard was controlled the same way: declaring `returnsShaped` as
# bare `object` instead of `{ a: number }` makes both outward controls fail and
# the run reports INSTRUMENT FAILURE rather than "the narrower type is the one
# that fails", which would then have been a claim about nothing.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
compiler="${NTS_BIN:-${NTS_COMPILER:-$root/target/release/nts}}"
[ -x "$compiler" ] || { echo "no compiler at $compiler" >&2; exit 2; }

work="$(mktemp -d "${TMPDIR:-/tmp}/nts-inbound-XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src"
cat > "$work/tsconfig.json" <<EOF
{ "extends": "$root/tooling/conformance/blockers/tsconfig.base.json",
  "compilerOptions": { "rootDir": "." } }
EOF
# `Map`, not `Date`. `new Date()` with no argument is refused for reading a
# clock -- a capability refusal, nothing to do with representation -- and the
# first version of this probe reported that as the finding.
cat > "$work/src/main.ts" <<'EOF'
export function classifyInternal(): boolean {
  const m: unknown = new Map<string, number>();
  return m instanceof Map;
}
export function classifyInbound(value: unknown): boolean {
  return value instanceof Map;
}
export function classifyScalar(value: unknown): boolean {
  return typeof value === "string";
}

// The outward direction. `held` is a module-level binding so the three
// functions differ in their declared return type and in nothing else.
const held: { a: number } = { a: 7 };
export function returnsUnknown(): unknown { return 7; }
export function returnsShaped(): { a: number } { return held; }
export function returnsObject(): object { return held; }
EOF

NTS_TSGO="${NTS_TSGO:-$root/target/tsgo}" "$compiler" \
  emit-c "$work/tsconfig.json" --out "$work/out" --napi >"$work/emit.log" 2>&1
if [ ! -f "$work/out/addon.c" ]; then
  echo "  INSTRUMENT FAILURE: nothing emitted"; sed -n '1,10p' "$work/emit.log"; exit 3
fi

napi="${NTS_NAPI_INCLUDE:-$root/third_party/node/src}"
uv_include="${NTS_UV_INCLUDE:-$root/third_party/node/deps/uv/include}"
if ! clang -std=c11 -O2 -D_GNU_SOURCE -fPIC -shared -fvisibility=hidden \
  -I"$work/out" -I"$napi" -I"$uv_include" -I"$root/runtime/node/internal" \
  -o "$work/probe.node" "$work"/out/*.c "$root"/runtime/node/internal/*.c \
  -luv -lm >"$work/link.log" 2>&1; then
  echo "  INSTRUMENT FAILURE: the probe did not link"
  grep -E 'error' "$work/link.log" | head -5; exit 3
fi

node -e '
const flags = require("node:os").constants.dlopen;
const m = { exports: {} };
process.dlopen(m, process.argv[1], flags.RTLD_NOW);
const call = (fn, ...a) => { try { return { ok: true, v: fn(...a) }; }
                             catch (e) { return { ok: false, v: e.message }; } };
const A = call(m.exports.classifyInternal);
const C1 = call(m.exports.classifyScalar, "x");
const C2 = call(m.exports.classifyScalar, 1);
const B1 = call(m.exports.classifyInbound, new Map());
const B2 = call(m.exports.classifyInbound, "x");
const show = (l, r) => console.log("  " + l.padEnd(30) + " -> " +
  (r.ok ? String(r.v) : "THREW  " + String(r.v).slice(0, 54)));
show("A classifyInternal()", A);
show("C classifyScalar(\"x\")", C1);
show("C classifyScalar(1)", C2);
show("B classifyInbound(new Map())", B1);
show("B classifyInbound(\"x\")", B2);
const O1 = call(m.exports.returnsUnknown);
const O2 = call(m.exports.returnsShaped);
const O3 = call(m.exports.returnsObject);
show("D returnsUnknown()", O1);
show("D returnsShaped()", O2);
show("D returnsObject()", O3);
console.log();
if (!(O1.ok && O2.ok)) {
  console.log("  INSTRUMENT FAILURE: control D does not hold -- neither `unknown`");
  console.log("  nor a concrete object type comes back, so `object` failing says");
  console.log("  nothing about `object` in particular.");
  process.exit(3);
}
if (!O3.ok) {
  console.log("  Outward: `unknown` and a concrete object type both cross, and the");
  console.log("  bare `object` type does not. The narrower type is the one that");
  console.log("  fails. async_hooks.executionAsyncResource is declared `(): object`");
  console.log("  and is the one unusable name in its module.");
  console.log();
}
if (!(A.ok && A.v === true)) {
  console.log("  INSTRUMENT FAILURE: control A does not hold -- `unknown` cannot");
  console.log("  hold a reference even inside the program, so B says nothing about");
  console.log("  the crossing. Fix the representation question first.");
  process.exit(3);
}
if (!(C1.ok && C1.v === true && C2.ok && C2.v === false)) {
  console.log("  INSTRUMENT FAILURE: control C does not hold -- the `unknown`");
  console.log("  parameter is not carrying scalars either, so B is not about");
  console.log("  references.");
  process.exit(3);
}
if (B1.ok) {
  console.log("  A reference crosses inward. This check has nothing to report,");
  console.log("  which is the outcome it exists to be able to reach.");
  process.exit(0);
}
console.log("  A reference does not cross inward, and both controls hold:");
console.log("  `unknown` carries a reference inside the program (A) and carries");
console.log("  scalars across the boundary (C). One direction of one conversion");
console.log("  is missing -- `nts_from_napi_value` has no case for an object.");
console.log();
console.log("  Cost, measured: util.types publishes 31 predicates and not one can");
console.log("  be asked about a reference, which is the only argument they take.");
process.exit(1)
' "$work/probe.node" 2>&1 | grep -v Deprecation
