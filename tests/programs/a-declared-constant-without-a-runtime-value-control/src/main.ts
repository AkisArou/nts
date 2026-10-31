// From octane-crypto: BigInteger#fromInt (benchmarks/cases/octane-crypto/case.ts:113).
// Reading a declared const with no supplied value.
// Subject and control differ only by "declare const DV: number;" -> "const DV: number = 1;".
// Refusal subject: tests/refusals/a-declared-constant-without-a-runtime-value.
const DV: number = 1;
export function probe(n: number): number {
  return n < -1 ? DV : 0;
}
