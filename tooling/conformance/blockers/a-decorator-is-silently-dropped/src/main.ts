// expect: emits-c v2 = 5;
//
// The assertion is the **body of the undecorated method**, because that is the
// defect: `Thing__value` computes 5 where the decorator makes it 10. Pinned to
// the emission rather than to a refusal, since there is no refusal — which is
// the whole point, and means this fixture reads `reproduces` while the compiler
// is wrong and `CHANGED` on the day it is fixed.
//
// **A decorator is compiled away, not refused.** This is the one thing worse
// than a gap, and the ledger row for it was an empty cell reading `decorators`.
//
// # What it does
//
//     function doubled(target: () => number): () => number {
//       return function (): number { return target() * 2 };
//     }
//     class Thing { @doubled value(): number { return 5 } }
//
// The decorator replaces the method, so `new Thing().value()` is **10**. The
// emitted C is:
//
//     static int32_t Thing__value(NtsObj_Thing * v0) {
//         (void)v0;
//         v2 = 5;
//         return v2;
//     }
//
// Five. The decorator is not applied, not refused, and not mentioned.
//
// # Why nothing caught it
//
// **The differential cannot run this program.** node has no native decorators,
// so the harness's transpiled form fails to load and `nts check` reports a node
// crash rather than a disagreement. So the one instrument that compares against
// node is blind here *by construction*, and every other instrument is happy: it
// compiles, it emits, it links, it runs, and it returns a number.
//
// A gap that the oracle cannot see is not a gap the oracle will find.
//
// # Why a probe nearly missed it too
//
// The first decorator written here was a no-op that returned its target. It
// compiled — and a no-op decorator answers the same whether it is applied or
// ignored, so it distinguishes nothing. The second took a
// `ClassMethodDecoratorContext` and refused, as `a parameter of unrepresentable
// type`, which reads like "decorators are refused" and is an accident of the
// *decorator's own signature*.
//
// Only the third — behaviour-changing, with ordinary parameter types — reaches
// the case. Two probes said "handled" and "refused" about a compiler that does
// neither.
//
// # What refusing it needs
//
// The node does not reach the snapshot. `syntax.rs` has `(171, "decorator")` in
// its name table and there is no Rust constant for it, nothing in
// `compiler/core` mentions decorators at all, and `nts frontend` decodes none
// for this file. So the compiler cannot see what it is dropping: the refusal is
// a frontend change first — carry the node, or carry a flag on the declaration
// — and a lowering check second.
//
// # Demand: zero, and that is not the reason to leave it
//
// No `@` decorator anywhere in `runtime/node`, `examples` or `benches`. A wrong
// answer that runs is worth refusing at zero sites, because the cost of finding
// it again is the cost of finding it this time, and this time it took a probe
// written for something else.

function doubled(target: () => number): () => number {
  return function (): number {
    return target() * 2;
  };
}

class Thing {
  @doubled
  value(): number {
    return 5;
  }
}

export function decorated(n: number): number {
  return new Thing().value() + (n & 7);
}
