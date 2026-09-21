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
// The fix is in the pipeline order or in `reconcile`, which runs *after*
// `narrow_widths` and did not reconcile this pair. It is not a lowering change:
// the lowering was right.

export function subtracting(): number {
  return ({ k: "ABC" }).k.charCodeAt(2) - Math.floor(0.1);
}

export function modulo(): number {
  return ({ k: "ABC" }).k.charCodeAt(2) % Math.floor(0.1);
}
