// `({ k: "ABC" }).k.charCodeAt(2) - Math.floor(0.1)` is rejected by the
// verifier, so `emit-c` writes nothing:
//
//     invalid HIR: OperandsDiffer { func: "f", op: "-",
//                                   left: Int { bits: 32, signed: true },
//                                   right: Float { bits: 64 } }
//
// **The lowering's own output is well typed.** `nts hir` gives
// `%5 = str.unit %3[%4] : f64` and `%8 = sub %5, %7 : f64`; it is the prepare
// pipeline that breaks it. `--prepared` shows `str.unit unchecked %1[…] : i32`
// beside `%9 = const 0 : f64`, so a width narrowing changed one operand and
// nothing changed the other.
//
// # The precondition is the *inline* literal, which is why it is rare
//
// Measured one removal at a time, and none of the obvious reductions keeps it:
//
//     ({ k: "ABC" }).k.charCodeAt(2) - Math.floor(0.1)   INVALID HIR
//     const o = { k: "ABC" }; o.k.charCodeAt(2) - …      ok
//     "ABC".charCodeAt(2) - Math.floor(0.1)              ok
//     ({ k: "ABC" }).k.length - Math.floor(0.1)          ok
//
// A *named* object is fine and an inline one is not, because only the inline
// one lets `forward_stores` replace the `field.get` with the stored constant
// --- and a `str.unit` over a constant string is what the width narrowing can
// see through. So the narrowing fires exactly where the forwarding did, and its
// consumer is left behind.
//
// `+`, `-` and `%` all fail; the operator is not the subject.
//
// # Why nothing had found it
//
// It is neither a refusal nor a wrong answer: the verifier catches it, which is
// the verifier working. What reaches a person is `invalid HIR:
// OperandsDiffer { … }` --- Rust's `Debug`, with no source location and nothing
// naming the construct --- and `emit-c` then writes no output at all, so the
// next step fails for want of input and reports *that*.
//
// Found 2026-09-21 by `tooling/conformance/fuzz-expressions.mjs`, seed 55, from
// a generated expression no one would write. Pre-existing: a binary built
// 2026-09-18 rejects it identically.
//
// # Where it is *not*, measured rather than assumed
//
// `reconcile` --- `specialize::reconcile_stores` --- **already handles binary
// operands**: it converts both to the operator's result type, and its arm
// excludes only `Eq`, `Ne`, `Concat` and erased operands, none of which this
// is. So the obvious fix is already written.
//
// It never fires here. An `eprintln!` in that arm, on exactly this file, prints
// **nothing**: at reconcile time the two operands still agree, and the mismatch
// is introduced by something that runs *after* it.
//
// That leaves a short list --- `simplify::forward_stores`, `dce::eliminate`,
// `dce::prune_parameters`, `place_allocations`, `rc::insert` --- and
// `forward_stores` is the one that also explains the precondition, since
// replacing the `field.get` with the stored constant is what only an inline
// literal allows. The next step is a print after each of those, not a change to
// `reconcile`.
//
// It is not a lowering change either: `nts hir` is well typed.

export function subtracting(): number {
  return ({ k: "ABC" }).k.charCodeAt(2) - Math.floor(0.1);
}

export function modulo(): number {
  return ({ k: "ABC" }).k.charCodeAt(2) % Math.floor(0.1);
}
