// From octane-crypto: BigInteger#divideAndRemainder (benchmarks/cases/octane-crypto/case.ts:836).
// Crypto BigInteger object-valued arguments to new Array(q,r); the numeric discovery is a separate committed wrong-answer fixture..
// Subject and control differ only by "new Array(q, r)" -> "[q, r]".
// Refusal subject: tests/refusals/an-array-constructor-with-object-elements.
class Cell { value: number; constructor(value: number) { this.value = value; } }
export function probe(n: number): number {
 const q = new Cell(n), r = new Cell(n + 1);
 const xs = [q, r];
 return xs[0]!.value + xs[1]!.value;
}
