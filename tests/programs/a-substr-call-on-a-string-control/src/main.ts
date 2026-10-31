// From octane-crypto: BigInteger#toRadix (benchmarks/cases/octane-crypto/case.ts:469).
// String substr method.
// Subject and control differ only by "s.substr(1)" -> "s.slice(1)".
// Refusal subject: tests/refusals/a-substr-call-on-a-string.
export function probe(s: string): string {
  return s.slice(1);
}
