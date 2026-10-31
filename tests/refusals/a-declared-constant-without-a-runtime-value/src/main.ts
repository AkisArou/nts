// expect: NTS1001 a declared `const` no one gives a value -- no initializer, no literal type, no `@ntsConstant` -- which the compiler cannot know; declare it with its value (`const x = 1`, or `const x: 1`) is not supported by this lowering yet
// From octane-crypto: BigInteger#fromInt (benchmarks/cases/octane-crypto/case.ts:113).
// Reading a declared const with no supplied value.
// Subject and control differ only by "declare const DV: number;" -> "const DV: number = 1;".
// Executable control: tests/programs/a-declared-constant-without-a-runtime-value-control.
declare const DV: number;
export function probe(n: number): number {
  return n < -1 ? DV : 0;
}
