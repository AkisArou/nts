// From octane-crypto: BigInteger#fromString (benchmarks/cases/octane-crypto/case.ts:121).
// From octane-crypto: BigInteger#toString (benchmarks/cases/octane-crypto/case.ts:389).
// Optional numeric radix compared with 16, driven through a numeric export.
// Subject and control differ only by "b == 16" -> "b === 16".
// Refusal subject: tests/refusals/a-loose-equality-with-an-optional-number.
function isHex(b?: number): boolean { return b === 16; }
export function probe(n: number): boolean { return isHex(n > 0 ? n : undefined); }
