#!/usr/bin/env bash
# Which references can cross the wrapper, in each direction?
#
#   tooling/conformance/reference-boundary.sh
#   NTS_BIN=<a pinned copy> tooling/conformance/reference-boundary.sh
#
# Two directions, because they came apart.
#
# # Outward: it is the value, not the declaration
#
# **This file shipped with the wrong reading of its own output**, and the fix is
# the fourth cell of a 2x2 nobody had filled in. It said "the more specific type
# is the one that fails", from three functions:
#
#     returnsUnknown(): unknown       -> 7          crosses
#     returnsShaped(): { a: number }  -> {"a":7}    crosses
#     returnsObject(): object         -> THREW
#
# Two variables move across those three rows -- the declared type *and* what the
# body returns -- so the conclusion could have been about either. It was about
# the other one. Filling in the cell:
#
#     unknownScalar(): unknown        -> 7          crosses
#     unknownString(): unknown        -> "s"        crosses
#     unknownReference(): unknown     -> THREW      <- the missing row
#     objectReference(): object       -> THREW
#     shapedReference(): { a: number} -> {"a":7}    crosses
#
# `unknown` and `object` both lower to `erased` and get a byte-identical
# wrapper; `nts_to_napi_value` switches on the **tag** and converts UNDEFINED,
# NULL, BOOLEAN, NUMBER and STRING, defaulting to the throw. So:
#
#   **An erased value carrying a reference cannot cross outward, whatever its
#   declaration says. A statically shaped object can.**
#
# A string is the one reference that converts, which is what made a value-shaped
# boundary look type-shaped. `async_hooks.executionAsyncResource` is behind this
# wall rather than behind its `(): object` declaration -- it publishes, it is
# called, and it throws.
#
# Found by the compiler lane, who emitted the missing function rather than
# accepting the reading. The cost of the error was nearly an arm added to `cross`
# for `object`, which would have done nothing.
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
# The outward guards are two now, and the second is the lesson: if `unknown` and
# `object` ever disagree, the run stops rather than reporting it. They lower to
# the same erased type and get a byte-identical wrapper, so a disagreement means
# the instrument is wrong, and that is exactly the reading this file shipped
# with once.
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
export function unknownScalar(): unknown { return 7; }
export function unknownString(): unknown { return "s"; }
export function unknownReference(): unknown { return held; }
export function objectReference(): object { return held; }
export function shapedReference(): { a: number } { return held; }

// Inbound, statically shaped -- the mirror of `shapedReference`, which crosses.
export function shapedInbound(p: { a: number }): number { return p.a; }
export function dateInbound(d: Date): number { return d.getTime(); }
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
const D1 = call(m.exports.unknownScalar);
const D2 = call(m.exports.unknownString);
const D3 = call(m.exports.unknownReference);
const D4 = call(m.exports.objectReference);
const D5 = call(m.exports.shapedReference);
show("D unknownScalar()", D1);
show("D unknownString()", D2);
show("D unknownReference()", D3);
show("D objectReference()", D4);
show("D shapedReference()", D5);
console.log();
if (!(D1.ok && D5.ok)) {
  console.log("  INSTRUMENT FAILURE: control D does not hold -- a scalar through");
  console.log("  `unknown` or a statically shaped object does not come back, so the");
  console.log("  rows below are not about references.");
  process.exit(3);
}
if (D3.ok !== D4.ok) {
  console.log("  INSTRUMENT FAILURE: `unknown` and `object` disagree. They lower to");
  console.log("  the same erased type and get a byte-identical wrapper, so this");
  console.log("  cannot happen -- read the emitted wrapper before believing it.");
  process.exit(3);
}
const E1 = m.exports.shapedInbound;
const E2 = m.exports.dateInbound;
console.log("  E shapedInbound({a:1})       -> " +
  (typeof E1 === "function" ? String(E1({ a: 1 })) : "NOT PUBLISHED"));
console.log("  E dateInbound(new Date(0))   -> " +
  (typeof E2 === "function" ? String(E2(new Date(0))) : "NOT PUBLISHED"));
console.log();
if (typeof E1 !== "function") {
  console.log("  Inbound is total, and not a property of erasure. `shapedReference`");
  console.log("  crosses outward and `shapedInbound` is not published at all --");
  console.log("  `takes an object, which crosses outward only`. So the asymmetry is");
  console.log("  the direction, not the type: outward a shaped object converts and");
  console.log("  an erased one does not; inward nothing object-shaped is carried,");
  console.log("  declared or erased.");
  console.log();
}
if (!D3.ok) {
  console.log("  Outward: an erased value carrying a reference cannot cross, and");
  console.log("  the declaration makes no difference -- `unknown` and `object`");
  console.log("  behave identically because they are the same erased type. A");
  console.log("  statically shaped object crosses; a string crosses, which is what");
  console.log("  makes a value-shaped boundary look type-shaped.");
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
