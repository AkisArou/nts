// expect: NTS1001 a `new Array` from a value is not supported by this lowering yet
// From octane-crypto: BigInteger#divideAndRemainder (benchmarks/cases/octane-crypto/case.ts:836).
// Crypto BigInteger object-valued arguments to new Array(q,r); the numeric discovery is a separate committed wrong-answer fixture..
// Subject and control differ only by "new Array(q, r)" -> "[q, r]".
// Executable control: tests/programs/an-array-constructor-with-object-elements-control.
class Cell { value: number; constructor(value: number) { this.value = value; } }
export function probe(n: number): number {
 const q = new Cell(n), r = new Cell(n + 1);
 const xs = new Array(q, r);
 return xs[0]!.value + xs[1]!.value;
}
