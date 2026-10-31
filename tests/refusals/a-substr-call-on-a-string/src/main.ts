// expect: NTS1001 `substr`, which a string does not have here is not supported by this lowering yet
// From octane-crypto: BigInteger#toRadix (benchmarks/cases/octane-crypto/case.ts:469).
// String substr method.
// Subject and control differ only by "s.substr(1)" -> "s.slice(1)".
// Executable control: tests/programs/a-substr-call-on-a-string-control.
export function probe(s: string): string {
  return s.substr(1);
}
