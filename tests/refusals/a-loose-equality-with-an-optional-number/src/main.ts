// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with is not supported by this lowering yet
// From octane-crypto: BigInteger#fromString (benchmarks/cases/octane-crypto/case.ts:121).
// From octane-crypto: BigInteger#toString (benchmarks/cases/octane-crypto/case.ts:389).
// Optional numeric radix compared with 16, driven through a numeric export.
// Subject and control differ only by "b == 16" -> "b === 16".
// Executable control: tests/programs/a-loose-equality-with-an-optional-number-control.
function isHex(b?: number): boolean { return b == 16; }
export function probe(n: number): boolean { return isHex(n > 0 ? n : undefined); }
